import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { runBridgeWithCiWatcher, startService } from "./main.mjs";

function environmentFor(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-service-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return {
    directory,
    environment: {
      MOUNTAIN_AGENT_REPOSITORY: "rboixaderg/mountain-runners",
      MOUNTAIN_AGENT_TELEGRAM_GROUP_ID: "-1001234567890",
      MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME: "mountain_agent_bot",
      MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN: "telegram-token",
      MOUNTAIN_AGENT_GITHUB_TOKEN: "github-token",
      MOUNTAIN_AGENT_REQUIRED_CHECKS: "Validate",
      MOUNTAIN_AGENT_SANDBOX_IMAGE: "mountain-agent-pi:1.5.0",
      MOUNTAIN_AGENT_REPOSITORY_PATH: join(directory, "repository"),
      MOUNTAIN_AGENT_WORKTREE_PATH: join(directory, "worktrees"),
      MOUNTAIN_AGENT_SESSION_PATH: join(directory, "sessions"),
      MOUNTAIN_AGENT_STATE_PATH: join(directory, "state"),
    },
    statePath: join(directory, "state"),
  };
}

function telegramStub(username = "mountain_agent_bot") {
  return {
    async getMe() {
      return { id: 999, username };
    },
  };
}

test("stops the CI watcher even when the bridge fails without an abort", async () => {
  const controller = new AbortController();
  let stopped = false;
  const ciWorker = {
    async run({ signal }) {
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      stopped = true;
    },
  };
  const bridge = {
    async run() {
      throw new Error("queue failure");
    },
  };

  await assert.rejects(
    runBridgeWithCiWatcher({
      bridge,
      ciWorker,
      signal: controller.signal,
      abort: () => controller.abort(),
      logger: () => {},
    }),
    { message: /queue failure/u },
  );
  assert.equal(stopped, true);
});

test("keeps the bridge running when the watcher fails", async () => {
  const controller = new AbortController();
  const events = [];
  const ciWorker = {
    async run() {
      throw new Error("watcher defect");
    },
  };
  const bridge = {
    async run() {
      controller.abort();
    },
  };

  await runBridgeWithCiWatcher({
    bridge,
    ciWorker,
    signal: controller.signal,
    abort: () => controller.abort(),
    logger: (event) => events.push(event),
  });
  assert.deepEqual(events, ["ci_watch_worker_failed"]);
});

test("starts the bridge with the configured bot and an empty queue", async (context) => {
  const { environment } = environmentFor(context);
  const service = await startService({
    environment,
    telegram: telegramStub(),
    github: {},
    runner: async () => ({ outcome: "answered", report: "ok" }),
  });

  assert.equal(service.config.telegram.groupIdentifier, "-1001234567890");
  assert.deepEqual(service.config.github.requiredChecks, ["Validate"]);
  assert.deepEqual(service.ciWatches.pending(), []);
  service.ciWatches.close();
  service.queue.close();
});

test("refuses a bot token that belongs to another username", async (context) => {
  const { environment } = environmentFor(context);

  await assert.rejects(
    startService({
      environment,
      telegram: telegramStub("another_bot"),
      github: {},
      runner: async () => ({}),
    }),
    { message: /does not match the bot username/u },
  );
});

