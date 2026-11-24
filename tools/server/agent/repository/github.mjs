// Trusted GitHub component for the private agent (T8.3).
//
// The trusted writes are: push the job branch, open (or reuse) its pull
// request against `main`, put the `preview` label on that pull request, rerun
// failed jobs of a workflow run, and squash-merge a pull request pinned to the
// head commit the service validated. The merge sends exactly `{ sha,
// merge_method: "squash" }` to the one pull request merge endpoint: there is no
// auto-merge, no administrator or protection endpoint, no write to `main` and
// the pull request is never closed. The token stays in this component: it is
// never passed to the sandbox, the model or the tests.
//
// Pushing is idempotent for the same commit and the pull request lookup avoids
// opening a duplicate PR after a restart. Reading the CI status of one commit
// belongs to the same trusted component, because the token never leaves it.

import { classifyCommitStatus } from "./ci-status.mjs";
import { assertWorkBranch } from "./worktrees.mjs";
import { assertPublishableHistory } from "./secret-scan.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
} from "./request-signal.mjs";

import {
  remoteGitTimeoutMilliseconds,
  runGit,
  GitInterruptedError,
} from "./trusted-git.mjs";

function repositoryUrl(repository) {
  return `https://github.com/${repository}.git`;
}

const fullCommitPattern = /^[a-f0-9]{40}$/u;
const maximumPageCount = 10;
const maximumJobLogBytes = 1024 * 1024;
const previewLabel = "preview";
const previewRevokedLabel = "preview-revoked";

function hasLabel(labels, name) {
  return labels.some((label) => label?.name === name);
}

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
 * The summary of a pull request that publication needs. A response missing a
 * field it reads is invalid: reducing it would let a later step treat an absent
 * pull request as a real one.
 */
