// The publisher is the only path from a committed change to a remote write. The
// instruction signal must reach every remote read and write it performs, and an
// aborted publication must stay an unknown result instead of becoming a local
// refusal that would invite a retry.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PublishRefusedError } from "./github.mjs";
import { createPublisher } from "./publisher.mjs";
import { primaryRepository } from "./trusted-git.mjs";
import { publishedCommit } from "./worktrees.mjs";

const branch = "feat/agent-synthetic-change-1001";
const repairCommit = "1".repeat(40);

function worktreeFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-publisher-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  mkdirSync(join(directory, ".git"));
  return primaryRepository(directory);
}

function githubStub(overrides = {}) {
  return {
    calls: [],
    async getPullRequest(parameters) {
      this.calls.push(["getPullRequest", parameters]);
      return { state: "open", headSha: repairCommit };
    },
    async pushBranch(parameters) {
      this.calls.push(["pushBranch", parameters]);
      return { branch: parameters.branch, commit: repairCommit };
    },
    async ensurePullRequest(parameters) {
      this.calls.push(["ensurePullRequest", parameters]);
      return { pullRequest: { number: 200 }, created: false };
    },
    ...overrides,
  };
}

test("forwards the instruction signal to every remote operation", async (context) => {
  const worktree = worktreeFixture(context);
  const github = githubStub();
  const publishChange = createPublisher({ github, secrets: ["synthetic"] });
  const controller = new AbortController();

  const publication = await publishChange({
    worktree,
    branch,
    title: "feat(phase-8-t8.6): bound the publication",
    body: "Descripció",
    repair: { pullRequestNumber: 200, commit: repairCommit },
    signal: controller.signal,
  });

  assert.deepEqual(
    github.calls.map(([name]) => name),
    ["getPullRequest", "pushBranch", "ensurePullRequest"],
  );
  for (const [, parameters] of github.calls) {
    assert.equal(parameters.signal, controller.signal);
  }
  assert.equal(publication.commit, repairCommit);
  assert.equal(publishedCommit(worktree), repairCommit);
});

test("keeps a local refusal a refusal", async (context) => {
  const worktree = worktreeFixture(context);
  const github = githubStub({
    async pushBranch() {
      throw new PublishRefusedError("Synthetic local refusal.");
    },
  });
  const publishChange = createPublisher({ github, secrets: [] });

  const publication = await publishChange({
    worktree,
    branch,
    signal: undefined,
  });

  assert.deepEqual(publication, { refused: true });
  assert.equal(publishedCommit(worktree), null);
});

test("propagates an aborted push instead of reporting a refusal", async (context) => {
  const worktree = worktreeFixture(context);
  const aborted = new DOMException("The operation was aborted.", "AbortError");
  const github = githubStub({
    async pushBranch() {
      throw aborted;
    },
  });
  const publishChange = createPublisher({ github, secrets: [] });

  await assert.rejects(
    publishChange({ worktree, branch, signal: AbortSignal.abort() }),
    (error) => error === aborted,
  );
  assert.equal(publishedCommit(worktree), null);
});

test("reports a pull request read that fails before the push as a local refusal", async (context) => {
  const worktree = worktreeFixture(context);
  let reads = 0;
  const github = githubStub({
    async getPullRequest() {
      reads += 1;
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
  });
  const publishChange = createPublisher({ github, secrets: [] });
  let publicationStarted = false;

  const publication = await publishChange({
    worktree,
    branch,
    repair: { pullRequestNumber: 200, commit: repairCommit },
    onPublicationStarted: () => {
      publicationStarted = true;
    },
  });

  assert.deepEqual(publication, { refused: true, readFailed: true });
  assert.equal(publicationStarted, false);
  assert.equal(reads, 1);
  assert.deepEqual(github.calls, []);
  assert.equal(publishedCommit(worktree), null);
});

test("propagates an aborted pull request read as an abort", async (context) => {
  const worktree = worktreeFixture(context);
  const controller = new AbortController();
  const aborted = new DOMException("The operation was aborted.", "AbortError");
  const github = githubStub({
    async getPullRequest() {
      controller.abort();
      throw aborted;
    },
  });
  const publishChange = createPublisher({ github, secrets: [] });

  await assert.rejects(
    publishChange({
      worktree,
      branch,
      repair: { pullRequestNumber: 200, commit: repairCommit },
      signal: controller.signal,
    }),
    (error) => error === aborted,
  );
  assert.equal(publishedCommit(worktree), null);
});

test("marks the publication as started immediately before the push", async (context) => {
  const worktree = worktreeFixture(context);
  const events = [];
  const github = githubStub({
    async pushBranch(parameters) {
      events.push("push");
      return { branch: parameters.branch, commit: repairCommit };
    },
  });
  const publishChange = createPublisher({ github, secrets: [] });

  await publishChange({
    worktree,
    branch,
    onPublicationStarted: () => events.push("started"),
  });

  assert.deepEqual(events, ["started", "push"]);
});

test("a repair whose pull request disappeared publishes nothing", async (context) => {
  const worktree = worktreeFixture(context);
  const github = githubStub({
    async ensurePullRequest(parameters) {
      this.calls.push(["ensurePullRequest", parameters]);
      return { pullRequest: null, created: false };
    },
  });
  const publishChange = createPublisher({ github, secrets: [] });

  const publication = await publishChange({
    worktree,
    branch,
    repair: { pullRequestNumber: 200, commit: repairCommit },
  });

  assert.deepEqual(publication, { refused: true });
  assert.equal(
    github.calls.find(([name]) => name === "ensurePullRequest")[1]
      .createMissing,
    false,
  );
  // Nothing was published, so the commit is not marked as published: the next
  // instruction must be able to push it.
  assert.equal(publishedCommit(worktree), null);
});
