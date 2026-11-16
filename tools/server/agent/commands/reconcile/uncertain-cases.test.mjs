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
import { AdmissionQueue, sessionIdentifier } from "telegram-pi-bridge/sessions";
import { reconcileResolutions } from "../../policy/development.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import {
  PreviewRequestStore,
  previewStates,
} from "../../repository/preview-request-store.mjs";
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
const failedCommit = "a".repeat(40);
const publishedCommitSha = "c".repeat(40);
const sessionKeyOne = "-1001234567890:7";
const sessionKeyTwo = "-1001234567890:8";
const sessionKeyThree = "-1001234567890:9";
const privateInstruction = "synthetic private instruction";
const requestInstant = "2026-11-14T10:00:00.000Z";
const reconcileInstant = "2026-11-14T11:00:00.000Z";

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

async function fixture(context, { previewNow } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-reconcile-"));
  const origin = join(directory, "origin.git");
  const repository = join(directory, "repository");
  const worktreeRoot = join(directory, "worktrees");
  const state = join(directory, "state");
  mkdirSync(state);

  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  const previewPath = join(state, "preview-request.sqlite");
  const stores = {
    instructions: new AdmissionQueue(join(state, "admission.sqlite"), {
      maxPending: 10,
    }),
    repairs: new CiWatchStore(join(state, "ci-watch.sqlite")),
    previews:
      previewNow === undefined
        ? new PreviewRequestStore(previewPath)
        : new PreviewRequestStore(previewPath, { now: previewNow }),
  };
  context.after(() => {
    stores.previews.close();
    stores.repairs.close();
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
async function topicWorktree({
  repository,
  worktreeRoot,
  sessionKey,
  updateIdentifier,
}) {
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: sessionIdentifier(sessionKey),
    newTaskIdentifier: updateIdentifier,
  });
  const branch = `feat/agent-change-${updateIdentifier}`;
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

function interruptRepair(
  store,
  sessionKey,
  { updateIdentifier = 12, commitSha = failedCommit } = {},
) {
  const requested = store.requestRepair({
    updateIdentifier,
    sessionKey,
    pullRequestNumber,
    failureFingerprint: JSON.stringify(["Validate"]),
    failedChecks: ["Validate"],
    evidence: [],
    commitSha,
    maximumAttempts: 2,
  });
  store.queueRepair(requested.sequence);
  store.claimNextRepair();
  store.interruptRepairs();
  return {
    sequence: requested.sequence,
    updateIdentifier,
    failedCommit: commitSha,
  };
}

function interruptPreview(store, updateIdentifier, sessionKey, commitSha) {
  store.begin({
    updateIdentifier,
    sessionKey,
    authorIdentifier: 42,
    pullRequestNumber,
    commitSha,
  });
  store.markUncertain(updateIdentifier);
}

// A publication whose notice may or may not have reached the topic.
function uncertainNotice(
  store,
  {
    updateIdentifier = 31,
    commitSha = "f".repeat(40),
    result = "success",
  } = {},
) {
  store.add({
    updateIdentifier,
    sessionKey: sessionKeyOne,
    pullRequestNumber,
    commitSha,
  });
  store.beginSend(updateIdentifier, result);
  store.markUncertain(updateIdentifier);
  return updateIdentifier;
}

// A finished CI notification of the pull request: resolving a repair must leave
// it exactly as it was.
function finishedWatch(store) {
  store.add({
    updateIdentifier: 12,
    sessionKey: sessionKeyOne,
    pullRequestNumber,
    commitSha: "e".repeat(40),
  });
  store.beginSend(12, "success");
  store.finishSend(12);
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
  const { config, stores, repository, worktreeRoot } = await fixture(context);
  const { branch, commit } = await topicWorktree({
    repository,
    worktreeRoot,
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

test("lists an uncertain repair with its update, sequence and failed commit", async (context) => {
  const { config, stores } = await fixture(context);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);
  let readNumber = null;
  const github = {
    async getPullRequest({ number }) {
      readNumber = number;
      return { state: "open", headSha: publishedCommitSha };
    },
  };

  const cases = await listUncertainCases({ config, stores, github });

  assert.equal(cases.length, 1);
  const [facts] = cases;
  assert.equal(readNumber, pullRequestNumber);
  assert.deepEqual(facts, {
    kind: "repair",
    update_identifier: repair.updateIdentifier,
    sequence: repair.sequence,
    session_key: sessionKeyOne,
    created_at: facts.created_at,
    pull_request_number: pullRequestNumber,
    failed_commit: failedCommit,
    pull_request: { state: "open", head_sha: publishedCommitSha },
    github: "ok",
  });
});

test("lists an uncertain preview when the service posted the comment after the request", async (context) => {
  const { config, stores } = await fixture(context, {
    previewNow: () => new Date(requestInstant),
  });
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);
  let requestedSince = null;
  const github = {
    async getAuthenticatedLogin() {
      return "mountain-agent-bot";
    },
    async listIssueComments({ number, since }) {
      assert.equal(number, pullRequestNumber);
      requestedSince = since;
      return [
        { user: { login: "someone" }, body: "/preview" },
        {
          user: { login: "mountain-agent-bot" },
          body: "/preview",
          created_at: "2026-11-14T10:00:01Z",
        },
      ];
    },
  };

  const [facts] = await listUncertainCases({ config, stores, github });

  assert.equal(facts.kind, "preview");
  assert.equal(facts.comment_found, true);
  assert.equal(facts.github, "ok");
  assert.equal(requestedSince, requestInstant);
});

test("ignores a preview comment created before the request and edited after it", async (context) => {
  const { config, stores } = await fixture(context, {
    previewNow: () => new Date(requestInstant),
  });
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);
  const github = {
    async getAuthenticatedLogin() {
      return "mountain-agent-bot";
    },
    async listIssueComments() {
      return [
        {
          user: { login: "mountain-agent-bot" },
          body: "/preview",
          created_at: "2026-11-14T09:59:59Z",
          updated_at: "2026-11-14T10:05:00Z",
        },
      ];
    },
  };

  const [facts] = await listUncertainCases({ config, stores, github });

  assert.equal(facts.comment_found, false);
});

test("ignores a preview comment created in the request's own second", async (context) => {
  const { config, stores } = await fixture(context, {
    previewNow: () => new Date(requestInstant),
  });
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);
  const github = {
    async getAuthenticatedLogin() {
      return "mountain-agent-bot";
    },
    async listIssueComments() {
      return [
        {
          user: { login: "mountain-agent-bot" },
          body: "/preview",
          created_at: "2026-11-14T10:00:00Z",
        },
      ];
    },
  };

  const [facts] = await listUncertainCases({ config, stores, github });

  assert.equal(facts.comment_found, false);
});

test("marks a failed GitHub read and still lists the remaining cases", async (context) => {
  const { config, stores, repository, worktreeRoot } = await fixture(context);
  await topicWorktree({
    repository,
    worktreeRoot,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  interruptRepair(stores.repairs, sessionKeyOne);
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);
  const github = {
    async findOpenPullRequest() {
      throw new Error("synthetic GitHub failure");
    },
    async getPullRequest() {
      throw new Error("synthetic GitHub failure");
    },
    async getAuthenticatedLogin() {
      throw new Error("synthetic GitHub failure");
    },
  };

  const cases = await listUncertainCases({ config, stores, github });

  assert.deepEqual(
    cases.map((facts) => [facts.kind, facts.github]),
    [
      ["instruction", "unavailable"],
      ["repair", "unavailable"],
      ["preview", "unavailable"],
    ],
  );
  assert.notEqual(cases[0].worktree, null);
  assert.equal(cases[0].pull_request, null);
  assert.equal(cases[1].pull_request, null);
  assert.equal(cases[2].comment_found, null);
});

test("resolves a published instruction and records the confirmed head as published", async (context) => {
  const { config, stores, repository, worktreeRoot } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    repository,
    worktreeRoot,
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
  const [watch] = stores.repairs.pending();
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

test("keeps the instruction uncertain when the CI watch of the publication cannot be written", async (context) => {
  const { config, stores } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);

  await assert.rejects(
    reconcile(config, { ...stores, repairs: null }, fakeTelegram(), {
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
        repairs: {
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
  const { config, stores, repository, worktreeRoot } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    repository,
    worktreeRoot,
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
    stores.repairs.pending().map((row) => row.update_identifier),
    [11],
  );
  assert.equal(telegram.messages.length, 1);
});

test("records no publication when the confirmed commit is not the worktree head", async (context) => {
  const { config, stores, repository, worktreeRoot } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    repository,
    worktreeRoot,
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
  const { config, stores, repository, worktreeRoot } = await fixture(context);
  const { worktree, commit } = await topicWorktree({
    repository,
    worktreeRoot,
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

test("resolves a repair without changing its CI watch", async (context) => {
  const { config, stores } = await fixture(context);
  finishedWatch(stores.repairs);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);

  await reconcile(config, stores, fakeTelegram(), {
    kind: "repair",
    updateIdentifier: repair.updateIdentifier,
    sequence: repair.sequence,
    failedCommit: repair.failedCommit,
    resolution: reconcileResolutions.published,
    commit: publishedCommitSha,
  });

  const row = stores.repairs.repair(repair.sequence);
  assert.equal(row.status, "done");
  assert.equal(row.outcome, "reconciled_published");
  assert.deepEqual(stores.repairs.pending(), []);
  assert.equal(stores.repairs.uncertainRepairCount(), 0);
  assert.equal(stores.repairs.state(12), "sent");
  const reported = stores.repairs.lastReported(sessionKeyOne);
  assert.equal(reported.pull_request_number, pullRequestNumber);
  assert.equal(reported.commit_sha, "e".repeat(40));
  assert.equal(reported.result, "success");
});

test("resolves a not published repair without changing its CI watch", async (context) => {
  const { config, stores } = await fixture(context);
  finishedWatch(stores.repairs);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);

  await reconcile(config, stores, fakeTelegram(), {
    kind: "repair",
    updateIdentifier: repair.updateIdentifier,
    sequence: repair.sequence,
    failedCommit: repair.failedCommit,
    resolution: reconcileResolutions.notPublished,
  });

  const row = stores.repairs.repair(repair.sequence);
  assert.equal(row.status, "done");
  assert.equal(row.outcome, "reconciled_not_published");
  assert.equal(stores.repairs.state(12), "sent");
  const reported = stores.repairs.lastReported(sessionKeyOne);
  assert.equal(reported.pull_request_number, pullRequestNumber);
  assert.equal(reported.commit_sha, "e".repeat(40));
  assert.equal(reported.result, "success");
});

test("refuses an older repair command when a later repair reuses its sequence", async (context) => {
  const { config, stores } = await fixture(context);
  const first = interruptRepair(stores.repairs, sessionKeyOne);
  const telegram = fakeTelegram();
  await reconcile(config, stores, telegram, {
    kind: "repair",
    updateIdentifier: first.updateIdentifier,
    sequence: first.sequence,
    failedCommit: first.failedCommit,
    resolution: reconcileResolutions.notPublished,
  });

  stores.repairs.resetRepairs(pullRequestNumber);
  const second = interruptRepair(stores.repairs, sessionKeyOne, {
    commitSha: "d".repeat(40),
  });
  assert.equal(second.sequence, first.sequence);
  assert.equal(second.failedCommit, "d".repeat(40));

  await assert.rejects(
    reconcile(config, stores, telegram, {
      kind: "repair",
      updateIdentifier: first.updateIdentifier,
      sequence: first.sequence,
      failedCommit: first.failedCommit,
      resolution: reconcileResolutions.notPublished,
    }),
    ReconcileCaseError,
  );
  assert.equal(stores.repairs.repair(second.sequence).status, "uncertain");
  assert.equal(telegram.messages.length, 1);
});

test("changes nothing when a repair has no trace database", async (context) => {
  const { config, stores } = await fixture(context);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);

  await assert.rejects(
    reconcile(config, { ...stores, instructions: null }, fakeTelegram(), {
      kind: "repair",
      updateIdentifier: repair.updateIdentifier,
      sequence: repair.sequence,
      failedCommit: repair.failedCommit,
      resolution: reconcileResolutions.notPublished,
    }),
    { message: /trace database is missing/u },
  );
  assert.equal(stores.repairs.repair(repair.sequence).status, "uncertain");
});

test("traces a repair transition that another writer won", async (context) => {
  const { config, stores } = await fixture(context);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);
  const warnings = [];
  const racingRepairs = {
    uncertainRepairs: () => stores.repairs.uncertainRepairs(),
    resolveUncertainRepair: () => null,
  };

  await assert.rejects(
    reconcile(config, { ...stores, repairs: racingRepairs }, fakeTelegram(), {
      kind: "repair",
      updateIdentifier: repair.updateIdentifier,
      sequence: repair.sequence,
      failedCommit: repair.failedCommit,
      resolution: reconcileResolutions.notPublished,
      warn: (message) => warnings.push(message),
    }),
    ReconcileCaseError,
  );
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled", "uncertain_reconcile_failed"],
  );
  assert.equal(stores.repairs.repair(repair.sequence).status, "uncertain");
});

test("keeps waiting for the publisher when the preview comment exists", async (context) => {
  const { config, stores } = await fixture(context, {
    previewNow: () => new Date(reconcileInstant),
  });
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);

  await reconcile(config, stores, fakeTelegram(), {
    kind: "preview",
    updateIdentifier: 21,
    resolution: reconcileResolutions.commented,
  });

  const request = readRow(
    join(config.paths.state, "preview-request.sqlite"),
    "preview_requests",
    "update_identifier",
    21,
  );
  assert.equal(request.state, previewStates.awaiting);
  assert.equal(request.commented_at, reconcileInstant);
  assert.equal(stores.previews.awaiting().length, 1);
});

test("ends the preview request when the comment does not exist", async (context) => {
  const { config, stores } = await fixture(context);
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);

  await reconcile(config, stores, fakeTelegram(), {
    kind: "preview",
    updateIdentifier: 21,
    resolution: reconcileResolutions.notCommented,
  });

  assert.equal(stores.previews.state(21), previewStates.failed);
  assert.deepEqual(stores.previews.awaiting(), []);
});

test("changes nothing when a preview has no trace database", async (context) => {
  const { config, stores } = await fixture(context);
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);

  await assert.rejects(
    reconcile(config, { ...stores, instructions: null }, fakeTelegram(), {
      kind: "preview",
      updateIdentifier: 21,
      resolution: reconcileResolutions.notCommented,
    }),
    { message: /trace database is missing/u },
  );
  assert.equal(stores.previews.state(21), previewStates.uncertain);
});

test("traces a preview transition that another writer won", async (context) => {
  const { config, stores } = await fixture(context);
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);
  const racingPreviews = {
    uncertain: () => stores.previews.uncertain(),
    resolveUncertainNotCommented: () => null,
  };

  await assert.rejects(
    reconcile(config, { ...stores, previews: racingPreviews }, fakeTelegram(), {
      kind: "preview",
      updateIdentifier: 21,
      resolution: reconcileResolutions.notCommented,
    }),
    ReconcileCaseError,
  );
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled", "uncertain_reconcile_failed"],
  );
  assert.equal(stores.previews.state(21), previewStates.uncertain);
});

