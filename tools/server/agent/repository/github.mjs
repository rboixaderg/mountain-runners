// Trusted GitHub component for the private agent (T8.3).
//
// Only four writes exist: push the job branch, open (or reuse) its pull
// request against `main`, post the constant `/preview` comment that asks the
// phase 6 workflow for a preview and squash-merge a pull request pinned to the
// head commit the service validated. The merge sends exactly `{ sha,
// merge_method: "squash" }` to the one pull request merge endpoint: there is no
// auto-merge, no administrator or protection endpoint, no write to `main` and
// the pull request is never closed. The token stays in this component: it is
// never passed to the sandbox, the model or the tests.
//
// Pushing is idempotent for the same commit and the pull request lookup avoids
// opening a duplicate PR after a restart. Reading the CI status of one commit
// belongs to the same trusted component, because the token never leaves it.

import { previewCommand } from "../policy/development.mjs";
import { assertWorkBranch } from "./worktrees.mjs";
import { assertPublishableHistory } from "./secret-scan.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
} from "./request-signal.mjs";

import { remoteGitTimeoutMilliseconds, runGit } from "./trusted-git.mjs";

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

/** A response GitHub sent and the service received; it carries only the status. */
export class GitHubResponseError extends Error {
  constructor(method, path, status) {
    super(`GitHub ${method} ${path} failed with HTTP ${status}.`);
    this.name = "GitHubResponseError";
    this.status = status;
  }
}

// Responses that say the request itself was wrong or refused. A timeout (408)
// or a rate limit (429) says nothing about whether the write took effect.
const retryableClientStatuses = new Set([408, 429]);

/** Whether GitHub definitely refused a write, so nothing was created or merged. */
export function isDefiniteRejection(error) {
  return (
    error instanceof GitHubResponseError &&
    error.status >= 400 &&
    error.status < 500 &&
    !retryableClientStatuses.has(error.status)
  );
}

export function statusClass(status) {
  return `${Math.floor(status / 100)}xx`;
}

export class GitHubTrust {
  #token;
  #repository;
  #baseBranch;
  #fetch;
  #apiBaseUrl;
  #requestTimeoutMilliseconds;

  constructor({
    token,
    repository,
    baseBranch = "main",
    fetchImpl = fetch,
    apiBaseUrl = "https://api.github.com",
    requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
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
    this.#requestTimeoutMilliseconds = requestTimeoutMilliseconds;
  }

  /**
   * Every Git command honours the instruction signal and has a deadline: local
   * reads and checks are bounded, and the remote push gets its own longer one.
   */
  async #git(
    worktree,
    argumentsList,
    environment = {},
    { signal, timeoutMilliseconds } = {},
  ) {
    try {
      return (
        await runGit(worktree, argumentsList, {
          environment,
          signal,
          timeoutMilliseconds,
        })
      ).trim();
    } catch (error) {
      error.message = String(error.message).replaceAll(this.#token, "***");
      // execFile's original error may retain an unredacted remote URL.
      delete error.cause;
      throw error;
    }
  }

  async #assertOrigin(worktree, { signal } = {}) {
    const remote = await this.#git(
      worktree,
      ["config", "--get", "remote.origin.url"],
      {},
      { signal },
    );
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

