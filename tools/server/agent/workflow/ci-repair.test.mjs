import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
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
  readPullRequest = async (options) => openPullRequest(options),
  readCiState = async () => ({
    state: "failure",
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
  });
}

test("runs a queued repair through the instruction runner and reports the publication", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
    "Reparació automàtica publicada (PR #200):\nPull request actualitzada: https://github.com/o/r/pull/200",
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

test("reports a repair that published nothing instead of pretending it worked", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(telegram.sent[0].text, /No s'ha publicat cap canvi automàtic/u);
  assert.match(telegram.sent[0].text, /dependència externa/u);
});

test("reports a failed repair and never retries it", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(telegram.sent[0].text, /no ha publicat cap canvi/u);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_not_published"],
  );
});

test("stops a repair on the stop signal, still informs the topic and never repeats", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(sent[0].text, /s'ha interromput/u);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_aborted"],
  );
});

test("keeps an unknown repair result out of the queue", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(telegram.sent[0].text, /No s'ha pogut confirmar/u);
});

test("closes the attempt even when the report cannot be delivered", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.deepEqual(events, ["ci_repair_report_failed"]);
});

test("does not start a second repair while another one is running", async (context) => {
  const store = fixture(context);
  store.requestRepair(repairRequest);
  store.requestRepair({
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
  const queued = store.requestRepair(repairRequest);
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
  assert.match(telegram.sent[0].text, /ja no està oberta/u);
  assert.equal(store.repair(queued.sequence).outcome, "declined");
});

test("does not repair when the pull request state cannot be read", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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

  assert.match(telegram.sent[0].text, /No s'ha pogut llegir l'estat de la PR/u);
  assert.equal(store.repair(queued.sequence).status, "done");
  assert.equal(store.repair(queued.sequence).outcome, "failed");
  assert.deepEqual(events, ["ci_repair_read_failed"]);
});

test("informs the topic even when the private trace cannot be written", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  const queued = store.requestRepair(repairRequest);
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
  assert.match(sent[0].text, /s'ha interromput/u);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_aborted"],
  );
});

test("does not repair a commit whose required checks no longer fail", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(telegram.sent[0].text, /ja hi són en verd/u);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_not_published"],
  );
});

test("does not repair while the failing set is still undecided", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(telegram.sent[0].text, /encara no és concloent/u);
  assert.doesNotMatch(telegram.sent[0].text, /failure|pending/u);
});

test("does not repair when the CI state cannot be read", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(telegram.sent[0].text, /No s'ha pogut llegir l'estat/u);
  assert.deepEqual(events, ["ci_repair_read_failed"]);
});

test("treats a stop during the CI reread as an interruption", async (context) => {
  const store = fixture(context);
  const queued = store.requestRepair(repairRequest);
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
  assert.match(sent[0].text, /s'ha interromput/u);
});

test("informs the topic even when the attempt cannot be closed", async (context) => {
  const store = fixture(context);
  store.requestRepair(repairRequest);
  const telegram = fakeTelegram();
  const events = [];
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
      failed: ["Validate"],
      pending: [],
      missing: [],
      ambiguous: [],
    }),
    telegram,
    logger: (event) => events.push(event),
  });

  await executor.runNext();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /Reparació automàtica publicada/u);
  assert.deepEqual(events, ["ci_repair_close_failed"]);
});