test("lists an unknown CI notice with what it reported", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainNotice(stores.repairs);

  const cases = await listUncertainCases({
    config,
    stores,
    github: {
      async getPullRequest() {
        assert.fail("a notice needs no GitHub read");
      },
    },
  });

  assert.equal(cases.length, 1);
  const [facts] = cases;
  assert.deepEqual(facts, {
    kind: "notice",
    update_identifier: updateIdentifier,
    session_key: sessionKeyOne,
    created_at: facts.created_at,
    pull_request_number: pullRequestNumber,
    commit: "f".repeat(40),
    result: "success",
  });
});

test("closes a delivered notice without telling the topic again", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainNotice(stores.repairs);
  const telegram = fakeTelegram();

  await reconcile(config, stores, telegram, {
    kind: "notice",
    updateIdentifier,
    resolution: reconcileResolutions.delivered,
  });

  assert.equal(stores.repairs.state(updateIdentifier), "sent");
  assert.equal(stores.repairs.lastReported(sessionKeyOne).result, "success");
  assert.deepEqual(stores.repairs.pending(), []);
  // The topic already received the notice: the command sends nothing.
  assert.deepEqual(telegram.messages, []);
  const trace = stores.instructions
    .traceEntries()
    .find((entry) => entry.action === "uncertain_reconciled");
  assert.equal(trace.detail, `notice delivered #${pullRequestNumber} fffffff`);
  assert.equal(trace.session_key, sessionKeyOne);
});

