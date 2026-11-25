import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  PublicationBaseChangedError,
  PublishRefusedError,
} from "../repository/github.mjs";
import { PublicationRuleError } from "../repository/secret-scan.mjs";
import { TopicJobStore } from "../repository/topic-job-store.mjs";
import {
  failedMaintainerNotice,
  instructionReports,
  mergeSynchronizationReports,
} from "../policy/development.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { createNestedRepository } from "../repository/test-support/nested-repository.mjs";
import { git } from "../repository/test-support/git-repository.mjs";
import { publicationGithub } from "./test-support/github.mjs";
import {
  fixture,
  configFor,
  topicSessionKey,
  topicWorktreePath,
  noteStore,
  request,
  advanceMain,
} from "./test-support/run-instruction.mjs";

const mergeRequest = () => request({ updateIdentifier: 2002 });

// A bound topic whose pull request head is published on the fixture origin.
async function boundTopic(context, runnerOptions = {}) {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const origin = join(paths.directory, "origin.git");
  const github = publicationGithub();
  let remoteBranch;
  github.pushBranch = async ({ worktree, branch, onPublicationStarted }) => {
    onPublicationStarted?.();
    remoteBranch = branch;
    const commit = await git(worktree.path, ["rev-parse", "HEAD"]);
    await git(origin, [
      "fetch",
      worktree.path,
      `refs/heads/${branch}:refs/heads/${branch}`,
    ]);
    github.pushes.push({ branch, commit });
    return { branch, commit };
  };
  const readPullRequest = async () => ({
    state: "open",
    draft: false,
    baseRef: "main",
    headRepository: "rboixaderg/mountain-runners",
    headRef: remoteBranch,
    headSha: await git(origin, ["rev-parse", `refs/heads/${remoteBranch}`]),
    previewLabeled: true,
    previewRevoked: false,
  });
  github.getPullRequest = readPullRequest;
  github.ensurePullRequest = async () => ({
    pullRequest: { number: 200, ...(await readPullRequest()) },
    created: github.pulls.push(true) === 1,
  });
  const gates = [];
  const previews = [];
  const followUp = { result: undefined };
  const turn = { gateExitCode: 0, gate: undefined, model: undefined };
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    runModel: async (turnContext) => {
      const { worktreePath, instruction } = turnContext;
      assert.doesNotMatch(instruction, /sincronitza/iu);
      if (turn.model) return turn.model(turnContext);
      writeFileSync(join(worktreePath, "topic.txt"), "topic\n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async ({ checkCommand, worktreePath }) => {
      gates.push(checkCommand);
      if (turn.gate) return turn.gate(worktreePath);
      return { exitCode: turn.gateExitCode };
    },
    followPreview: (options) => {
      previews.push(options);
      return followUp.result;
    },
    ...runnerOptions,
  });
  assert.equal((await runner(request())).outcome, "pull_request_created");
  const commit = await git(origin, ["rev-parse", `refs/heads/${remoteBranch}`]);
  gates.length = 0;
  previews.length = 0;
  github.pushes.length = 0;
  return {
    paths,
    github,
    runner,
    gates,
    previews,
    followUp,
    turn,
    target: { pullRequestNumber: 200, commit, branch: remoteBranch },
  };
}

test("merge synchronization of an up-to-date branch fails closed without gate or push", async (context) => {
  const { runner, github, gates, target } = await boundTopic(context);
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "up_to_date");
  assert.equal(result.report, mergeSynchronizationReports.upToDate(target));
  assert.deepEqual(gates, []);
  assert.deepEqual(github.pushes, []);
});

test("merge synchronization publishes against current main after it advances past the PR's original base", async (context) => {
  const { paths, runner, github, gates, previews, target } =
    await boundTopic(context);
  const mainSha = await advanceMain(paths, "main-change.txt", "main\n");
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "synchronized", result.report);
  assert.equal(result.report, mergeSynchronizationReports.synchronized(target));
  assert.equal(result.mainHead, mainSha);
  assert.notEqual(result.commit, target.commit);
  assert.equal(gates.length, 1);
  assert.equal(github.pushes.length, 1);
  const parents = await git(topicWorktreePath(paths), [
    "log",
    "-1",
    "--format=%P",
  ]);
  assert.deepEqual(parents.split(" "), [target.commit, mainSha]);
  assert.equal(previews[0].mergeSynchronization, true);
  assert.equal(previews[0].commit, result.commit);
});