function pullRequestSummary(pull) {
  if (
    !Number.isSafeInteger(pull?.number) ||
    pull.number < 1 ||
    typeof pull.html_url !== "string" ||
    typeof pull.head?.sha !== "string" ||
    typeof pull.draft !== "boolean" ||
    typeof pull.base?.ref !== "string"
  ) {
    throw new Error("GitHub returned an invalid pull request response.");
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

export class PublicationBaseChangedError extends PublishRefusedError {}

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

/** Reject a pull request that changed while its dependent state was read. */
export function confirmPullRequestUnchanged(original, confirmed) {
  if (
    confirmed.headSha !== original.headSha ||
    confirmed.state !== original.state ||
    confirmed.merged !== original.merged
  ) {
    throw new Error("The pull request changed while reading its state.");
  }
}

/** Read checks for the current head and confirm that the head did not move. */
export async function readLivePullRequest({
  github,
  number,
  requiredChecks,
  signal,
}) {
  const pullRequest = await github.getPullRequest({ number, signal });
  const [checkRuns, statuses] = await Promise.all([
    github.getCommitCheckRuns({ commit: pullRequest.headSha, signal }),
    github.getCommitStatuses({ commit: pullRequest.headSha, signal }),
  ]);
  const confirmed = await github.getPullRequest({ number, signal });
  confirmPullRequestUnchanged(pullRequest, confirmed);
  const classification = classifyCommitStatus({
    requiredChecks,
    checkRuns,
    statuses,
  });
  return { pullRequest: confirmed, classification };
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
      // The stack carries the command and its arguments too: it is redacted
      // with the same care as the message.
      if (typeof error.stack === "string") {
        error.stack = error.stack.replaceAll(this.#token, "***");
      }
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
  async #request(
    method,
    path,
    body,
    { signal, ignoreResponseBody = false } = {},
  ) {
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
    if (response.status === 204 || ignoreResponseBody) return null;
    return response.json();
  }

  /**
   * Push the job branch. `main` and other repositories are rejected before any
   * Git command runs. All outgoing history is checked for protected paths,
   * live credentials and inspection limits before the first remote write.
   */
  async pushBranch({
    worktree,
    branch,
    secrets = [],
    signal,
    approved,
    validated,
    expectedHead = approved?.expectedHead,
    onPublicationStarted,
  }) {
    let commit;
    try {
      assertWorkBranch(branch);
      await this.#assertOrigin(worktree, { signal });
      commit = await this.#git(worktree, ["rev-parse", "HEAD"], {}, { signal });
      if (validated) {
        assertFullCommit(validated.base);
        if (commit !== validated.commit)
          throw new Error("The validated commit has changed.");
        await this.#git(
          worktree,
          ["merge-base", "--is-ancestor", validated.base, commit],
          {},
          { signal },
        );
      }
      if (approved) {
        assertFullCommit(approved.commit);
        assertFullCommit(approved.base);
        if (
          approved.repository !== this.#repository ||
          approved.branch !== branch ||
          approved.worktreePath !== worktree.path ||
          approved.gitDirectory !== worktree.gitDirectory ||
          approved.expectedHead !== expectedHead
        ) {
          throw new Error("The approved publication context has changed.");
        }
        if (commit !== approved.commit) {
          throw new Error("The approved commit has changed.");
        }
        const base = await this.#git(
          worktree,
          ["rev-parse", "origin/main"],
          {},
          { signal },
        );
        if (
          base !== approved.base ||
          (validated && validated.base !== approved.base)
        )
          throw new Error("The approved base has changed.");
      }
      // The lease is an exact ref comparison, never a non-fast-forward update.
      if (expectedHead !== undefined && expectedHead !== null) {
        assertFullCommit(expectedHead);
        await this.#git(
          worktree,
          ["merge-base", "--is-ancestor", expectedHead, commit],
          {},
          { signal },
        );
      }
      await assertPublishableHistory({ worktree, commit, secrets, signal });
      if (validated) {
        // GitHub cannot compare main and update a different ref in one call.
        // Check main last; the push lease guards the work branch itself.
        const remote = await this.#request(
          "GET",
          `/repos/${this.#repository}/git/ref/heads/main`,
          undefined,
          { signal },
        );
        assertFullCommit(remote?.object?.sha);
        if (remote.object.sha !== validated.base)
          throw new PublicationBaseChangedError("The validated base advanced.");
      }
    } catch (error) {
      // A stop during preflight is an interruption, not a refused push.
      if (
        signal?.aborted ||
        error instanceof GitInterruptedError ||
        error?.name === "AbortError"
      ) {
        throw error;
      }
      if (error instanceof PublicationBaseChangedError) throw error;
      throw new PublishRefusedError(
        error instanceof Error ? error.message : "Publication refused.",
        { cause: error },
      );
    }

    signal?.throwIfAborted();
    onPublicationStarted?.();
    await this.#git(
      worktree,
      [
        "push",
        "--no-follow-tags",
        ...(expectedHead !== undefined
          ? [`--force-with-lease=refs/heads/${branch}:${expectedHead ?? ""}`]
          : []),
        "origin",
        `${commit}:refs/heads/${branch}`,
      ],
      {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.https://x-access-token:${this.#token}@github.com/.insteadOf`,
        GIT_CONFIG_VALUE_0: "https://github.com/",
      },
      { signal, timeoutMilliseconds: remoteGitTimeoutMilliseconds },
    );
    return { branch, commit };
  }

  /** Read the private candidate without creating a branch or pull request. */
  async researchCandidate({ worktree, branch, title, body, repair, signal }) {
    assertWorkBranch(branch);
    await this.#assertOrigin(worktree, { signal });
    const commit = await this.#git(
      worktree,
      ["rev-parse", "HEAD"],
      {},
      { signal },
    );
    const base = await this.#git(
      worktree,
      ["rev-parse", "origin/main"],
      {},
      { signal },
    );
    assertFullCommit(commit);
    assertFullCommit(base);
    let expectedHead;
    try {
      const ref = await this.#request(
        "GET",
        `/repos/${this.#repository}/git/ref/heads/${branch}`,
        undefined,
        { signal },
      );
      expectedHead = ref?.object?.sha;
      assertFullCommit(expectedHead);
    } catch (error) {
      if (!(error instanceof GitHubResponseError) || error.status !== 404)
        throw error;
      expectedHead = null;
    }
    return {
      repository: this.#repository,
      worktreePath: worktree.path,
      gitDirectory: worktree.gitDirectory,
      branch,
      commit,
      base,
      expectedHead,
      title,
      body,
      repair: repair ?? null,
    };
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

  async getCheckRunJob({ checkRun, commit, signal }) {
    assertFullCommit(commit);
    if (!Number.isSafeInteger(checkRun?.id) || checkRun.id < 1) return null;
    let details;
    try {
      details = new URL(checkRun.details_url);
    } catch {
      return null;
    }
    const prefix = `/${this.#repository}/actions/runs/`;
    if (
      details.origin !== "https://github.com" ||
      !details.pathname.startsWith(prefix)
    )
      return null;
    const match = /^(\d+)\/job\/(\d+)$/u.exec(
      details.pathname.slice(prefix.length),
    );
    if (!match) return null;
    const runIdentifier = Number(match[1]);
    const jobIdentifier = Number(match[2]);
    if (
      !Number.isSafeInteger(runIdentifier) ||
      runIdentifier < 1 ||
      !Number.isSafeInteger(jobIdentifier) ||
      jobIdentifier < 1
    )
      return null;
    const job = await this.getWorkflowJob({ jobIdentifier, signal });
    const expectedCheckRunUrl = `https://api.github.com/repos/${this.#repository}/check-runs/${checkRun.id}`;
    if (
      job.run_id !== runIdentifier ||
      job.head_sha !== commit ||
      job.check_run_url !== expectedCheckRunUrl
    )
      return null;
    return job;
  }

  async getWorkflowRun({ runIdentifier, commit, signal }) {
    assertFullCommit(commit);
    if (!Number.isSafeInteger(runIdentifier) || runIdentifier < 1) {
      throw new Error("A positive workflow run identifier is required.");
    }
    const run = await this.#request(
      "GET",
      `/repos/${this.#repository}/actions/runs/${runIdentifier}`,
      undefined,
      { signal },
    );
    if (
      run?.id !== runIdentifier ||
      run.head_sha !== commit ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1 ||
      typeof run.status !== "string"
    ) {
      throw new Error("GitHub returned an invalid workflow run.");
    }
    return run;
  }

  async getWorkflowJobLog({ jobIdentifier, signal }) {
    if (!Number.isSafeInteger(jobIdentifier) || jobIdentifier < 1) {
      throw new Error("A positive workflow job identifier is required.");
    }
    const boundedSignal = requestSignal(
      signal,
      this.#requestTimeoutMilliseconds,
    );
    const path = `/repos/${this.#repository}/actions/jobs/${jobIdentifier}/logs`;
    const redirect = await this.#fetch(`${this.#apiBaseUrl}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: "application/vnd.github+json",
        "user-agent": "mountain-runners-agent",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "manual",
      signal: boundedSignal,
    });
    if (redirect.status !== 302) {
      throw new GitHubResponseError("GET", path, redirect.status);
    }
    let location;
    try {
      location = new URL(redirect.headers.get("location"));
    } catch {
      throw new Error("GitHub returned an invalid job log location.");
    }
    const approvedHost =
      location.hostname.endsWith(".blob.core.windows.net") ||
      location.hostname.endsWith(".actions.githubusercontent.com");
    if (
      location.protocol !== "https:" ||
      !approvedHost ||
      location.username ||
      location.password ||
      location.port
    ) {
      throw new Error("GitHub returned an invalid job log location.");
    }
    // A signed log URL is a credential. Do not forward the GitHub token or
    // expose the URL in an exception, trace or model input.
    let response;
    try {
      response = await this.#fetch(location.href, {
        method: "GET",
        redirect: "error",
        signal: boundedSignal,
      });
    } catch {
      throw new Error("The job log could not be read.");
    }
    if (!response.ok || !response.body)
      throw new Error("The job log could not be read.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let log = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximumJobLogBytes)
          throw new Error("The job log exceeds the size limit.");
        log += decoder.decode(value, { stream: true });
      }
      return log + decoder.decode();
    } catch {
      throw new Error("The job log could not be read within its size limit.");
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  async getWorkflowJob({ jobIdentifier, signal }) {
    if (!Number.isSafeInteger(jobIdentifier) || jobIdentifier < 1) {
      throw new Error("A positive workflow job identifier is required.");
    }
    const job = await this.#request(
      "GET",
      `/repos/${this.#repository}/actions/jobs/${jobIdentifier}`,
      undefined,
      { signal },
    );
    if (
      job?.id !== jobIdentifier ||
      !Number.isSafeInteger(job.run_id) ||
      job.run_id < 1 ||
      !Number.isSafeInteger(job.run_attempt) ||
      job.run_attempt < 1 ||
      !Array.isArray(job.steps)
    ) {
      throw new Error("GitHub returned an invalid workflow job.");
    }
    return job;
  }

  async rerunFailedJobs({ runIdentifier, signal }) {
    if (!Number.isSafeInteger(runIdentifier) || runIdentifier < 1) {
      throw new Error("A positive workflow run identifier is required.");
    }
    await this.#request(
      "POST",
      `/repos/${this.#repository}/actions/runs/${runIdentifier}/rerun-failed-jobs`,
      undefined,
      { signal, ignoreResponseBody: true },
    );
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
      !Array.isArray(pull.labels) ||
      typeof pull.merged !== "boolean" ||
      (pull.merged && typeof pull.merge_commit_sha !== "string")
    ) {
      throw new Error("GitHub returned an invalid pull request response.");
    }
    return {
      state: pull.state,
      htmlUrl: pull.html_url,
      headSha: pull.head.sha,
      headRef: pull.head.ref,
      // A fork whose repository was deleted has no head repository.
      headRepository: pull.head.repo?.full_name ?? null,
      draft: pull.draft,
      previewLabeled: hasLabel(pull.labels, previewLabel),
      // A maintainer's revocation wins over the label: no preview is announced.
      previewRevoked: hasLabel(pull.labels, previewRevokedLabel),
      baseRef: pull.base.ref,
      // `unknown` while GitHub is still computing it; any other value but
      // `clean` is a reason not to merge.
      mergeableState: pull.mergeable_state,
      merged: pull.merged,
      mergeCommitSha: pull.merged ? pull.merge_commit_sha : null,
    };
  }

  /**
   * Put the `preview` label on the pull request the service just opened. It is
   * the only label operation of the component: the label is fixed, nothing can
   * be removed and no other label can be set. Adding a label the pull request
   * already has changes nothing, so an unknown result is settled by reading the
   * labels and only then repeated, once.
   */
  async addPreviewLabel({ number, signal }) {
    assertPullRequestNumber(number);
    const labelsPath = `/repos/${this.#repository}/issues/${number}/labels`;
    try {
      await this.#request(
        "POST",
        labelsPath,
        { labels: [previewLabel] },
        { signal },
      );
      return;
    } catch (error) {
      if (isDefiniteRejection(error)) throw error;
    }
    signal?.throwIfAborted();
    const labels = await this.#request("GET", labelsPath, undefined, {
      signal,
    });
    if (!Array.isArray(labels)) {
      throw new Error("GitHub returned an invalid labels response.");
    }
    if (hasLabel(labels, previewLabel)) {
      return;
    }
    await this.#request(
      "POST",
      labelsPath,
      { labels: [previewLabel] },
      { signal },
    );
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

  /** The comments of a pull request, oldest first. */
  async listIssueComments({ number, signal }) {
    assertPullRequestNumber(number);
    const comments = [];
    for (let page = 1; page <= maximumPageCount; page += 1) {
      const response = await this.#request(
        "GET",
        `/repos/${this.#repository}/issues/${number}/comments?per_page=100&page=${page}`,
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
      `/repos/${this.#repository}/pulls?state=open&base=${encodeURIComponent(this.#baseBranch)}&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      undefined,
      { signal },
    );
    if (!Array.isArray(pulls)) {
      throw new Error("GitHub returned an invalid pull request list response.");
    }
    const pull = pulls[0];
    if (!pull) {
      return null;
    }
    return pullRequestSummary(pull);
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
      pullRequest: pullRequestSummary(pull),
      created: true,
    };
  }
}