test("queues an unknown notice for the ordinary worker on request", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainNotice(stores.repairs);
  const telegram = fakeTelegram();

  await reconcile(config, stores, telegram, {
    kind: "notice",
    updateIdentifier,
    resolution: reconcileResolutions.resend,
  });

  // The decision only returns the notice to the pending queue: the worker
  // sends it, not the command.
  assert.equal(stores.repairs.state(updateIdentifier), "pending");
  assert.deepEqual(
    stores.repairs.pending().map((row) => row.update_identifier),
    [updateIdentifier],
  );
  assert.deepEqual(telegram.messages, []);
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled"],
  );
});

test("changes nothing when a notice has no trace database", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainNotice(stores.repairs);

  await assert.rejects(
    reconcile(config, { ...stores, instructions: null }, fakeTelegram(), {
      kind: "notice",
      updateIdentifier,
      resolution: reconcileResolutions.delivered,
    }),
    { message: /trace database is missing/u },
  );
  assert.equal(stores.repairs.state(updateIdentifier), "uncertain");
});

test("refuses a notice that is no longer uncertain", async (context) => {
  const { config, stores } = await fixture(context);
  const updateIdentifier = uncertainNotice(stores.repairs);
  const telegram = fakeTelegram();
  const command = {
    kind: "notice",
    updateIdentifier,
    resolution: reconcileResolutions.delivered,
  };

  await reconcile(config, stores, telegram, command);

  await assert.rejects(
    reconcile(config, stores, telegram, command),
    ReconcileCaseError,
  );
  assert.equal(stores.repairs.state(updateIdentifier), "sent");
  assert.deepEqual(
    stores.instructions.traceEntries().map((entry) => entry.action),
    ["uncertain_reconciled"],
  );
});