test("keeps the redacted reason of a refused merge synchronization in the note", async (context) => {
  let synchronize;
  const notes = [];
  const { paths, github, runner, target } = await boundTopic(context, {
    requestMerge: (mergeCommand) => synchronize(mergeCommand),
    sessionNotes: {
      addNote: (note) => notes.push(note),
      claim: () => [],
      deliver: () => {},
      release: () => {},
    },
  });
  synchronize = (mergeCommand) =>
    runner.synchronizeForMerge(mergeCommand, target);
  github.pushBranch = async () => {
    throw new PublishRefusedError("raw", {
      cause: new PublicationRuleError("Rule on github-secret."),
    });
  };
  await advanceMain(paths, "main-change.txt", "main\n");
  notes.length = 0;

  const result = await runner(
    request({ updateIdentifier: 2002, instruction: "/merge" }),
  );

  assert.equal(result.report, instructionReports.publicationRefused);
  assert.deepEqual(
    notes.map((note) => note.text),
    [
      `${instructionReports.publicationRefused}\nPublication refused: Rule on ***.`,
    ],
  );
});

test("merge synchronization refuses a moved head or branch without mutating", async (context) => {
  const { paths, runner, github, gates, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  const worktree = topicWorktreePath(paths);
  const headBefore = await git(worktree, ["rev-parse", "HEAD"]);
  for (const [changed, reason] of [
    [{ commit: "a".repeat(40) }, "reviewedHeadChanged"],
    [{ branch: "feat/other" }, "topicBindingMismatch"],
  ]) {
    const result = await runner.synchronizeForMerge(mergeRequest(), {
      ...target,
      ...changed,
    });
    assert.equal(result.outcome, "failed");
    assert.equal(result.reason, reason);
    assert.equal(result.report, instructionReports[reason]);
  }
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(gates, []);
  assert.equal(await git(worktree, ["rev-parse", "HEAD"]), headBefore);
});

test("merge synchronization is uncertain when the preview follow-up is not stored", async (context) => {
  const { paths, runner, followUp, target } = await boundTopic(context);
  followUp.result = false;
  await advanceMain(paths, "main-change.txt", "main\n");
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "uncertain");
  assert.equal(
    result.report,
    mergeSynchronizationReports.followUpUnconfirmed(target),
  );
});

// The next merge request starts again from the reviewed commit.
async function assertRestored(paths, commit) {
  const worktree = topicWorktreePath(paths);
  assert.equal(await git(worktree, ["rev-parse", "HEAD"]), commit);
  assert.equal(await git(worktree, ["status", "--porcelain"]), "");
}

test("merge synchronization with a failed gate returns to the reviewed commit", async (context) => {
  const { paths, runner, turn, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  turn.gateExitCode = 1;
  const failed = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(failed.reason, "checksFailed");
  await assertRestored(paths, target.commit);
  turn.gateExitCode = 0;
  const retried = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(retried.outcome, "synchronized", retried.report);
});

test("merge synchronization drops its merges when main never settles", async (context) => {
  const { paths, github, runner, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  let attempts = 0;
  github.pushBranch = async () => {
    attempts += 1;
    await advanceMain(paths, `later-${attempts}.txt`, "later\n");
    throw new PublicationBaseChangedError("advanced");
  };
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "failed");
  assert.equal(attempts, 3);
  await assertRestored(paths, target.commit);
});

test("merge synchronization redoes the merge a restart left unpublished", async (context) => {
  const { paths, runner, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  const worktree = topicWorktreePath(paths);
  await git(worktree, ["fetch", "origin", "main"]);
  await git(worktree, ["merge", "--no-ff", "--no-edit", "origin/main"]);
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "synchronized", result.report);
  assert.equal(
    await git(worktree, ["rev-parse", "HEAD^"]),
    target.commit,
    "the interrupted merge is not part of the published history",
  );
});

test("merge synchronization reports and keeps the work a failed turn left", async (context) => {
  const { paths, github, runner, turn, target } = await boundTopic(context);
  turn.model = async ({ worktreePath }) => {
    writeFileSync(join(worktreePath, "topic.txt"), "unpublished\n");
    return { text: "SUMMARY: feat(tools): change synthetic content" };
  };
  turn.gateExitCode = 1;
  await runner(request({ updateIdentifier: 1002 }));
  await advanceMain(paths, "main-change.txt", "main\n");
  const worktree = topicWorktreePath(paths);
  const localHead = await git(worktree, ["rev-parse", "HEAD"]);
  assert.notEqual(localHead, target.commit);
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.reason, "unpublishedLocalWork");
  assert.equal(result.report, instructionReports.unpublishedLocalWork);
  assert.equal(await git(worktree, ["rev-parse", "HEAD"]), localHead);
  assert.deepEqual(github.pushes, []);
});

