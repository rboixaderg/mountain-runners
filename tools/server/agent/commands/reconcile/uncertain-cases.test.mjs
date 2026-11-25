import assert from "node:assert/strict";
import { mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { InspectableQueue as AdmissionQueue } from "../../../../../packages/telegram-pi-bridge/test/inspectable-queue.mjs";
import {
  mergeSynchronizationRequestedAction,
  reconcileResolutions,
} from "../../policy/development.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { InspectableMergeRequestStore } from "../../repository/test-support/merge-request-state.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import { PreviewRequestStore } from "../../repository/preview-request-store.mjs";
import { TopicJobStore } from "../../repository/topic-job-store.mjs";
import {
  commitAll,
  createBranch,
  ensureSessionWorktree,
  publishedCommit,
} from "../../repository/worktrees.mjs";
import {
  ReconcileCaseError,
  listUncertainCases,
  resolveUncertainCase,
} from "./uncertain-cases.mjs";
import {
  createGitRepository,
  git,
} from "../../repository/test-support/git-repository.mjs";
import { recordingTelegram } from "../../workflow/test-support/telegram.mjs";

const pullRequestNumber = 42;
const publishedCommitSha = "c".repeat(40);
const sessionKeyOne = "-1001234567890:7";
const sessionKeyTwo = "-1001234567890:8";
const privateInstruction = "synthetic private instruction";

async function fixture(context) {
  const { directory, repository } = await createGitRepository(
    context,
    "mr-agent-reconcile-",
  );
  const worktreeRoot = join(directory, "worktrees");
  const state = join(directory, "state");
  mkdirSync(state);
  // The installation has its salt: instruction cases can be attributed without
  // the command creating anything.
  openIdentifierNames(state);

  const stores = {
    instructions: new AdmissionQueue(join(state, "admission.sqlite"), {
      maxPending: 10,
    }),
    ciWatches: new CiWatchStore(join(state, "ci-watch.sqlite")),
    merges: new InspectableMergeRequestStore(
      join(state, "merge-request.sqlite"),
    ),
    previews: new PreviewRequestStore(join(state, "preview-request.sqlite")),
    topicJobs: new TopicJobStore(join(state, "topic-jobs.sqlite")),
  };
  context.after(() => {
    stores.topicJobs.close();
    stores.previews.close();
    stores.merges.close();
    stores.ciWatches.close();
    stores.instructions.close();
  });
  return {
    config: {
      paths: { repository, worktrees: worktreeRoot, state },
      github: { repository: "Example/Repository" },
    },
    stores,
    state,
    repository,
    worktreeRoot,
  };
}

// The topic worktree holds one commit on its own work branch.
async function topicWorktree({ config, sessionKey, updateIdentifier }) {
  const names = openIdentifierNames(config.paths.state);
  const worktree = await ensureSessionWorktree({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
    name: names.worktreeName(sessionKey),
  });
  const branch = `feat/agent-change-${names.changeSuffix(updateIdentifier)}`;
  await createBranch({ worktree, branch });
  writeFileSync(
    join(worktree.path, "task.txt"),
    `synthetic ${updateIdentifier}\n`,
  );
  const commit = await commitAll({
    worktree,
    message: `feat(agent): update ${updateIdentifier}`,
  });
  return { worktree, branch, commit };
}

// An instruction interrupted while it was running: the service refuses to
// start until a person resolves it.
function interruptInstruction(store, updateIdentifier, sessionKey) {
  store.admit({
    updateIdentifier,
    messageIdentifier: 1000 + updateIdentifier,
    sessionKey,
    authorIdentifier: 42,
    instruction: privateInstruction,
  });
  store.next();
  store.markUncertain(updateIdentifier, "uncertain");
}

// The store is kept open by the test; a second read-only connection reads the
// columns no store accessor exposes.
function readRow(databasePath, table, identifierColumn, identifier) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(`SELECT * FROM ${table} WHERE ${identifierColumn} = ?`)
      .get(identifier);
  } finally {
    database.close();
  }
}

