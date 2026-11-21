import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import {
  checkCommands,
  ciWatchOutcomes,
  publicationNoteText,
  failedMaintainerNotice,
  savedNotice,
} from "../policy/development.mjs";
import { createCiRepairExecutor } from "./ci-repair.mjs";

const repairRequest = {
  updateIdentifier: 501,
  sessionKey: "-1001234567890:7",
  pullRequestNumber: 200,
  failureFingerprint: JSON.stringify(["Validate"]),
  failedChecks: ["Validate"],
  evidence: [{ name: "Validate", detail: "src/a.ts: error TS2322" }],
  commitSha: "b".repeat(40),
  maximumAttempts: 2,
};

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-repair-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const store = new CiWatchStore(join(directory, "ci-watch.sqlite"));
  context.after(() => store.close());
  return store;
}

/** Reserve an attempt and make it claimable, as the delivered announcement does. */
function queueRepair(store, request) {
  const reserved = store.requestRepair(request);
  store.queueRepair(reserved.sequence);
  return reserved;
}

function fakeTelegram() {
  const sent = [];
  return {
    sent,
    async sendMessage(message) {
      sent.push(message);
    },
  };
}

function openPullRequest({ pullRequestNumber }) {
  return { state: "open", headSha: repairRequest.commitSha, pullRequestNumber };
}

function executorFor({
  store,
  runInstruction,
  telegram,
  logger,
  recordTrace,
  recordServiceNote = () => {},
  readPullRequest = async (options) => openPullRequest(options),
  readCiState = async () => ({
    state: "failure",
    repairable: true,
    failed: ["Validate"],
    pending: [],
    missing: [],
    ambiguous: [],
  }),
}) {
  return createCiRepairExecutor({
    repairs: store,
    runInstruction,
    readPullRequest,
    readCiState,
    telegram,
    logger,
    recordTrace,
    recordServiceNote,
  });
}

test("does not run a queued repair when live failure evidence is unavailable", async (context) => {
  const store = fixture(context);
  queueRepair(store, repairRequest);
  let executed = false;
  const executor = executorFor({
    store,
    telegram: fakeTelegram(),
    runInstruction: async () => {
      executed = true;
    },
    readCiState: async () => ({
      state: "failure",
      failed: ["Validate"],
      pending: [],
      missing: [],
      ambiguous: [],
      repairable: false,
    }),
  });
  await executor.runNext();
  assert.equal(executed, false);
});

for (const scenario of ["green", "moved", "error"]) {
  test(`rechecks the queued repair and updates its watch: ${scenario}`, async (context) => {
    const store = fixture(context);
    store.add(repairRequest);
    store.beginSend(repairRequest.updateIdentifier, "repairing");
    store.finishSend(repairRequest.updateIdentifier);
    queueRepair(store, repairRequest);
    let reads = 0;
    let executed = false;
    const executor = executorFor({
      store,
      telegram: fakeTelegram(),
      runInstruction: async () => {
        executed = true;
      },
      readPullRequest: async (options) => {
        reads += 1;
        if (scenario === "error" && reads === 2) throw new Error("network");
        return {
          ...openPullRequest(options),
          headSha:
            scenario === "moved" && reads === 2
              ? "c".repeat(40)
              : repairRequest.commitSha,
        };
      },
      readCiState: async () => ({
        state: scenario === "green" ? "success" : "failure",
        failed: [],
        pending: [],
        missing: [],
        ambiguous: [],
      }),
    });
    await executor.runNext();
    assert.equal(executed, false);
    if (scenario !== "error")
      assert.equal(
        store.lastReported(repairRequest.sessionKey).result,
        scenario === "green" ? "success" : "head-changed",
      );
    assert.equal(store.claimNextRepair(), null);
  });
}

test("a queued repair survives restart and replaces its repairing notice when CI is green", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-repair-restart-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite");
  const original = new CiWatchStore(path);
  original.add(repairRequest);
  original.beginSend(repairRequest.updateIdentifier, "repairing");
  original.finishSend(repairRequest.updateIdentifier);
  queueRepair(original, repairRequest);
  original.close();
  const store = new CiWatchStore(path);
  context.after(() => store.close());
  store.recoverSending();
  store.abortInterruptedReservations("restart");
  store.interruptRepairs();
  const executor = executorFor({
    store,
    telegram: fakeTelegram(),
    runInstruction: async () => assert.fail("green CI must not be repaired"),
    readCiState: async () => ({
      state: "success",
      failed: [],
      pending: [],
      missing: [],
      ambiguous: [],
    }),
  });
  await executor.runNext();
  assert.equal(store.lastReported(repairRequest.sessionKey).result, "success");
  assert.equal(store.state(repairRequest.updateIdentifier), "sent");
});