// A private review that never gets approved and pins what it last prepared.
function pendingReview() {
  const review = {
    tainted: false,
    prepared: null,
    ensure: () => {},
    isTainted: () => review.tainted,
    prepare: (jobId, candidate) => {
      review.prepared = candidate;
      return "synthetic-review";
    },
    isApproved: () => false,
    status: () => ({
      reviewId: review.prepared === null ? null : "synthetic-review",
    }),
    candidate: () => review.prepared,
  };
  return review;
}

async function reviewedTopic(context) {
  const researchReview = pendingReview();
  const topic = await boundTopic(context, { researchReview });
  topic.github.researchCandidate = async ({ worktree, ...metadata }) => ({
    ...metadata,
    commit: await git(worktree.path, ["rev-parse", "HEAD"]),
    expectedHead: topic.target.commit,
  });
  researchReview.tainted = true;
  await advanceMain(topic.paths, "main-change.txt", "main\n");
  return { ...topic, researchReview };
}

test("merge synchronization keeps the commit a private review pins", async (context) => {
  const { paths, runner, target } = await reviewedTopic(context);
  const review = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(review.outcome, "research_review_required", review.report);
  const worktree = topicWorktreePath(paths);
  const reviewed = await git(worktree, ["rev-parse", "HEAD"]);
  assert.notEqual(reviewed, target.commit);
  const again = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(again.reason, "unpublishedLocalWork");
  assert.equal(await git(worktree, ["rev-parse", "HEAD"]), reviewed);
});

test("merge synchronization redoes a merge no private review pins", async (context) => {
  const { paths, runner, target, researchReview } =
    await reviewedTopic(context);
  researchReview.prepared = { commit: target.commit };
  const worktree = topicWorktreePath(paths);
  await git(worktree, ["fetch", "origin", "main"]);
  await git(worktree, ["merge", "--no-ff", "--no-edit", "origin/main"]);
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "research_review_required", result.report);
});

// The state a process stopped during the conflict turn leaves behind.
async function interruptedMerge(context, runnerOptions) {
  const topic = await boundTopic(context, runnerOptions);
  await advanceMain(topic.paths, "topic.txt", "main\n");
  const worktree = topicWorktreePath(topic.paths);
  await git(worktree, ["fetch", "origin", "main"]);
  await assert.rejects(git(worktree, ["merge", "--no-ff", "origin/main"]));
  writeFileSync(join(worktree, "topic.txt"), "half resolved\n");
  return { ...topic, worktree };
}

test("merge synchronization aborts the merge a stopped process left open", async (context) => {
  const { runner, turn, target } = await interruptedMerge(context);
  turn.model = async ({ worktreePath }) => {
    writeFileSync(join(worktreePath, "topic.txt"), "main\ntopic\n");
    return { text: "Fet.\nCONFLICT_RESOLVED" };
  };
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "synchronized", result.report);
});