test("refuses a case that is no longer uncertain", async (context) => {
  const { config, stores } = await fixture(context);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);
  const telegram = fakeTelegram();
  const command = {
    kind: "repair",
    updateIdentifier: repair.updateIdentifier,
    sequence: repair.sequence,
    failedCommit: repair.failedCommit,
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
  const { config, stores, repository, worktreeRoot } = await fixture(context);
  const { commit } = await topicWorktree({
    repository,
    worktreeRoot,
    sessionKey: sessionKeyOne,
    updateIdentifier: 11,
  });
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const repair = interruptRepair(stores.repairs, sessionKeyTwo);
  interruptPreview(stores.previews, 21, sessionKeyThree, failedCommit);
  const telegram = fakeTelegram();

  await reconcile(config, stores, telegram, {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    commit,
    pullRequestNumber: 42,
  });
  await reconcile(config, stores, telegram, {
    kind: "repair",
    updateIdentifier: repair.updateIdentifier,
    sequence: repair.sequence,
    failedCommit: repair.failedCommit,
    resolution: reconcileResolutions.notPublished,
  });
  await reconcile(config, stores, telegram, {
    kind: "preview",
    updateIdentifier: 21,
    resolution: reconcileResolutions.commented,
  });

  const reconciled = stores.instructions
    .traceEntries()
    .filter((entry) => entry.action === "uncertain_reconciled");
  assert.deepEqual(
    reconciled.map((entry) => entry.detail),
    [
      `instruction published #${pullRequestNumber} ${commit.slice(0, 7)}`,
      `repair not_published #${pullRequestNumber} ${failedCommit.slice(0, 7)}`,
      `preview commented #${pullRequestNumber} ${failedCommit.slice(0, 7)}`,
    ],
  );
  assert.deepEqual(
    reconciled.map((entry) => entry.session_key),
    [sessionKeyOne, sessionKeyTwo, sessionKeyThree],
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
      [-1001234567890, 9],
    ],
  );
  for (const message of telegram.messages) {
    assert.match(message.text, /^Una operació interrompuda/u);
  }
  assert.equal(
    new Set(telegram.messages.map((message) => message.text)).size,
    3,
  );
});