test("a failed green notice retains the live result as an uncertain delivery", async (context) => {
  const store = fixture(context);
  store.add(repairRequest);
  store.beginSend(repairRequest.updateIdentifier, "repairing");
  store.finishSend(repairRequest.updateIdentifier);
  queueRepair(store, repairRequest);
  const executor = executorFor({
    store,
    telegram: {
      async sendMessage() {
        throw new Error("network");
      },
    },
    runInstruction: async () => assert.fail("green CI must not be repaired"),
    readCiState: async () => ({
      state: "success",
      failed: [],
      pending: [],
      missing: [],
      ambiguous: [],
    }),
  });
  await executor.runNext();
  assert.equal(store.state(repairRequest.updateIdentifier), "uncertain");
  assert.equal(store.uncertainNotices()[0].result, "success");
  store.resolveUncertainNoticeDelivered(repairRequest.updateIdentifier);
  assert.equal(store.lastReported(repairRequest.sessionKey).result, "success");
});

test("runs a queued repair through the instruction runner and reports the publication", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const traces = [];
  const executed = [];
  const executor = executorFor({
    store,
    telegram,
    recordTrace: (entry) => traces.push(entry),
    runInstruction: async (request) => {
      executed.push(request);
      return {
        outcome: "pull_request_updated",
        report: "Pull request actualitzada: https://github.com/o/r/pull/200",
      };
    },
  });

  assert.equal(await executor.runNext(), true);
  assert.equal(await executor.runNext(), false);

  assert.deepEqual(executed, [
    {
      kind: "repair",
      updateIdentifier: repairRequest.updateIdentifier,
      sessionKey: repairRequest.sessionKey,
      pullRequestNumber: repairRequest.pullRequestNumber,
      commit: repairRequest.commitSha,
      failedChecks: repairRequest.failedChecks,
      evidence: repairRequest.evidence,
    },
  ]);
  assert.equal(store.repair(queued.sequence).status, "done");
  assert.equal(store.repair(queued.sequence).outcome, "published");
  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].chatIdentifier, -1001234567890);
  assert.equal(telegram.sent[0].messageThreadIdentifier, 7);
  assert.equal(
    telegram.sent[0].text,
    "Pull request actualitzada: https://github.com/o/r/pull/200",
  );
  assert.deepEqual(traces, [
    {
      updateIdentifier: repairRequest.updateIdentifier,
      sessionKey: repairRequest.sessionKey,
      action: "ci_repair_published",
      detail: `#200 ${"b".repeat(7)} pull_request_updated`,
    },
  ]);
});

test("keeps the service facts of a published repair and never the model's words", async (context) => {
  const store = fixture(context);
  queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const notes = [];
  const publicationNote = publicationNoteText({
    created: false,
    pullRequest: { number: 200, htmlUrl: "https://github.com/o/r/pull/200" },
    branch: "fix/tools-repair-the-synthetic-check",
    commit: "c".repeat(40),
    checkCommand: checkCommands.full,
    ciWatch: ciWatchOutcomes.registered,
  });
  const modelAnswer = "He arreglat la comprovació que fallava.";
  const executor = executorFor({
    store,
    telegram,
    recordServiceNote: (note) => notes.push(note),
    runInstruction: async () => ({
      outcome: "pull_request_updated",
      report: `${modelAnswer}\n\nEl canvi està publicat i l'estic comprovant.`,
      serviceText: publicationNote,
    }),
  });

  await executor.runNext();

  assert.equal(notes.length, 1);
  assert.equal(
    notes[0].text,
    publicationNote,
    "the note is the service-only part of the publication",
  );
  assert.match(
    notes[0].text,
    /Pull request actualitzada: #200 https:\/\/github\.com\/o\/r\/pull\/200/u,
  );
  assert.match(
    notes[0].text,
    /Branca fix\/tools-repair-the-synthetic-check, commit c{40}\./u,
  );
  assert.match(notes[0].text, /Comprovacions: pnpm check correcte\./u);
  assert.doesNotMatch(
    notes[0].text,
    /He arreglat|estic comprovant/u,
    "the model's words never become a trusted service note",
  );
  assert.match(
    telegram.sent[0].text,
    /He arreglat la comprovació que fallava/u,
    "the person still reads the model's answer",
  );
  assert.equal(notes[0].receivedText, telegram.sent[0].text);
});