test("an interrupted merge with other edits goes to the maintainer", async (context) => {
  const traces = [];
  let merge;
  const { runner, worktree, target } = await interruptedMerge(context, {
    recordTrace: (trace) => traces.push(trace),
    requestMerge: (mergeCommandRequest) => merge(mergeCommandRequest),
  });
  merge = (mergeCommandRequest) =>
    runner.synchronizeForMerge(mergeCommandRequest, target);
  writeFileSync(join(worktree, "stray.txt"), "kept\n");
  const result = await runner(
    request({ updateIdentifier: 2002, instruction: "/merge" }),
  );
  assert.equal(result.report, failedMaintainerNotice);
  assert.deepEqual(
    traces
      .filter(({ action }) => action === "maintainer_attention")
      .map(({ detail }) => detail),
    ["interruptedMergeNotRecovered"],
  );
  assert.equal(readFileSync(join(worktree, "stray.txt"), "utf8"), "kept\n");
});

test("merge synchronization removes the files a failed gate left", async (context) => {
  const { paths, runner, turn, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  turn.gate = (worktreePath) => {
    writeFileSync(join(worktreePath, "gate.txt"), "x\n");
    return { exitCode: 1 };
  };
  await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(existsSync(join(topicWorktreePath(paths), "gate.txt")), false);
  await assertRestored(paths, target.commit);
});

test("merge synchronization keeps the local merge after an uncertain push", async (context) => {
  const { paths, github, runner, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  github.pushBranch = async ({ onPublicationStarted }) => {
    onPublicationStarted();
    throw new Error("Synthetic lost response.");
  };
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "uncertain");
  assert.notEqual(
    await git(topicWorktreePath(paths), ["rev-parse", "HEAD"]),
    target.commit,
  );
});

test("merge synchronization keeps the local merge beside a nested repository", async (context) => {
  const { paths, github, runner, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  const marker = join(paths.directory, "nested-marker");
  const worktree = topicWorktreePath(paths);
  github.pushBranch = async () => {
    await createNestedRepository(worktree, marker);
    await advanceMain(paths, "later.txt", "later\n");
    throw new PublicationBaseChangedError("advanced");
  };
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.report, instructionReports.publicationRefused);
  assert.notEqual(await git(worktree, ["rev-parse", "HEAD"]), target.commit);
  assert.equal(existsSync(join(worktree, "nested")), true);
});

test("merge synchronization hands the conflict question over as the model's reply", async (context) => {
  const { paths, runner, turn, target } = await boundTopic(context);
  await advanceMain(paths, "topic.txt", "main\n");
  const prepared = [];
  turn.model = async ({ worktreePrepared }) => {
    prepared.push(worktreePrepared);
    return { text: "Quina versió vols conservar?" };
  };
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.report, "Quina versió vols conservar?");
  assert.equal(result.modelAnswer, true);
  assert.deepEqual(prepared, [false]);
  await assertRestored(paths, target.commit);
});

test("reports why a bound topic cannot continue its pull request", async (context) => {
  const { paths, github, runner, target } = await boundTopic(context);
  const read = github.getPullRequest;
  github.getPullRequest = async () => ({ ...(await read()), draft: true });
  assert.equal(
    (await runner.synchronizeForMerge(mergeRequest(), target)).reason,
    "pullRequestNotContinuable",
  );
  github.getPullRequest = read;
  const worktree = topicWorktreePath(paths);
  await git(worktree, ["reset", "--hard", "origin/main"]);
  assert.equal(
    (await runner.synchronizeForMerge(mergeRequest(), target)).reason,
    "localHeadMismatch",
  );
  await git(worktree, ["checkout", "--detach"]);
  const turnResult = await runner(request({ updateIdentifier: 1002 }));
  assert.equal(turnResult.report, instructionReports.topicWorktreeMismatch);
});

test("never stores the conflict question as a service note", async (context) => {
  const paths = await fixture(context);
  const sessionNotes = noteStore(context, paths);
  let turns = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes,
    runModel: async ({ worktreePath }) => {
      turns += 1;
      if (turns === 2) return { text: "Quina versió vols conservar?" };
      writeFileSync(join(worktreePath, "README.md"), "topic change\n");
      await advanceMain(paths, "README.md", "main change\n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
  });
  const result = await runner(request());
  assert.equal(result.report, "Quina versió vols conservar?");
  assert.equal(turns, 2);
  assert.deepEqual(sessionNotes.claim(topicSessionKey), []);
});
