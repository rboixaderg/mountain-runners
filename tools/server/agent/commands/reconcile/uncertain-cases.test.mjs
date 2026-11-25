import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import {
  mergeSynchronizationRequestedAction,
  reconcileResolutions,
} from "../../policy/development.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../../repository/merge-request-store.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import { PreviewRequestStore } from "../../repository/preview-request-store.mjs";
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

const executeFile = promisify(execFile);
const pullRequestNumber = 42;
const publishedCommitSha = "c".repeat(40);
const sessionKeyOne = "-1001234567890:7";
const sessionKeyTwo = "-1001234567890:8";
const privateInstruction = "synthetic private instruction";

async function git(directory, argumentsList) {
  const { stdout } = await executeFile("git", [
    "-C",
    directory,
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.test",
    ...argumentsList,
  ]);
  return stdout.trim();
}

async function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-reconcile-"));
  const origin = join(directory, "origin.git");
  const repository = join(directory, "repository");
  const worktreeRoot = join(directory, "worktrees");
  const state = join(directory, "state");
  mkdirSync(state);
  // The installation already ran the identifier migration: instruction cases
  // can be attributed without the command creating anything.
  openIdentifierNames(state);

  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  const stores = {
    instructions: new AdmissionQueue(join(state, "admission.sqlite"), {
      maxPending: 10,
    }),
    ciWatches: new CiWatchStore(join(state, "ci-watch.sqlite")),
    merges: new MergeRequestStore(join(state, "merge-request.sqlite")),
  };
  context.after(() => {
    stores.merges.close();
    stores.ciWatches.close();
    stores.instructions.close();
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  return {
    config: { paths: { repository, worktrees: worktreeRoot, state } },
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
    newTaskSuffix: names.changeSuffix(updateIdentifier),
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

function fakeTelegram() {
  const messages = [];
  return {
    messages,
    async sendMessage({ chatIdentifier, messageThreadIdentifier, text }) {
      messages.push({ chatIdentifier, messageThreadIdentifier, text });
    },
  };
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

test("resolves a published instruction and records the confirmed head as published", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = fakeTelegram();

  const resolved = await reconcile(config, stores, telegram, {
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
  assert.equal(telegram.messages.length, 1);
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled"],
  );
});

test("restarts preview tracking after reconciling a synchronization push", async (context) => {
  const { config, stores, state } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  stores.previews = new PreviewRequestStore(
    join(state, "preview-request.sqlite"),
  );
  context.after(() => stores.previews.close());
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

  await reconcile(config, stores, fakeTelegram(), {
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

test("keeps the instruction uncertain when the CI watch of the publication cannot be written", async (context) => {
  const { config, stores } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await assert.rejects(
    reconcile(config, { ...stores, ciWatches: null }, fakeTelegram(), {
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
      fakeTelegram(),
      {
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
  const { worktree, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = fakeTelegram();
  const marker = join(worktree.gitDirectory, "agent-published-head");
  mkdirSync(marker);

  await assert.rejects(
    reconcile(config, stores, telegram, {
      kind: "instruction",
      updateIdentifier: 11,
      resolution: reconcileResolutions.published,
      commit,
      pullRequestNumber: 42,
    }),
  );
  assert.equal(stores.instructions.status(11), "uncertain");
  assert.deepEqual(telegram.messages, []);
  assert.deepEqual(stores.instructions.traceEntries(), []);

  rmdirSync(marker);
  assert.equal(publishedCommit(worktree), null);
  await reconcile(config, stores, telegram, {
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
  assert.equal(telegram.messages.length, 1);
});

test("records no publication when the confirmed commit is not the worktree head", async (context) => {
  const { config, stores } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await reconcile(config, stores, fakeTelegram(), {
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

  await reconcile(config, stores, fakeTelegram(), {
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
  const telegram = fakeTelegram();
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
  assert.deepEqual(telegram.messages, []);
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
  const telegram = fakeTelegram();

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
  assert.deepEqual(telegram.messages, []);
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
    telegram: fakeTelegram(),
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
      telegram: fakeTelegram(),
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
      telegram: fakeTelegram(),
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
  const telegram = fakeTelegram();
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
  assert.equal(telegram.messages.length, 1);
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled"],
  );
});

test("traces each resolution without the instruction text and notifies once per topic", async (context) => {
  const { config, stores } = await fixture(context);
  const { commit } = await topicWorktree({
    config,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const telegram = fakeTelegram();

  await reconcile(config, stores, telegram, {
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
    telegram.messages.map((message) => [
      message.chatIdentifier,
      message.messageThreadIdentifier,
    ]),
    [
      [-1001234567890, 7],
      [-1001234567890, 8],
    ],
  );
  for (const message of telegram.messages) {
    assert.match(
      message.text,
      /^Ja està resolt el que havia quedat a mitges:/u,
    );
    assert.doesNotMatch(message.text, /comentari publicat|GitHub/u);
  }
  assert.equal(
    new Set(telegram.messages.map((message) => message.text)).size,
    2,
  );
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
    reconcile(config, stores, fakeTelegram(), {
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
  const telegram = fakeTelegram();

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
