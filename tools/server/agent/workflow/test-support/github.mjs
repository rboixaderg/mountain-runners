// GitHub doubles shared by the tests: publication, the reads and the PUT of a
// merge, and the publisher's preview comment.

import assert from "node:assert/strict";
import { git } from "../../repository/test-support/git-repository.mjs";

const repository = "rboixaderg/mountain-runners";
const commit = "a".repeat(40);
const mergeCommit = "b".repeat(40);

/** Records what a turn publishes: pushes, pull requests and preview labels. */
export function publicationGithub() {
  return {
    pushes: [],
    pulls: [],
    labelled: [],
    labelError: null,
    async addPreviewLabel({ number }) {
      if (this.labelError) throw this.labelError;
      this.labelled.push(number);
    },
    pullRequest: { state: "open" },
    async getPullRequest() {
      return this.pullRequest;
    },
    async pushBranch(argumentsObject) {
      this.pushes.push(argumentsObject);
      argumentsObject.onPublicationStarted?.();
      return {
        branch: argumentsObject.branch,
        commit: await git(argumentsObject.worktree.path, ["rev-parse", "HEAD"]),
      };
    },
    async ensurePullRequest(argumentsObject) {
      this.pulls.push(argumentsObject);
      return {
        pullRequest: {
          number: 200,
          htmlUrl: `https://github.com/${repository}/pull/200`,
        },
        created: true,
      };
    },
  };
}

/** Pull request #200 at commit `a…a`, ready to merge. */
export function openPullRequest(overrides = {}) {
  return {
    state: "open",
    htmlUrl: `https://github.com/${repository}/pull/200`,
    headSha: commit,
    headRepository: repository,
    draft: false,
    baseRef: "main",
    mergeableState: "clean",
    merged: false,
    mergeCommitSha: null,
    previewLabeled: true,
    previewRevoked: false,
    ...overrides,
  };
}

export function mergedPullRequest() {
  return openPullRequest({
    state: "closed",
    merged: true,
    mergeCommitSha: mergeCommit,
  });
}

/** What the merge handler reads and its single PUT, for pull request #200. */
export function mergeGithub(state = {}) {
  const github = {
    merges: [],
    reads: 0,
    checkReads: 0,
    pullRequest: openPullRequest(),
    pullRequestSequence: null,
    // The pull requests of a scenario with more than one published pull request.
    pullRequests: null,
    checkRuns: [
      { name: "Validate", status: "completed", conclusion: "success" },
    ],
    statuses: [],
    readError: null,
    mergeError: null,
    mergeResponse: { mergeCommitSha: mergeCommit },
    beforeMerge: null,
    changedPaths: ["apps/web/src/content/posts/la-cursa.yaml"],
    changedPathsError: null,
    changedPathsCommits: [],
    // Entries that differ from a regular file, by path.
    treeModes: {},
    treeModesError: null,
    removedPaths: [],
    ...state,
    async getPullRequest({ number }) {
      github.reads += 1;
      if (github.readError) throw github.readError;
      if (github.pullRequestSequence) {
        return github.pullRequestSequence.shift() ?? github.pullRequest;
      }
      if (github.pullRequests !== null) {
        return github.pullRequests[number];
      }
      assert.equal(number, 200, "only the bound pull request may be read");
      return github.pullRequest;
    },
    async getCommitCheckRuns() {
      github.checkReads += 1;
      return github.checkRuns;
    },
    async getCommitStatuses() {
      return github.statuses;
    },
    async getChangedPaths({ commit: pinnedCommit }) {
      github.changedPathsCommits.push(pinnedCommit);
      if (github.changedPathsError) throw github.changedPathsError;
      return {
        paths: github.changedPaths,
        presentPaths: github.changedPaths.filter(
          (path) => !github.removedPaths.includes(path),
        ),
      };
    },
    async getTreeModes({ commit: pinnedCommit }) {
      assert.equal(pinnedCommit, github.changedPathsCommits.at(-1));
      if (github.treeModesError) throw github.treeModesError;
      return new Map(
        github.changedPaths
          .filter((path) => !github.removedPaths.includes(path))
          .map((path) => [path, github.treeModes[path] ?? "100644"]),
      );
    },
    async mergePullRequest({ number, sha }) {
      if (github.pullRequests === null) {
        assert.equal(number, 200, "only the bound pull request may be merged");
      }
      github.beforeMerge?.();
      github.merges.push({ number, sha });
      if (github.mergeError) throw github.mergeError;
      return github.mergeResponse;
    },
  };
  return github;
}

/** The delivered preview notice of each topic, as the preview store finds it. */
export function deliveredPreviews() {
  const rows = new Map();
  return {
    deliver(topicSessionKey, row) {
      rows.set(topicSessionKey, row);
    },
    clear(topicSessionKey) {
      rows.delete(topicSessionKey);
    },
    find(topicSessionKey) {
      return rows.get(topicSessionKey);
    },
  };
}

/** The comment the preview publisher leaves for a published commit. */
export function publisherComment({
  commit: publishedCommit = commit,
  origin = "https://pr-200.preview.mountainrunners.cat",
  updatedAt = "2026-11-14T10:05:00Z",
} = {}) {
  return {
    user: { login: "github-actions[bot]" },
    body: `<!-- mountain-runners-preview -->\nPreview publicada: ${origin}\nCommit: \`${publishedCommit}\`.`,
    updated_at: updatedAt,
  };
}