  /**
   * One bounded API call. A caller with its own deadline passes `signal`; any
   * other request still gets the service request deadline, so an API that never
   * answers cannot hold the global execution.
   */
  async #request(method, path, body, { signal } = {}) {
    const boundedSignal = requestSignal(
      signal,
      this.#requestTimeoutMilliseconds,
    );
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
      signal: boundedSignal,
    });

    if (!response.ok) {
      throw new GitHubResponseError(method, path, response.status);
    }
    return response.json();
  }

  /**
   * Push the job branch. `main` and other repositories are rejected before any
   * Git command runs. All outgoing history is checked for protected paths,
   * live credentials and inspection limits before the first remote write.
   */
  async pushBranch({ worktree, branch, secrets = [], signal }) {
    let commit;
    try {
      assertWorkBranch(branch);
      await this.#assertOrigin(worktree, { signal });
      commit = await this.#git(worktree, ["rev-parse", "HEAD"], {}, { signal });
      await assertPublishableHistory({ worktree, commit, secrets, signal });
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
      { signal, timeoutMilliseconds: remoteGitTimeoutMilliseconds },
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
    if (
      typeof pull?.head?.sha !== "string" ||
      typeof pull.head.ref !== "string" ||
      typeof pull.state !== "string" ||
      typeof pull.base?.ref !== "string" ||
      typeof pull.draft !== "boolean" ||
      typeof pull.merged !== "boolean" ||
      (pull.merged && typeof pull.merge_commit_sha !== "string")
    ) {
      throw new Error("GitHub returned an invalid pull request response.");
    }
    return {
      state: pull.state,
      headSha: pull.head.sha,
      headRef: pull.head.ref,
      // A fork whose repository was deleted has no head repository.
      headRepository: pull.head.repo?.full_name ?? null,
      draft: pull.draft,
      baseRef: pull.base.ref,
      // `unknown` while GitHub is still computing it; any other value but
      // `clean` is a reason not to merge.
      mergeableState: pull.mergeable_state,
      merged: pull.merged,
      mergeCommitSha: pull.merged ? pull.merge_commit_sha : null,
    };
  }

  /**
   * The login of the account this token authenticates. Read-only, used to tell
   * whether the `/preview` comment the service would post exists.
   */
  async getAuthenticatedLogin({ signal } = {}) {
    const user = await this.#request("GET", "/user", undefined, { signal });
    if (typeof user?.login !== "string" || user.login === "") {
      throw new Error("GitHub returned an invalid user response.");
    }
    return user.login;
  }

  /**
   * Post the exact `/preview` comment. The body is fixed: the model and the
   * callers can never choose what the service writes with this credential.
   */
  async commentOnPullRequest({ number, body, signal }) {
    assertPullRequestNumber(number);
    if (body !== previewCommand) {
      throw new Error("Only the preview command can be posted.");
    }
    const comment = await this.#request(
      "POST",
      `/repos/${this.#repository}/issues/${number}/comments`,
      { body },
      { signal },
    );
    if (
      !Number.isSafeInteger(comment?.id) ||
      typeof comment.created_at !== "string"
    ) {
      throw new Error("GitHub returned an invalid comment response.");
    }
    return { createdAt: comment.created_at };
  }

  /**
   * Squash-merge the pull request only if its head is still `sha`: GitHub
   * refuses the merge otherwise. Neither the method nor the message can be
   * chosen by the caller. A response that does not confirm the merge is an
   * unknown result, never a success.
   */
  async mergePullRequest({ number, sha, signal }) {
    assertPullRequestNumber(number);
    assertFullCommit(sha);
    const merge = await this.#request(
      "PUT",
      `/repos/${this.#repository}/pulls/${number}/merge`,
      { sha, merge_method: "squash" },
      { signal },
    );
    if (merge?.merged !== true || typeof merge.sha !== "string") {
      throw new Error("GitHub returned an invalid merge response.");
    }
    return { mergeCommitSha: merge.sha };
  }

  /**
   * The comments of a pull request updated since `since` (an ISO timestamp),
   * oldest first. GitHub filters by `updated_at`, so the publisher's comment
   * edited in place is still listed.
   */
  async listIssueComments({ number, since, signal }) {
    assertPullRequestNumber(number);
    const comments = [];
    for (let page = 1; page <= maximumPageCount; page += 1) {
      const response = await this.#request(
        "GET",
        `/repos/${this.#repository}/issues/${number}/comments?since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
        undefined,
        { signal },
      );
      if (!Array.isArray(response)) {
        throw new Error("GitHub returned an invalid comments response.");
      }
      comments.push(...response);
      if (response.length < 100) return comments;
    }
    throw new Error("GitHub comments pagination limit exceeded.");
  }

  async findOpenPullRequest({ branch, signal }) {
    assertWorkBranch(branch);
    const owner = this.#repository.split("/")[0];
    const pulls = await this.#request(
      "GET",
      `/repos/${this.#repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      undefined,
      { signal },
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
   * agent never opens a second PR for a resumed branch. Without `createMissing`
   * a missing pull request is reported as `null` instead of being opened.
   */
  async ensurePullRequest({
    branch,
    title,
    body,
    createMissing = true,
    signal,
  }) {
    assertWorkBranch(branch);
    const existing = await this.findOpenPullRequest({ branch, signal });
    if (existing) {
      return { pullRequest: existing, created: false };
    }
    if (!createMissing) {
      return { pullRequest: null, created: false };
    }

    const pull = await this.#request(
      "POST",
      `/repos/${this.#repository}/pulls`,
      { title, body, head: branch, base: this.#baseBranch, draft: false },
      { signal },
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