// The pull request a first publication opened, on the branch of its worktree.
// It records the labels the reconciliation adds.
function publishedGithub(headRef, headSha, overrides = {}) {
  const labelled = [];
  let previewLabeled = overrides.previewLabeled ?? false;
  return {
    labelled,
    async getPullRequest() {
      return {
        state: "open",
        baseRef: "main",
        headRepository: "example/repository",
        previewRevoked: false,
        headRef,
        headSha,
        ...overrides,
        previewLabeled,
      };
    },
    async addPreviewLabel({ number }) {
      labelled.push(number);
      previewLabeled = true;
    },
  };
}

function reconcile(config, stores, telegram, command) {
  return resolveUncertainCase({
    config,
    stores,
    telegram,
    ...command,
  });
}

test("lists an uncertain instruction with its worktree and open pull request", async (context) => {
  const { config, stores } = await fixture(context);
  const { branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  let readBranch = null;
  const github = {
    async findOpenPullRequest({ branch: requestedBranch }) {
      readBranch = requestedBranch;
      return { number: pullRequestNumber, headSha: commit };
    },
  };

  const cases = await listUncertainCases({ config, stores, github });

  assert.equal(cases.length, 1);
  const [facts] = cases;
  assert.equal(readBranch, branch);
  assert.equal(facts.kind, "instruction");
  assert.equal(facts.update_identifier, 11);
  assert.equal(facts.session_key, sessionKeyOne);
  assert.ok(Date.parse(facts.created_at) > 0);
  assert.deepEqual(facts.worktree, {
    branch,
    head: commit,
    published: false,
  });
  assert.deepEqual(facts.pull_request, {
    number: pullRequestNumber,
    head_sha: commit,
  });
  assert.equal(facts.github, "ok");
  assert.doesNotMatch(JSON.stringify(facts), /synthetic private instruction/u);
});

test("marks a failed GitHub read and still lists the remaining cases", async (context) => {
  const { config, stores } = await fixture(context);
  await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  uncertainMerge(stores.merges);
  const github = {
    async findOpenPullRequest() {
      throw new Error("synthetic GitHub failure");
    },
    async getPullRequest() {
      throw new Error("synthetic GitHub failure");
    },
  };

  const cases = await listUncertainCases({ config, stores, github });

  assert.deepEqual(
    cases.map((facts) => [facts.kind, facts.github]),
    [
      ["instruction", "unavailable"],
      ["merge", undefined],
    ],
  );
  assert.notEqual(cases[0].worktree, null);
  assert.equal(cases[0].pull_request, null);
});

test("restores what a normal publication leaves when reconciling it as published", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = recordingTelegram();
  const github = publishedGithub(branch, commit);

  const resolved = await reconcile(config, stores, telegram, {
    github,
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    commit,
    pullRequestNumber: 42,
  });

  assert.equal(resolved.commit, commit);
  assert.equal(resolved.pullRequestNumber, 42);
  // The confirmed publication is followed again, so the topic receives its
  // notice before anything can resolve from the older one.
  const [watch] = stores.ciWatches.pending();
  assert.equal(watch.update_identifier, 11);
  assert.equal(watch.session_key, sessionKeyOne);
  assert.equal(watch.pull_request_number, 42);
  assert.equal(watch.commit_sha, commit);
  assert.deepEqual(github.labelled, [42]);
  assert.deepEqual(stores.topicJobs.bindingOf(sessionKeyOne), {
    branch,
    pullRequestNumber: 42,
  });
  // The preview is followed, so its delivered notice lets `/merge` pin.
  const [preview] = stores.previews.awaiting();
  assert.equal(preview.update_identifier, 11);
  assert.equal(preview.session_key, sessionKeyOne);
  assert.equal(preview.author_identifier, 42);
  assert.equal(preview.pull_request_number, 42);
  assert.equal(preview.commit_sha, commit);
  assert.equal(preview.merge_synchronization, 0);
  assert.equal(stores.instructions.status(11), "done");
  assert.equal(
    readRow(
      join(config.paths.state, "admission.sqlite"),
      "instructions",
      "update_identifier",
      11,
    ).outcome,
    "reconciled_published",
  );
  assert.equal(publishedCommit(worktree), commit);
  assert.equal(telegram.sent.length, 1);
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled"],
  );
});