test("keeps the resolution and traces the failure when the notice cannot be sent", async (context) => {
  const { config, stores } = await fixture(context);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);
  const warnings = [];
  const telegram = {
    async sendMessage() {
      throw new Error("synthetic Telegram failure");
    },
  };

  const resolved = await reconcile(config, stores, telegram, {
    kind: "repair",
    updateIdentifier: repair.updateIdentifier,
    sequence: repair.sequence,
    failedCommit: repair.failedCommit,
    resolution: reconcileResolutions.notPublished,
    warn: (message) => warnings.push(message),
  });

  assert.equal(resolved.updateIdentifier, repair.updateIdentifier);
  assert.equal(stores.repairs.repair(repair.sequence).status, "done");
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
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);

  await assert.rejects(
    reconcile(config, stores, fakeTelegram(), {
      kind: "preview",
      updateIdentifier: 21,
      resolution: reconcileResolutions.published,
      commit: publishedCommitSha,
    }),
    ReconcileCaseError,
  );
  assert.equal(stores.previews.state(21), previewStates.uncertain);
});

test("the service startup check no longer refuses once every case is resolved", async (context) => {
  const { config, stores } = await fixture(context);
  interruptInstruction(stores.instructions, 11, sessionKeyOne);
  const repair = interruptRepair(stores.repairs, sessionKeyOne);
  interruptPreview(stores.previews, 21, sessionKeyOne, failedCommit);
  const telegram = fakeTelegram();

  await reconcile(config, stores, telegram, {
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.notPublished,
  });
  await reconcile(config, stores, telegram, {
    kind: "repair",
    updateIdentifier: repair.updateIdentifier,
    sequence: repair.sequence,
    failedCommit: repair.failedCommit,
    resolution: reconcileResolutions.notPublished,
  });
  await reconcile(config, stores, telegram, {
    kind: "preview",
    updateIdentifier: 21,
    resolution: reconcileResolutions.notCommented,
  });

  // The counts the startup check reads, after its own recovery step.
  assert.equal(stores.instructions.recover(), 0);
  assert.equal(stores.repairs.uncertainRepairCount(), 0);
  assert.equal(stores.previews.uncertainCount(), 0);
  assert.deepEqual(stores.instructions.uncertain(), []);
  assert.deepEqual(stores.repairs.uncertainRepairs(), []);
  assert.deepEqual(stores.previews.uncertain(), []);
});
