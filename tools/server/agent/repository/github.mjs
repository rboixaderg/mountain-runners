// Trusted GitHub component for the private agent (T8.3).
//
// Only two operations exist: push the job branch and open (or reuse) its pull
// request against `main`. There is no merge, no auto-merge, no protection
// change and no write to `main`; the requested merge belongs to T8.4 and will
// need its own deterministic path. The token stays in this component: it is
// never passed to the sandbox, the model or the tests.
//
// Pushing is idempotent for the same commit and the pull request lookup avoids
// opening a duplicate PR after a restart. Reading the CI status of one commit
// belongs to the same trusted component, because the token never leaves it.

import { assertWorkBranch } from "./worktrees.mjs";
import { assertPublishableHistory } from "./secret-scan.mjs";

import { runGit } from "./trusted-git.mjs";

function repositoryUrl(repository) {
  return `https://github.com/${repository}.git`;
}

const fullCommitPattern = /^[a-f0-9]{40}$/u;
const maximumPageCount = 10;

function assertFullCommit(commit) {
  if (typeof commit !== "string" || !fullCommitPattern.test(commit)) {
    throw new Error("A full commit SHA is required.");
  }
}

function assertPullRequestNumber(number) {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("A positive pull request number is required.");
  }
}

/**
 * A publish refused by a local rule (branch, origin or credential scan). Nothing
 * reached GitHub, so the caller reports a normal failure instead of stopping
 * the service as an unknown external result.
 */
export class PublishRefusedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "PublishRefusedError";
  }
}

export class GitHubTrust {
  #token;
  #repository;
  #baseBranch;
  #fetch;
  #apiBaseUrl;

  constructor({
    token,
    repository,
    baseBranch = "main",
    fetchImpl = fetch,
    apiBaseUrl = "https://api.github.com",
  }) {
    if (!token) {
      throw new Error("A GitHub token is required.");
    }
    if (baseBranch !== "main") {
      throw new Error("The agent only targets the main base branch.");
    }
    this.#token = token;
    this.#repository = repository;
    this.#baseBranch = baseBranch;
    this.#fetch = fetchImpl;
    this.#apiBaseUrl = apiBaseUrl;
  }

  async #git(worktree, argumentsList, environment = {}) {
    try {
      return (await runGit(worktree, argumentsList, { environment })).trim();
    } catch (error) {
      error.message = String(error.message).replaceAll(this.#token, "***");
      // execFile's original error may retain an unredacted remote URL.
      delete error.cause;
      throw error;
    }
  }

  async #assertOrigin(worktree) {
    const remote = await this.#git(worktree, [
      "config",
      "--get",
      "remote.origin.url",
    ]);
    const accepted = new Set([
      repositoryUrl(this.#repository),
      `git@github.com:${this.#repository}.git`,
      `https://github.com/${this.#repository}`,
    ]);
    if (!accepted.has(remote)) {
      throw new Error(
        `The worktree origin ${remote} is not the configured repository.`,
      );
    }
  }

  async #request(method, path, body, { signal } = {}) {
    const response = await this.#fetch(`${this.#apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: "application/vnd.github+json",
        "user-agent": "mountain-runners-agent",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      throw new Error(
        `GitHub ${method} ${path} failed with HTTP ${response.status}.`,
      );
    }
    return response.json();
  }

  /**
   * Push the job branch. `main` and other repositories are rejected before any
   * Git command runs. All outgoing history is checked for protected paths,
   * live credentials and inspection limits before the first remote write.
   */
  async pushBranch({ worktree, branch, secrets = [] }) {
    let commit;
    try {
      assertWorkBranch(branch);
      await this.#assertOrigin(worktree);
      commit = await this.#git(worktree, ["rev-parse", "HEAD"]);
      await assertPublishableHistory({ worktree, commit, secrets });
    } catch (error) {
      throw new PublishRefusedError(
        error instanceof Error ? error.message : "Publication refused.",
        { cause: error },
      );
    }

    await this.#git(
      worktree,
      ["push", "--no-follow-tags", "origin", `${commit}:refs/heads/${branch}`],
      {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.https://x-access-token:${this.#token}@github.com/.insteadOf`,
        GIT_CONFIG_VALUE_0: "https://github.com/",
      },
    );
    return { branch, commit };
  }

  async getCommitCheckRuns({ commit, signal }) {
    assertFullCommit(commit);
    const checkRuns = [];
    for (let page = 1; page <= maximumPageCount; page += 1) {
      const response = await this.#request(
        "GET",
        `/repos/${this.#repository}/commits/${commit}/check-runs?filter=latest&per_page=100&page=${page}`,
        undefined,
        { signal },
      );
      if (!Array.isArray(response.check_runs)) {
        throw new Error("GitHub returned an invalid check-runs response.");
      }
      checkRuns.push(...response.check_runs);
      const total = response.total_count;
      if (response.check_runs.length < 100) return checkRuns;
      if (Number.isSafeInteger(total) && checkRuns.length >= total) {
        return checkRuns;
      }
    }
    throw new Error("GitHub check-runs pagination limit exceeded.");
  }

  /** Every commit status, newest first; the classifier keeps the newest per context. */
  async getCommitStatuses({ commit, signal }) {
    assertFullCommit(commit);
    const statuses = [];
    for (let page = 1; page <= maximumPageCount; page += 1) {
      const response = await this.#request(
        "GET",
        `/repos/${this.#repository}/commits/${commit}/statuses?per_page=100&page=${page}`,
        undefined,
        { signal },
      );
      if (!Array.isArray(response)) {
        throw new Error("GitHub returned an invalid commit statuses response.");
      }
      statuses.push(...response);
      if (response.length < 100) return statuses;
    }
    throw new Error("GitHub commit statuses pagination limit exceeded.");
  }

  async getPullRequest({ number, signal }) {
    assertPullRequestNumber(number);
    const pull = await this.#request(
      "GET",
      `/repos/${this.#repository}/pulls/${number}`,
      undefined,
      { signal },
    );
    if (typeof pull?.head?.sha !== "string" || typeof pull.state !== "string") {
      throw new Error("GitHub returned an invalid pull request response.");
    }
    return { state: pull.state, headSha: pull.head.sha };
  }

  async findOpenPullRequest({ branch }) {
    assertWorkBranch(branch);
    const owner = this.#repository.split("/")[0];
    const pulls = await this.#request(
      "GET",
      `/repos/${this.#repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    const pull = pulls[0];
    if (!pull) {
      return null;
    }
    return {
      number: pull.number,
      htmlUrl: pull.html_url,
      headSha: pull.head.sha,
      draft: pull.draft,
      baseBranch: pull.base.ref,
    };
  }

  /**
   * Open the pull request, or return the existing one for the same branch. The
   * agent never opens a second PR for a resumed branch.
   */
  async ensurePullRequest({ branch, title, body }) {
    assertWorkBranch(branch);
    const existing = await this.findOpenPullRequest({ branch });
    if (existing) {
      return { pullRequest: existing, created: false };
    }

    const pull = await this.#request(
      "POST",
      `/repos/${this.#repository}/pulls`,
      { title, body, head: branch, base: this.#baseBranch, draft: false },
    );
    return {
      pullRequest: {
        number: pull.number,
        htmlUrl: pull.html_url,
        headSha: pull.head.sha,
        draft: pull.draft,
        baseBranch: pull.base.ref,
      },
      created: true,
    };
  }
}