test("never labels again the pull request a topic is already bound to", async (context) => {
  const { config, stores } = await fixture(context);
  const { branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  stores.topicJobs.bind({
    sessionKey: sessionKeyOne,
    branch,
    pullRequestNumber: 42,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  // No GitHub client: a continuation reads and labels nothing.
  await reconcile(config, stores, recordingTelegram(), {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    pullRequestNumber: 42,
    commit,
  });

  assert.equal(stores.previews.awaiting().length, 1);
});

test("refuses another pull request for a bound topic before writing anything", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  stores.topicJobs.bind({
    sessionKey: sessionKeyOne,
    branch,
    pullRequestNumber: 42,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await assert.rejects(
    reconcile(config, stores, recordingTelegram(), {
      kind: "instruction",
      updateIdentifier: 11,
      resolution: reconcileResolutions.published,
      pullRequestNumber: 43,
      commit,
    }),
    /bound to pull request #42, not #43/u,
  );

  assert.equal(stores.instructions.status(11), "uncertain");
  assert.deepEqual(stores.ciWatches.pending(), []);
  assert.deepEqual(stores.previews.awaiting(), []);
  assert.equal(publishedCommit(worktree), null);
});

for (const [name, overrides, message] of [
  [
    "comes from a fork",
    { headRepository: "someone/repository" },
    /configured repository/u,
  ],
  ["targets another base", { baseRef: "release" }, /does not target main/u],
  ["is closed", { state: "closed" }, /is not open/u],
  ["has its preview revoked", { previewRevoked: true }, /revoked/u],
  ["has moved its head", { headSha: "f".repeat(40) }, /has moved/u],
]) {
  test(`neither labels nor binds a first publication that ${name}`, async (context) => {
    const { config, stores } = await fixture(context);
    const { branch, commit } = await topicWorktree({
      config,
      sessionKey: sessionKeyOne,
      updateIdentifier: 11,
    });
    interruptInstruction(stores.instructions, 11, sessionKeyOne);
    const github = publishedGithub(branch, commit, overrides);

    await assert.rejects(
      reconcile(config, stores, recordingTelegram(), {
        github,
        kind: "instruction",
        updateIdentifier: 11,
        resolution: reconcileResolutions.published,
        pullRequestNumber: 42,
        commit,
      }),
      message,
    );

    assert.deepEqual(github.labelled, []);
    assert.equal(stores.topicJobs.bindingOf(sessionKeyOne), null);
    assert.deepEqual(stores.ciWatches.pending(), []);
    assert.equal(stores.instructions.status(11), "uncertain");
  });
}

test("keeps a first publication uncertain until its label and branch are confirmed", async (context) => {
  const { config, stores } = await fixture(context);
  const { branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const command = {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    pullRequestNumber: 42,
    commit,
  };

  await assert.rejects(
    reconcile(config, stores, recordingTelegram(), {
      ...command,
      github: publishedGithub("feat/agent-another-topic", commit),
    }),
    ReconcileCaseError,
  );
  await assert.rejects(
    reconcile(config, stores, recordingTelegram(), {
      ...command,
      github: {
        ...publishedGithub(branch, commit),
        async addPreviewLabel() {
          throw new Error("synthetic label failure");
        },
      },
    }),
    /synthetic label failure/u,
  );

  assert.equal(stores.instructions.status(11), "uncertain");
  assert.equal(stores.topicJobs.bindingOf(sessionKeyOne), null);
  assert.deepEqual(stores.ciWatches.pending(), []);
  assert.deepEqual(stores.previews.awaiting(), []);

  const labelled = publishedGithub(branch, commit, { previewLabeled: true });
  await reconcile(config, stores, recordingTelegram(), {
    ...command,
    github: labelled,
  });
  assert.deepEqual(labelled.labelled, []);
  assert.equal(stores.instructions.status(11), "done");
});

test("restarts preview tracking after reconciling a synchronization push", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  stores.instructions.recordTrace({
    updateIdentifier: 11,
    sessionKey: sessionKeyOne,
    authorIdentifier: 555,
    action: mergeSynchronizationRequestedAction,
    detail: "#42 aaaaaaa",
  });
  const recovered = {
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
    pullRequestNumber: 42,
    commitSha: commit,
  };

  await reconcile(config, stores, recordingTelegram(), {
    github: publishedGithub(branch, commit),
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    pullRequestNumber: 42,
    commit,
  });

  assert.equal(publishedCommit(worktree), commit);
  const [preview] = stores.previews.awaiting();
  assert.equal(preview.commit_sha, commit);
  assert.equal(preview.pull_request_number, 42);
  assert.equal(preview.merge_synchronization, 1);
  assert.equal(stores.previews.deliveredPublicationPreview(recovered), null);
});

test("ends the older synchronization a reconciled publication replaced", async (context) => {
  const { config, stores } = await fixture(context);
  const { branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  stores.previews.track({
    updateIdentifier: 10,
    sessionKey: sessionKeyOne,
    authorIdentifier: 555,
    pullRequestNumber: 42,
    commitSha: "a".repeat(40),
    mergeSynchronization: true,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await reconcile(config, stores, recordingTelegram(), {
    github: publishedGithub(branch, commit),
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    pullRequestNumber: 42,
    commit,
  });

  assert.equal(stores.previews.state(10), "failed");
  assert.deepEqual(
    stores.previews.awaiting().map((row) => row.update_identifier),
    [11],
  );
});

test("keeps the instruction uncertain when the CI watch of the publication cannot be written", async (context) => {
  const { config, stores } = await fixture(context);
  const { branch } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await assert.rejects(
    reconcile(config, { ...stores, ciWatches: null }, recordingTelegram(), {
      github: publishedGithub(branch, publishedCommitSha),
      kind: "instruction",
      updateIdentifier: 11,
      resolution: reconcileResolutions.published,
      commit: publishedCommitSha,
      pullRequestNumber: 42,
    }),
    { message: /CI watch database is missing/u },
  );
  assert.equal(stores.instructions.status(11), "uncertain");

  await assert.rejects(
    reconcile(
      config,
      {
        ...stores,
        ciWatches: {
          state: () => undefined,
          add() {
            throw new Error("state volume full");
          },
        },
      },
      recordingTelegram(),
      {
        github: publishedGithub(branch, publishedCommitSha),
        kind: "instruction",
        updateIdentifier: 11,
        resolution: reconcileResolutions.published,
        commit: publishedCommitSha,
        pullRequestNumber: 42,
      },
    ),
    { message: /state volume full/u },
  );
  assert.equal(stores.instructions.status(11), "uncertain");
  assert.deepEqual(stores.instructions.traceEntries(), []);
});

test("keeps the instruction uncertain when the publication marker cannot be written", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = recordingTelegram();
  const marker = join(worktree.gitDirectory, "agent-published-head");
  mkdirSync(marker);

  await assert.rejects(
    reconcile(config, stores, telegram, {
      github: publishedGithub(branch, commit),
      kind: "instruction",
      updateIdentifier: 11,
      resolution: reconcileResolutions.published,
      commit,
      pullRequestNumber: 42,
    }),
  );
  assert.equal(stores.instructions.status(11), "uncertain");
  assert.deepEqual(telegram.sent, []);
  assert.deepEqual(stores.instructions.traceEntries(), []);

  rmdirSync(marker);
  assert.equal(publishedCommit(worktree), null);
  await reconcile(config, stores, telegram, {
    github: publishedGithub(branch, commit),
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    commit,
    pullRequestNumber: 42,
  });
  assert.equal(stores.instructions.status(11), "done");
  assert.equal(publishedCommit(worktree), commit);
  // The retry reused the watch the first attempt wrote instead of failing.
  assert.deepEqual(
    stores.ciWatches.pending().map((row) => row.update_identifier),
    [11],
  );
  assert.equal(telegram.sent.length, 1);
});

test("records no publication when the confirmed commit is not the worktree head", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await reconcile(config, stores, recordingTelegram(), {
    github: publishedGithub(branch, publishedCommitSha),
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    commit: publishedCommitSha,
    pullRequestNumber: 42,
  });

  assert.equal(stores.instructions.status(11), "done");
  assert.equal(publishedCommit(worktree), null);
  assert.notEqual(commit, publishedCommitSha);
});

test("resolves a not published instruction and keeps the local work", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await reconcile(config, stores, recordingTelegram(), {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.notPublished,
  });

  const instruction = readRow(
    join(config.paths.state, "admission.sqlite"),
    "instructions",
    "update_identifier",
    11,
  );
  assert.equal(instruction.status, "done");
  assert.equal(instruction.outcome, "reconciled_not_published");
  assert.equal(instruction.instruction, privateInstruction);
  assert.equal(publishedCommit(worktree), null);
  assert.equal(await git(worktree.path, ["rev-parse", "HEAD"]), commit);
});

test("keeps the instruction uncertain when its trace cannot be written", async (context) => {
  const { config, stores, state } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = recordingTelegram();
  const database = new DatabaseSync(join(state, "admission.sqlite"));
  database.exec("DROP TABLE trace");
  database.close();

  await assert.rejects(
    reconcile(config, stores, telegram, {
      kind: "instruction",
      updateIdentifier: 11,
      resolution: reconcileResolutions.notPublished,
    }),
  );
  assert.equal(stores.instructions.status(11), "uncertain");
  assert.deepEqual(telegram.sent, []);
});

function uncertainMerge(store, updateIdentifier = 60) {
  store.begin({
    updateIdentifier,
    sessionKey: sessionKeyOne,
    authorIdentifier: 42,
    pullRequestNumber,
    commitSha: "d".repeat(40),
  });
  store.markUncertain(updateIdentifier);
  return updateIdentifier;
}

function githubWith(pullRequest) {
  return {
    async getPullRequest() {
      return pullRequest;
    },
  };
}

test("lists an uncertain merge", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainMerge(stores.merges);

  const [facts] = await listUncertainCases({ config, stores, github: {} });

  assert.deepEqual(facts, {
    kind: "merge",
    update_identifier: updateIdentifier,
    session_key: sessionKeyOne,
    created_at: facts.created_at,
    pull_request_number: pullRequestNumber,
    commit: "d".repeat(40),
  });
});

test("closes an uncertain merge as merged when GitHub shows it merged", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainMerge(stores.merges);
  const telegram = recordingTelegram();

  await resolveUncertainCase({
    config,
    stores,
    telegram,
    github: githubWith({
      merged: true,
      headSha: "d".repeat(40),
      mergeCommitSha: "e".repeat(40),
    }),
    kind: "merge",
    updateIdentifier,
    resolution: reconcileResolutions.merged,
  });

  assert.equal(stores.merges.state(updateIdentifier), "merged");
  assert.deepEqual(stores.merges.uncertain(), []);
  assert.deepEqual(telegram.sent, []);
  const trace = stores.instructions
    .traceEntries()
    .find((entry) => entry.action === "uncertain_reconciled");
  assert.equal(trace.detail, `merge merged #${pullRequestNumber} ddddddd`);
});

test("closes an uncertain merge as not merged when GitHub shows it unmerged", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainMerge(stores.merges);

  await resolveUncertainCase({
    config,
    stores,
    telegram: recordingTelegram(),
    github: githubWith({ merged: false, state: "open" }),
    kind: "merge",
    updateIdentifier,
    resolution: reconcileResolutions.notMerged,
  });

  assert.equal(stores.merges.state(updateIdentifier), "not_merged");
  assert.deepEqual(stores.merges.uncertain(), []);
});

test("refuses an uncertain merge resolution that GitHub contradicts", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainMerge(stores.merges);

  await assert.rejects(
    resolveUncertainCase({
      config,
      stores,
      telegram: recordingTelegram(),
      github: githubWith({
        merged: true,
        headSha: "d".repeat(40),
        mergeCommitSha: "e".repeat(40),
      }),
      kind: "merge",
      updateIdentifier,
      resolution: reconcileResolutions.notMerged,
    }),
    ReconcileCaseError,
  );
  assert.equal(stores.merges.state(updateIdentifier), "uncertain");
});