test("keeps an interrupted CI notice uncertain and still starts", async (context) => {
  const { environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  const ciWatches = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  ciWatches.add({
    updateIdentifier: 10,
    sessionKey: "-1001234567890:7",
    pullRequestNumber: 200,
    commitSha: "a".repeat(40),
  });
  assert.equal(ciWatches.beginSend(10, "success"), true);
  ciWatches.close();

  const events = [];
  const service = await startService({
    environment,
    telegram: telegramStub(),
    github: {},
    runner: async () => ({}),
    logger: (event, detail) => events.push({ event, detail }),
  });

  assert.ok(
    events.some(
      ({ event, detail }) =>
        event === "ci_notification_uncertain" && detail === "1",
    ),
  );
  assert.deepEqual(service.ciWatches.pending(), []);
  assert.equal(service.ciWatches.state(10), "uncertain");
  const trace = service.queue
    .traceEntries()
    .find((entry) => entry.action === "ci_notification_uncertain");
  assert.equal(trace.update_identifier, 10);
  assert.equal(trace.session_key, "-1001234567890:7");
  assert.equal(trace.detail, `#200 ${"a".repeat(7)}`);
  service.ciWatches.close();
  service.queue.close();
});

test("notifies CI only when the configured required checks are green", async (context) => {
  const { environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  const commit = "a".repeat(40);
  const ciWatches = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  ciWatches.add({
    updateIdentifier: 10,
    sessionKey: "-1001234567890:7",
    pullRequestNumber: 200,
    commitSha: commit,
  });
  ciWatches.close();

  const gitleaks = {
    name: "Gitleaks",
    status: "completed",
    conclusion: "success",
  };
  const validate = {
    name: "Validate",
    status: "completed",
    conclusion: "success",
  };
  let checkRuns = [gitleaks];
  const sent = [];
  const service = await startService({
    environment,
    telegram: {
      async getMe() {
        return { id: 999, username: "mountain_agent_bot" };
      },
      async sendMessage(message) {
        sent.push(message);
      },
    },
    github: {
      async getCommitCheckRuns() {
        return checkRuns;
      },
      async getCommitStatuses() {
        return [];
      },
      async getPullRequest() {
        return { number: 200, state: "open", headSha: commit };
      },
    },
    runner: async () => ({}),
  });
  context.after(() => {
    service.ciWatches.close();
    service.queue.close();
  });

  await service.ciWorker.runOnce();
  assert.deepEqual(sent, []);
  assert.equal(service.ciWatches.state(10), "pending");

  checkRuns = [gitleaks, validate];
  await service.ciWorker.runOnce();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(sent[0].text, /Validate\./u);
  assert.equal(service.ciWatches.state(10), "sent");
});

test("refuses to start with an interrupted instruction of unknown result", async (context) => {
  const { environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  const queue = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
  });
  queue.admit({
    updateIdentifier: 10,
    messageIdentifier: 1010,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 42,
    instruction: "tasca interrompuda",
  });
  queue.next();
  queue.close();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      startService({
        environment,
        telegram: telegramStub(),
        github: {},
        runner: async () => ({}),
      }),
      { message: /unknown external result/u },
    );
  }
});

function repairFixture(environment, statePath) {
  mkdirSync(statePath, { recursive: true });
  const ciWatches = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  const repair = ciWatches.requestRepair({
    updateIdentifier: 10,
    sessionKey: "-1001234567890:7",
    pullRequestNumber: 200,
    failureFingerprint: JSON.stringify(["Validate"]),
    failedChecks: ["Validate"],
    evidence: [{ name: "Validate", detail: "synthetic failure" }],
    commitSha: "a".repeat(40),
    maximumAttempts: 2,
  });
  ciWatches.queueRepair(repair.sequence);
  return { ciWatches, repair };
}

test("refuses to start with an interrupted CI repair of unknown result", async (context) => {
  const { environment, statePath } = environmentFor(context);
  const { ciWatches } = repairFixture(environment, statePath);
  ciWatches.claimNextRepair();
  ciWatches.close();

  await assert.rejects(
    startService({
      environment,
      telegram: telegramStub(),
      github: {},
      runner: async () => ({}),
    }),
    { message: /CI repair\(s\) have an unknown external result/u },
  );
  // The uncertainty survives later restarts until a person reconciles it.
  await assert.rejects(
    startService({
      environment,
      telegram: telegramStub(),
      github: {},
      runner: async () => ({}),
    }),
    { message: /unknown external result/u },
  );

  const queue = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
  });
  const trace = queue
    .traceEntries()
    .find((entry) => entry.action === "ci_repair_uncertain");
  assert.equal(trace.update_identifier, 10);
  assert.equal(trace.detail, `#200 ${"a".repeat(7)}`);
  queue.close();
  const reopened = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  assert.equal(reopened.claimNextRepair(), null);
  reopened.close();
});