test("reports a repair that published nothing instead of pretending it worked", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const executor = executorFor({
    store,
    telegram,
    runInstruction: async () => ({
      outcome: "answered",
      report: "La fallada ve d'una dependència externa; no toco el codi.",
    }),
  });

  await executor.runNext();
  await executor.runNext();

  assert.equal(store.repair(queued.sequence).status, "done");
  assert.equal(store.repair(queued.sequence).outcome, "declined");
  assert.equal(telegram.sent.length, 1);
  assert.match(
    telegram.sent[0].text,
    new RegExp(`^${failedMaintainerNotice}$`, "u"),
  );
  assert.doesNotMatch(telegram.sent[0].text, /dependència externa/u);
});

test("reports a failed repair and never retries it", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const traces = [];
  const executor = executorFor({
    store,
    telegram,
    recordTrace: (entry) => traces.push(entry),
    runInstruction: async () => ({
      outcome: "failed",
      report: "Les comprovacions del projecte fallen.",
    }),
  });

  await executor.runNext();
  await executor.runNext();

  assert.equal(store.repair(queued.sequence).status, "done");
  assert.equal(store.repair(queued.sequence).outcome, "failed");
  // A local failure never blocks the restart, unlike an unknown result.
  assert.equal(store.uncertainRepairCount(), 0);
  assert.match(
    telegram.sent[0].text,
    new RegExp(`^${failedMaintainerNotice}$`, "u"),
  );
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_not_published", "maintainer_attention"],
  );
});

test("stops a repair on the stop signal, still informs the topic and never repeats", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const controller = new AbortController();
  const sent = [];
  const traces = [];
  const executor = executorFor({
    store,
    recordTrace: (entry) => traces.push(entry),
    telegram: {
      async sendMessage(message) {
        // The real transport rejects a request whose signal is already aborted.
        assert.equal(message.signal?.aborted, undefined);
        sent.push(message);
      },
    },
    runInstruction: async () => {
      controller.abort();
      return { outcome: "failed", report: "L'execució s'ha interromput." };
    },
  });

  await executor.runNext({ signal: controller.signal });
  assert.equal(await executor.runNext(), false);

  assert.equal(store.repair(queued.sequence).status, "aborted");
  assert.equal(sent[0].text, failedMaintainerNotice);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_aborted", "maintainer_attention"],
  );
});

test("keeps an unknown repair result out of the queue", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const executor = executorFor({
    store,
    telegram,
    runInstruction: async () => {
      throw new Error("publication lost");
    },
  });

  await executor.runNext();
  await executor.runNext();

  assert.equal(store.repair(queued.sequence).status, "uncertain");
  assert.equal(store.repair(queued.sequence).outcome, "uncertain");
  assert.match(
    telegram.sent[0].text,
    new RegExp(`^${failedMaintainerNotice}$`, "u"),
  );
});

test("closes the attempt even when the report cannot be delivered", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const events = [];
  const executor = createCiRepairExecutor({
    repairs: store,
    runInstruction: async () => ({
      outcome: "pull_request_updated",
      report: "Pull request actualitzada.",
    }),
    readPullRequest: async () => openPullRequest({}),
    readCiState: async () => ({
      state: "failure",
      failed: ["Validate"],
      pending: [],
      missing: [],
      ambiguous: [],
    }),
    telegram: {
      async sendMessage() {
        throw new Error("network error");
      },
    },
    logger: (event) => events.push(event),
  });

  await executor.runNext();

  assert.equal(store.repair(queued.sequence).status, "done");
  assert.deepEqual(events, ["maintainer_attention", "ci_repair_report_failed"]);
});

test("does not start a second repair while another one is running", async (context) => {
  const store = fixture(context);
  queueRepair(store, repairRequest);
  queueRepair(store, {
    ...repairRequest,
    failureFingerprint: JSON.stringify(["Gitleaks"]),
    failedChecks: ["Gitleaks"],
  });
  store.claimNextRepair();
  const executor = executorFor({
    store,
    telegram: fakeTelegram(),
    runInstruction: async () => assert.fail("a running repair blocks the next"),
  });

  assert.equal(await executor.runNext(), false);
});

test("never repairs a pull request that was closed or moved while queued", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  let executed = false;
  const executor = executorFor({
    store,
    telegram,
    readPullRequest: async () => ({ state: "closed", headSha: "c".repeat(40) }),
    runInstruction: async () => {
      executed = true;
      return { outcome: "pull_request_updated", report: "no hauria de passar" };
    },
  });

  await executor.runNext();

  assert.equal(executed, false);
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
  assert.equal(store.repair(queued.sequence).outcome, "declined");
});

