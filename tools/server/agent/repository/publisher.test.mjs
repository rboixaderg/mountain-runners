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
import { createPublisher as createTrustedPublisher } from "./publisher.mjs";
import { createResearchReview } from "./research-review.mjs";
import { primaryRepository } from "./trusted-git.mjs";
import { publishedCommit } from "./worktrees.mjs";

const branch = "feat/agent-synthetic-change-1001";
const repairCommit = "1".repeat(40);

function createPublisher(options) {
  if (options.researchReview) return createTrustedPublisher(options);
  const publish = createTrustedPublisher({
    ...options,
    researchReview: { isTainted: () => false },
  });
  return (parameters) => publish({ ...parameters, researchJobId: "clean-job" });
}

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
      parameters.onPublicationStarted?.();
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

test("a synchronization revalidates the preview and pins the existing PR update", async (context) => {
  const worktree = worktreeFixture(context);
  const repository = "rboixaderg/mountain-runners";
  const validated = { commit: "2".repeat(40), base: "3".repeat(40) };
  const pullRequest = {
    number: 200,
    state: "open",
    headRef: branch,
    headRepository: repository,
    headSha: repairCommit,
    baseRef: "main",
    draft: false,
    previewLabeled: true,
    previewRevoked: true,
  };
  const github = githubStub({
    async getPullRequest() {
      return pullRequest;
    },
    async pushBranch(parameters) {
      this.calls.push(["pushBranch", parameters]);
      return { branch, commit: validated.commit };
    },
    async ensurePullRequest(parameters) {
      this.calls.push(["ensurePullRequest", parameters]);
      return {
        pullRequest: { ...pullRequest, headSha: validated.commit },
        created: false,
      };
    },
  });
  const publishChange = createPublisher({ github, repository, secrets: [] });
  const candidate = {
    worktree,
    branch,
    repair: {
      pullRequestNumber: 200,
      commit: repairCommit,
      synchronization: true,
    },
    validated,
  };

  assert.deepEqual(await publishChange(candidate), { refused: true });
  assert.deepEqual(github.calls, []);

  pullRequest.previewRevoked = false;
  assert.equal((await publishChange(candidate)).commit, validated.commit);
  assert.equal(github.calls[0][1].expectedHead, repairCommit);
  assert.deepEqual(github.calls[0][1].validated, validated);
  assert.equal(github.calls[1][1].createMissing, false);
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
      parameters.onPublicationStarted();
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

function newPullRequestGithub(overrides = {}) {
  return githubStub({
    async ensurePullRequest(parameters) {
      this.calls.push(["ensurePullRequest", parameters]);
      return { pullRequest: { number: 200 }, created: true };
    },
    async addPreviewLabel(parameters) {
      this.calls.push(["addPreviewLabel", parameters]);
    },
    ...overrides,
  });
}

const newChange = {
  branch,
  title: "feat(phase-8-t8.9): label the preview",
  body: "Descripció",
};

test("labels a pull request the service just created for its preview", async (context) => {
  const worktree = worktreeFixture(context);
  const github = newPullRequestGithub();
  const controller = new AbortController();
  const publication = await createPublisher({ github, secrets: [] })({
    worktree,
    ...newChange,
    signal: controller.signal,
  });

  assert.deepEqual(
    github.calls.map(([name]) => name),
    ["pushBranch", "ensurePullRequest", "addPreviewLabel"],
  );
  assert.deepEqual(github.calls.at(-1)[1], {
    number: 200,
    signal: controller.signal,
  });
  assert.equal(publication.previewLabelFailed, false);
});

test("never labels an existing pull request again, nor posts a comment", async (context) => {
  const worktree = worktreeFixture(context);
  const github = githubStub({
    async addPreviewLabel() {
      assert.fail("an existing pull request must not be labelled");
    },
    async commentOnPullRequest() {
      assert.fail("the service no longer posts /preview");
    },
  });
  const publication = await createPublisher({ github, secrets: [] })({
    worktree,
    ...newChange,
  });
  assert.equal(publication.created, false);
  assert.equal(publication.previewLabelFailed, false);
});

test("keeps the publication when the label cannot be set and says so", async (context) => {
  const worktree = worktreeFixture(context);
  const github = newPullRequestGithub({
    async addPreviewLabel() {
      throw new Error("GitHub refused the label");
    },
  });
  const publication = await createPublisher({ github, secrets: [] })({
    worktree,
    ...newChange,
  });
  assert.equal(publication.created, true);
  assert.equal(publication.commit, repairCommit);
  assert.equal(publication.previewLabelFailed, true);
  assert.equal(publishedCommit(worktree), repairCommit);
});

test("research requires an exact durable approval before any remote write, including after restart", async (context) => {
  const worktree = worktreeFixture(context);
  const directory = mkdtempSync(join(tmpdir(), "mr-research-review-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const candidate = {
    repository: "example/project",
    branch,
    commit: repairCommit,
    base: "2".repeat(40),
    expectedHead: null,
    worktreePath: worktree.path,
    gitDirectory: worktree.gitDirectory,
    title: "Synthetic title",
    body: "Synthetic body",
    repair: null,
  };
  const github = githubStub({
    async researchCandidate(parameters) {
      this.calls.push(["researchCandidate", parameters]);
      return { ...candidate, title: parameters.title, body: parameters.body };
    },
  });
  const store = createResearchReview({ directory });
  store.initialize("job-1");
  store.markResearch("job-1");
  let started = false;
  const parameters = {
    worktree,
    branch,
    title: candidate.title,
    body: candidate.body,
    researchJobId: "job-1",
    onPublicationStarted: () => {
      started = true;
    },
  };
  const first = await createPublisher({
    github,
    secrets: [],
    researchReview: store,
  })(parameters);
  assert.equal(first.refused, true);
  assert.match(first.reviewId, /^[a-f0-9]{64}$/u);
  assert.equal(started, false);
  assert.deepEqual(
    github.calls.map(([name]) => name),
    ["researchCandidate"],
  );
  const restarted = createResearchReview({ directory });
  assert.equal(restarted.isTainted("job-1"), true);
  restarted.approve("job-1", first.reviewId);
  const publish = createPublisher({
    github,
    secrets: [],
    researchReview: restarted,
  });
  const changed = await publish({
    ...parameters,
    body: "Different public body",
  });
  assert.equal(changed.refused, true);
  assert.notEqual(changed.reviewId, first.reviewId);
  assert.equal(started, false);
  const restored = await publish(parameters);
  assert.equal(restored.refused, true);
  assert.notEqual(restored.reviewId, first.reviewId);
  restarted.approve("job-1", restored.reviewId);
  const result = await publish(parameters);
  assert.equal(result.commit, repairCommit);
  assert.equal(started, true);
  assert.deepEqual(
    github.calls.find(([name]) => name === "pushBranch")[1].approved,
    candidate,
  );
});

test("missing research state and failed candidate reads refuse before a push", async (context) => {
  const worktree = worktreeFixture(context);
  const directory = mkdtempSync(join(tmpdir(), "mr-research-review-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createResearchReview({ directory });
  const github = githubStub({
    async researchCandidate() {
      throw new Error("offline");
    },
  });
  const publish = createPublisher({
    github,
    secrets: [],
    researchReview: store,
  });
  assert.deepEqual(
    await publish({ worktree, branch, researchJobId: "missing" }),
    { refused: true, readFailed: true },
  );
  assert.deepEqual(await publish({ worktree, branch }), {
    refused: true,
    readFailed: true,
  });
  store.initialize("job");
  store.markResearch("job");
  assert.deepEqual(await publish({ worktree, branch, researchJobId: "job" }), {
    refused: true,
    readFailed: true,
  });
  assert.deepEqual(github.calls, []);
  assert.equal(publishedCommit(worktree), null);
});

test("research approval does not follow a changed commit, base, remote head, branch or repository", async (context) => {
  const worktree = worktreeFixture(context);
  const directory = mkdtempSync(join(tmpdir(), "mr-research-review-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createResearchReview({ directory });
  const github = githubStub();
  const initial = {
    repository: "example/project",
    branch,
    commit: repairCommit,
    base: "2".repeat(40),
    expectedHead: null,
    title: "title",
    body: "body",
    repair: null,
    worktreePath: worktree.path,
    gitDirectory: worktree.gitDirectory,
  };
  let candidate = initial;
  github.researchCandidate = async () => candidate;
  store.ensure("stable-job");
  const publish = createPublisher({
    github,
    secrets: [],
    researchReview: store,
  });
  const parameters = {
    worktree,
    branch,
    title: "title",
    body: "body",
    researchJobId: "stable-job",
  };
  const first = await publish(parameters);
  store.approve("stable-job", first.reviewId);
  for (const change of [
    { commit: "3".repeat(40) },
    { base: "4".repeat(40) },
    { expectedHead: "5".repeat(40) },
    { branch: "fix/other" },
    { repository: "other/project" },
  ]) {
    candidate = { ...initial, ...change };
    const result = await publish(parameters);
    assert.equal(result.refused, true);
    if (result.reviewId) assert.notEqual(result.reviewId, first.reviewId);
  }
  assert.equal(
    github.calls.some(([name]) => name === "pushBranch"),
    false,
  );
});

test("a publisher without research state fails closed", async (context) => {
  const worktree = worktreeFixture(context);
  const github = githubStub();
  const publish = createTrustedPublisher({ github, secrets: [] });
  assert.deepEqual(await publish({ worktree, branch, researchJobId: "job" }), {
    refused: true,
    readFailed: true,
  });
  assert.deepEqual(github.calls, []);
});

test("repair cannot push a research-tainted job before review or at a different remote head", async (context) => {
  const worktree = worktreeFixture(context);
  const directory = mkdtempSync(join(tmpdir(), "mr-research-review-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createResearchReview({ directory });
  store.ensure("stable-job");
  let expectedHead = repairCommit;
  const github = githubStub({
    async researchCandidate(parameters) {
      return {
        repository: "example/project",
        branch,
        commit: "2".repeat(40),
        base: "3".repeat(40),
        expectedHead,
        title: parameters.title,
        body: parameters.body,
        repair: parameters.repair,
        worktreePath: worktree.path,
        gitDirectory: worktree.gitDirectory,
      };
    },
  });
  const publish = createPublisher({
    github,
    secrets: [],
    researchReview: store,
  });
  const parameters = {
    worktree,
    branch,
    title: "title",
    body: "body",
    researchJobId: "stable-job",
    repair: { pullRequestNumber: 200, commit: repairCommit },
  };
  const review = await publish(parameters);
  assert.equal(review.refused, true);
  assert.ok(review.reviewId);
  assert.deepEqual(github.calls, []);
  store.approve("stable-job", review.reviewId);
  expectedHead = "4".repeat(40);
  assert.deepEqual(await publish(parameters), { refused: true });
  assert.equal(store.isApproved("stable-job", review.reviewId), false);
  assert.deepEqual(github.calls, []);
});