test("runs a queued CI repair when the instruction queue is idle", async (context) => {
  const { environment, statePath } = environmentFor(context);
  const { ciWatches } = repairFixture(environment, statePath);
  ciWatches.close();
  const sent = [];
  const executed = [];
  const service = await startService({
    environment,
    telegram: {
      async getMe() {
        return { id: 999, username: "mountain_agent_bot" };
      },
      async sendMessage(message) {
        sent.push(message);
      },
    },
    github: {
      async getPullRequest() {
        return { state: "open", headSha: "a".repeat(40) };
      },
      async getCommitCheckRuns() {
        return [
          { name: "Validate", status: "completed", conclusion: "failure" },
        ];
      },
      async getCommitStatuses() {
        return [];
      },
    },
    runner: async (request) => {
      executed.push(request);
      return {
        outcome: "pull_request_updated",
        report: "Pull request actualitzada.",
      };
    },
  });

  assert.equal(await service.ciRepairExecutor.runNext(), true);
  assert.equal(await service.ciRepairExecutor.runNext(), false);
  assert.equal(executed[0].kind, "repair");
  assert.equal(executed[0].commit, "a".repeat(40));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(sent[0].text, /Reparació automàtica publicada/u);
  service.ciWatches.close();
  service.queue.close();
});

test("does not run a queued repair while the instruction queue is blocked", async (context) => {
  const { environment, statePath } = environmentFor(context);
  const { ciWatches } = repairFixture(environment, statePath);
  ciWatches.close();
  const controller = new AbortController();
  let executed = false;
  const service = await startService({
    environment,
    telegram: {
      async getMe() {
        return { id: 999, username: "mountain_agent_bot" };
      },
      async getUpdates() {
        // Yield to the timers of this test while the bridge loops.
        await new Promise((resolve) => setImmediate(resolve));
        return [];
      },
      async sendMessage() {},
    },
    github: {},
    runner: async () => {
      executed = true;
      return { outcome: "answered", report: "no hauria de passar" };
    },
  });
  // The block appears at runtime, after an external result became unknown.
  service.queue.admit({
    updateIdentifier: 20,
    messageIdentifier: 2020,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 42,
    instruction: "tasca amb resultat desconegut",
  });
  service.queue.next();
  service.queue.markUncertain(20, "publication_uncertain");
  assert.equal(service.queue.isBlocked(), true);

  const running = service.bridge.run({ signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  await running;

  assert.equal(executed, false);
  assert.equal(service.ciWatches.claimNextRepair() !== null, true);
  service.ciWatches.close();
  service.queue.close();
});

test("does not run another repair while one has an unknown result", async (context) => {
  const { environment, statePath } = environmentFor(context);
  const { ciWatches } = repairFixture(environment, statePath);
  ciWatches.close();
  let executions = 0;
  const service = await startService({
    environment,
    telegram: {
      async getMe() {
        return { id: 999, username: "mountain_agent_bot" };
      },
      async getUpdates() {
        await new Promise((resolve) => setImmediate(resolve));
        return [];
      },
      async sendMessage() {},
    },
    github: {
      async getPullRequest() {
        return { state: "open", headSha: "a".repeat(40) };
      },
      async getCommitCheckRuns() {
        return [
          { name: "Validate", status: "completed", conclusion: "failure" },
        ];
      },
      async getCommitStatuses() {
        return [];
      },
    },
    runner: async () => {
      executions += 1;
      return { outcome: "uncertain", report: "resultat desconegut" };
    },
  });
  await service.ciRepairExecutor.runNext();
  assert.equal(service.ciWatches.uncertainRepairCount(), 1);
  const secondRepair = service.ciWatches.requestRepair({
    updateIdentifier: 11,
    sessionKey: "-1001234567890:7",
    pullRequestNumber: 201,
    failureFingerprint: JSON.stringify(["Validate"]),
    failedChecks: ["Validate"],
    evidence: [],
    commitSha: "b".repeat(40),
    maximumAttempts: 2,
  });
  service.ciWatches.queueRepair(secondRepair.sequence);

  const controller = new AbortController();
  const running = service.bridge.run({ signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  await running;

  assert.equal(executions, 1);
  assert.equal(service.ciWatches.claimNextRepair() !== null, true);
  service.ciWatches.close();
  service.queue.close();
});