test("keeps the report of a repair as a service event of its session", async (context) => {
  const store = fixture(context);
  queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const notes = [];
  const executor = executorFor({
    store,
    telegram,
    recordServiceNote: (note) => notes.push(note),
    runInstruction: async () =>
      assert.fail("a closed pull request is repaired"),
    readPullRequest: async () => ({ state: "closed", headSha: "c".repeat(40) }),
  });

  await executor.runNext();

  assert.equal(telegram.sent.length, 1);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].sessionKey, repairRequest.sessionKey);
  assert.match(notes[0].text, /PR #200 ja no està oberta/u);
  assert.equal(notes[0].receivedText, telegram.sent[0].text);
  assert.match(
    notes[0].effectKey,
    new RegExp(
      `^repair:${repairRequest.updateIdentifier}:${repairRequest.commitSha}:.+:not_applicable$`,
      "u",
    ),
    "the identity names the attempt, never a reusable row number",
  );
  assert.match(notes[0].text, /No s.ha intentat cap reparació/u);
});

test("does not repair when the pull request state cannot be read", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const events = [];
  const executor = executorFor({
    store,
    telegram,
    logger: (event) => events.push(event),
    readPullRequest: async () => {
      throw new Error("GitHub GET pulls failed with HTTP 502.");
    },
    runInstruction: async () => assert.fail("nothing is published unverified"),
  });

  await executor.runNext();

  assert.match(
    telegram.sent[0].text,
    new RegExp(`^${failedMaintainerNotice}$`, "u"),
  );
  assert.equal(store.repair(queued.sequence).status, "done");
  assert.equal(store.repair(queued.sequence).outcome, "failed");
  assert.deepEqual(events, ["ci_repair_read_failed", "maintainer_attention"]);
});

test("informs the topic even when the private trace cannot be written", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const events = [];
  const executor = executorFor({
    store,
    telegram,
    logger: (event) => events.push(event),
    recordTrace: () => {
      throw new Error("trace unavailable");
    },
    runInstruction: async () => ({
      outcome: "pull_request_updated",
      report: "Pull request actualitzada.",
    }),
  });

  await executor.runNext();

  assert.equal(store.repair(queued.sequence).status, "done");
  assert.equal(telegram.sent.length, 1);
  assert.deepEqual(events, ["ci_trace_failed"]);
});

test("treats a stop during the pull request read as an interruption", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const controller = new AbortController();
  const sent = [];
  const traces = [];
  const executor = executorFor({
    store,
    recordTrace: (entry) => traces.push(entry),
    telegram: {
      async sendMessage(message) {
        assert.equal(message.signal?.aborted, undefined);
        sent.push(message);
      },
    },
    readPullRequest: async () => {
      controller.abort();
      throw new Error("aborted");
    },
    runInstruction: async () => assert.fail("nothing runs after a stop"),
  });

  await executor.runNext({ signal: controller.signal });
  assert.equal(await executor.runNext(), false);

  assert.equal(store.repair(queued.sequence).status, "aborted");
  assert.equal(sent[0].text, failedMaintainerNotice);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_aborted", "maintainer_attention"],
  );
});

test("does not repair a commit whose required checks no longer fail", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const traces = [];
  const executor = executorFor({
    store,
    telegram,
    recordTrace: (entry) => traces.push(entry),
    readCiState: async () => ({
      state: "success",
      failed: [],
      pending: [],
      missing: [],
      ambiguous: [],
    }),
    runInstruction: async () => assert.fail("a green commit is not repaired"),
  });

  await executor.runNext();

  assert.equal(store.repair(queued.sequence).outcome, "declined");
  assert.equal(telegram.sent[0].text, savedNotice);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_not_published"],
  );
});

test("does not repair while the failing set is still undecided", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const executor = executorFor({
    store,
    telegram,
    readCiState: async () => ({
      state: "failure",
      failed: ["Validate"],
      pending: ["Gitleaks"],
      missing: [],
      ambiguous: [],
    }),
    runInstruction: async () =>
      assert.fail("a partial CI picture is not repaired"),
  });

  await executor.runNext();

  assert.equal(store.repair(queued.sequence).outcome, "declined");
  assert.match(
    telegram.sent[0].text,
    new RegExp(`^${failedMaintainerNotice}$`, "u"),
  );
  assert.doesNotMatch(telegram.sent[0].text, /failure|pending/u);
});