test("refuses an uncertain merge whose pull request merged another head", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainMerge(stores.merges);

  await assert.rejects(
    resolveUncertainCase({
      config,
      stores,
      telegram: recordingTelegram(),
      github: githubWith({
        merged: true,
        headSha: "a".repeat(40),
        mergeCommitSha: "e".repeat(40),
      }),
      kind: "merge",
      updateIdentifier,
      resolution: reconcileResolutions.merged,
    }),
    /different head/u,
  );
  assert.equal(stores.merges.state(updateIdentifier), "uncertain");
});

test("refuses a case that is no longer uncertain", async (context) => {
  const { config, stores } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = recordingTelegram();
  const command = {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.notPublished,
  };

  await reconcile(config, stores, telegram, command);

  await assert.rejects(
    reconcile(config, stores, telegram, command),
    ReconcileCaseError,
  );
  assert.equal(telegram.sent.length, 1);
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled"],
  );
});

test("traces each resolution without the instruction text and notifies once per topic", async (context) => {
  const { config, stores } = await fixture(context);
  const { branch, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = recordingTelegram();

  await reconcile(config, stores, telegram, {
    github: publishedGithub(branch, commit),
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    commit,
    pullRequestNumber: 42,
  });
  interruptInstruction(stores.instructions, 12, sessionKeyTwo);
  await reconcile(config, stores, telegram, {
    kind: "instruction",
    updateIdentifier: 12,
    resolution: reconcileResolutions.notPublished,
  });

  const reconciled = stores.instructions
    .traceEntries()
    .filter((entry) => entry.action === "uncertain_reconciled");
  assert.deepEqual(
    reconciled.map((entry) => entry.detail),
    [
      `instruction published #${pullRequestNumber} ${commit.slice(0, 7)}`,
      "instruction not_published",
    ],
  );
  assert.deepEqual(
    reconciled.map((entry) => entry.session_key),
    [sessionKeyOne, sessionKeyTwo],
  );
  for (const entry of stores.instructions.traceEntries()) {
    assert.doesNotMatch(entry.detail ?? "", /synthetic private instruction/u);
    assert.equal(entry.author_identifier, null);
  }
  assert.deepEqual(
    telegram.sent.map((message) => [
      message.chatIdentifier,
      message.messageThreadIdentifier,
    ]),
    [
      [-1001234567890, 7],
      [-1001234567890, 8],
    ],
  );
  for (const message of telegram.sent) {
    assert.match(
      message.text,
      /^Ja està resolt el que havia quedat a mitges:/u,
    );
    assert.doesNotMatch(message.text, /comentari publicat|GitHub/u);
  }
  assert.equal(new Set(telegram.sent.map((message) => message.text)).size, 2);
});

test("keeps the resolution and traces the failure when the notice cannot be sent", async (context) => {
  const { config, stores } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const warnings = [];
  const telegram = {
    async sendMessage() {
      throw new Error("synthetic Telegram failure");
    },
  };

  const resolved = await reconcile(config, stores, telegram, {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.notPublished,
    warn: (message) => warnings.push(message),
  });

  assert.equal(resolved.updateIdentifier, 11);
  assert.deepEqual(stores.instructions.uncertain(), []);
  assert.equal(warnings.length, 1);
  assert.deepEqual(
    stores.instructions
      .traceEntries()
      .map((entry) => entry.action)
      .filter((action) => action.startsWith("uncertain_reconciled")),
    ["uncertain_reconciled", "uncertain_reconciled_notice_failed"],
  );
});

test("refuses a resolution that does not belong to the case kind", async (context) => {
  const { config, stores } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await assert.rejects(
    reconcile(config, stores, recordingTelegram(), {
      kind: "instruction",
      updateIdentifier: 11,
      resolution: reconcileResolutions.merged,
    }),
    ReconcileCaseError,
  );
  assert.equal(stores.instructions.uncertain().length, 1);
});

test("the service startup check no longer refuses once every case is resolved", async (context) => {
  const { config, stores } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = recordingTelegram();

  await reconcile(config, stores, telegram, {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.notPublished,
  });

  // The counts the startup check reads, after its own recovery step.
  assert.equal(stores.instructions.recover(), 0);
  assert.deepEqual(stores.instructions.uncertain(), []);
});

test("lists every case when one worktree cannot be read", async (context) => {
  const { config, stores } = await fixture(context);
  const broken = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  // A damaged worktree: its Git directory is gone.
  rmSync(join(broken.worktree.path, ".git"), { recursive: true, force: true });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  uncertainMerge(stores.merges);
  const github = {
    async findOpenPullRequest() {
      return null;
    },
  };

  const cases = await listUncertainCases({ config, stores, github });

  assert.equal(cases.length, 2);
  const brokenCase = cases.find((entry) => entry.kind === "instruction");
  assert.ok(brokenCase.worktree_error !== null);
  assert.equal(brokenCase.worktree, null);
  assert.ok(cases.some((entry) => entry.kind === "merge"));
});