test("does not repair when the CI state cannot be read", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const events = [];
  const executor = executorFor({
    store,
    telegram,
    logger: (event) => events.push(event),
    readCiState: async () => {
      throw new Error("GitHub GET check-runs failed with HTTP 502.");
    },
    runInstruction: async () => assert.fail("nothing is published unverified"),
  });

  await executor.runNext();

  assert.equal(store.repair(queued.sequence).outcome, "declined");
  assert.match(
    telegram.sent[0].text,
    new RegExp(`^${failedMaintainerNotice}$`, "u"),
  );
  assert.deepEqual(events, ["ci_repair_read_failed", "maintainer_attention"]);
});

test("treats a stop during the CI reread as an interruption", async (context) => {
  const store = fixture(context);
  const queued = queueRepair(store, repairRequest);
  const controller = new AbortController();
  const sent = [];
  const executor = executorFor({
    store,
    telegram: {
      async sendMessage(message) {
        assert.equal(message.signal?.aborted, undefined);
        sent.push(message);
      },
    },
    readCiState: async () => {
      controller.abort();
      throw new Error("aborted");
    },
    runInstruction: async () => assert.fail("nothing runs after a stop"),
  });

  await executor.runNext({ signal: controller.signal });

  assert.equal(store.repair(queued.sequence).status, "aborted");
  assert.equal(sent[0].text, failedMaintainerNotice);
});

test("informs the topic even when the attempt cannot be closed", async (context) => {
  const store = fixture(context);
  queueRepair(store, repairRequest);
  const telegram = fakeTelegram();
  const events = [];
  const traces = [];
  const executor = createCiRepairExecutor({
    repairs: {
      claimNextRepair: () => store.claimNextRepair(),
      finishRepair: () => {
        throw new Error("database is locked");
      },
    },
    runInstruction: async () => ({
      outcome: "pull_request_updated",
      report: "Pull request actualitzada.",
    }),
    readPullRequest: async ({ pullRequestNumber }) =>
      openPullRequest({ pullRequestNumber }),
    readCiState: async () => ({
      state: "failure",
      repairable: true,
      failed: ["Validate"],
      pending: [],
      missing: [],
      ambiguous: [],
    }),
    telegram,
    logger: (event) => events.push(event),
    recordTrace: (trace) => traces.push(trace),
  });

  await executor.runNext();

  assert.equal(telegram.sent.length, 1);
  assert.doesNotMatch(telegram.sent[0].text, /queden aturades/u);
  assert.deepEqual(events, ["ci_repair_close_failed"]);
  // The trace keeps the real result and the wedged queue, and the row stays
  // `running` so a restart reconciles it as uncertain and never retries it.
  assert.deepEqual(
    traces.map((trace) => trace.action),
    ["ci_repair_published", "ci_repair_close_failed"],
  );
  assert.equal(store.repair(1).status, "running");
  assert.equal(store.claimNextRepair(), null);
});

test("keeps the notes of two attempts whose row identity is reused", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-repair-notes-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  const store = fixture(context);
  const recordServiceNote = ({ sessionKey, text: noteText, effectKey }) =>
    notes.addNote({ sessionKey, text: noteText, effectKey });
  const committed = (commitSha) => async () => ({
    state: "closed",
    headSha: commitSha,
  });
  const telegram = fakeTelegram();
  const executor = (commitSha) =>
    executorFor({
      store,
      telegram,
      recordServiceNote,
      runInstruction: async () => assert.fail("a closed PR is never repaired"),
      readPullRequest: committed(commitSha),
    });

  queueRepair(store, repairRequest);
  await executor(repairRequest.commitSha).runNext();
  // The store drops the finished row; the next attempt of another commit reuses
  // the row identity `1`.
  store.resetRepairs(repairRequest.pullRequestNumber);
  const secondCommit = "c".repeat(40);
  const second = {
    ...repairRequest,
    commitSha: secondCommit,
    failureFingerprint: JSON.stringify(["Validate", "Lint"]),
    failedChecks: ["Validate", "Lint"],
  };
  queueRepair(store, second);
  assert.equal(store.repair(1).commit_sha, secondCommit);
  await executor(secondCommit).runNext();

  assert.equal(telegram.sent.length, 2);
  assert.equal(
    notes.claim(repairRequest.sessionKey).length,
    telegram.sent.length,
    "the second attempt of a reused row is its own effect",
  );
});
