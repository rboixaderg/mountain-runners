import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { reconcileResolutions } from "../../policy/development.mjs";
import { resolveUncertainCase } from "../../commands/reconcile/uncertain-cases.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../../repository/merge-request-store.mjs";
import { PreviewRequestStore } from "../../repository/preview-request-store.mjs";
import { TopicJobStore } from "../../repository/topic-job-store.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import {
  createBranch,
  ensureSessionWorktree,
  recordPublication,
} from "../../repository/worktrees.mjs";
import {
  retentionIntervalMilliseconds,
  runBridgeWithCiWatcher,
  scheduleRetention,
  startService,
  stopService,
} from "./main.mjs";

const executeFile = promisify(execFile);

/** A stand-in for the Pi command that only answers `--version`. */
function fakePi(directory, version) {
  const command = join(directory, "pi");
  writeFileSync(command, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  return command;
}

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
      MOUNTAIN_AGENT_PI_COMMAND: fakePi(directory, "1.2.3"),
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
  service.closeStateStores();
});

for (const [name, preparePi, event, detail] of [
  ["records the installed Pi version", () => {}, "pi_version", /^1\.2\.3$/u],
  [
    "starts even when the Pi version cannot be read",
    (environment) => {
      environment.MOUNTAIN_AGENT_PI_COMMAND += "-missing";
    },
    "pi_version_unreadable",
    /ENOENT/u,
  ],
]) {
  test(name, async (context) => {
    const { environment } = environmentFor(context);
    preparePi(environment);
    const logged = [];
    const service = await startService({
      environment,
      logger: (...entry) => logged.push(entry),
      telegram: telegramStub(),
      github: {},
    });
    service.closeStateStores();

    const entry = logged.find(([loggedEvent]) => loggedEvent === event);
    assert.match(entry?.[1] ?? "", detail);
  });
}

test("removes the service credentials from the environment after startup", async (context) => {
  const { environment } = environmentFor(context);
  const tokenNames = Object.keys(environment).filter((name) =>
    name.endsWith("_TOKEN"),
  );
  assert.notEqual(tokenNames.length, 0);
  const service = await startService({
    environment,
    telegram: telegramStub(),
    github: {},
    runner: async () => ({ outcome: "answered", report: "ok" }),
  });

  for (const name of tokenNames) {
    assert.equal(environment[name], undefined, name);
  }
  assert.ok(service.config.github.token);
  service.closeStateStores();
});

test("closes the state stores when the bot identity cannot be read", async (context) => {
  const { environment } = environmentFor(context);

  await assert.rejects(
    startService({
      environment: { ...environment },
      telegram: {
        async getMe() {
          throw new Error("telegram is unreachable");
        },
      },
      github: {},
      runner: async () => ({}),
    }),
    { message: /telegram is unreachable/u },
  );

  // The failed start released every store: the same state opens and serves.
  const service = await startService({
    environment,
    telegram: telegramStub(),
    github: {},
    runner: async () => ({ outcome: "answered", report: "ok" }),
  });
  assert.equal(service.queue.isBlocked(), false);
  service.closeStateStores();
});

test("closes the state stores even when stopping the sandbox fails", async () => {
  let closed = false;

  await assert.rejects(
    stopService({
      stopSandboxedCommands: async () => {
        throw new Error("sandbox stop failed");
      },
      closeStateStores: () => {
        closed = true;
      },
      logger: () => {},
    }),
    { message: /sandbox stop failed/u },
  );

  assert.equal(closed, true);
});

test("runs retention periodically until the signal aborts", async () => {
  const controller = new AbortController();
  let runs = 0;
  const stop = scheduleRetention({
    runRetention: async () => {
      runs += 1;
    },
    signal: controller.signal,
    intervalMilliseconds: 5,
    logger: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(runs >= 2, `retention ran ${runs} times`);
  controller.abort();
  const settled = runs;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runs, settled, "an aborted signal stops the interval");
  stop();
});

test("logs a retention failure instead of crashing the bridge", async () => {
  const controller = new AbortController();
  const events = [];
  scheduleRetention({
    runRetention: async () => {
      throw new Error("synthetic retention failure");
    },
    signal: controller.signal,
    intervalMilliseconds: 5,
    logger: (event, detail) => events.push({ event, detail }),
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  controller.abort();

  assert.ok(
    events.some(
      ({ event, detail }) =>
        event === "retention_failed" &&
        detail === "synthetic retention failure",
    ),
  );
});

test("removes its abort listener when stopped manually", () => {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener(event, listener) {
      if (event === "abort") {
        listeners.add(listener);
      }
    },
    removeEventListener(event, listener) {
      if (event === "abort") {
        listeners.delete(listener);
      }
    },
  };
  const stop = scheduleRetention({
    runRetention: async () => {},
    signal,
    intervalMilliseconds: 1000,
    logger: () => {},
  });
  assert.equal(listeners.size, 1);

  stop();

  assert.equal(listeners.size, 0);
});

test("measures the periodic retention in hours", () => {
  assert.equal(retentionIntervalMilliseconds, 6 * 60 * 60 * 1000);
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

/**
 * The state an earlier version left behind: notices in states that are not
 * written any more, and the tables of the repairs and reruns it removed.
 */
function addLegacyCiRows(statePath) {
  const database = new DatabaseSync(join(statePath, "ci-watch.sqlite"));
  database.exec(`
    INSERT INTO ci_watches
      (update_identifier, session_key, pull_request_number, commit_sha, state,
       result, created_at, updated_at)
    VALUES
      (8, '-1001234567890:7', 200, '${"d".repeat(40)}', 'sending', 'failure',
       '2026-11-20T10:00:00.000Z', '2026-11-20T10:00:00.000Z'),
      (9, '-1001234567890:7', 200, '${"e".repeat(40)}', 'uncertain', 'repairing',
       '2026-11-20T10:00:00.000Z', '2026-11-20T10:00:00.000Z');
    CREATE TABLE ci_repairs (session_key TEXT, status TEXT);
    INSERT INTO ci_repairs VALUES
      ('-1001234567890:7', 'reserved'), ('-1001234567890:7', 'queued'),
      ('-1001234567890:7', 'running'), ('-1001234567890:7', 'uncertain');
    CREATE TABLE ci_reruns (run_identifier INTEGER PRIMARY KEY);
    INSERT INTO ci_reruns VALUES (100);
  `);
  database.close();
}

test("starts with the CI rows of an earlier version and never resends them", async (context) => {
  const { environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  new CiWatchStore(join(statePath, "ci-watch.sqlite")).close();
  addLegacyCiRows(statePath);

  const service = await startService({
    environment,
    telegram: telegramStub(),
    github: {},
    runner: async () => ({}),
  });
  context.after(() => {
    service.ciWatches.close();
    service.queue.close();
  });
  // An empty GitHub client and no `sendMessage`: nothing is read or sent.
  await service.ciWorker.runOnce();

  assert.equal(service.ciWatches.state(8), "sending");
  assert.equal(service.ciWatches.state(9), "uncertain");
  assert.equal(service.ciWatches.hasUnreportedWork("-1001234567890:7"), false);
  assert.deepEqual(service.queue.traceEntries(), []);
});

test("merges the delivered preview despite the CI rows of an earlier version", async (context) => {
  const { merges } = await runMergeCommand(context, {
    prepare: ({ config }) => addLegacyCiRows(config.paths.state),
  });

  assert.equal(merges.length, 1);
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
        return {
          number: 200,
          state: "open",
          headSha: commit,
          htmlUrl: "https://github.com/example/project/pull/200",
        };
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
  assert.deepEqual(sent, [], "the green result is not sent twice");
  assert.equal(service.ciWatches.state(10), "sent");
});

test("keeps a moved head unreported while the topic has unsettled work", async (context) => {
  const { environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  const sessionKey = "-1001234567890:7";
  const publication = { sessionKey, pullRequestNumber: 200 };
  const commitSha = "a".repeat(40);
  const ciWatches = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  ciWatches.add({ ...publication, updateIdentifier: 10, commitSha });
  ciWatches.close();
  const previews = new PreviewRequestStore(
    join(statePath, "preview-request.sqlite"),
  );
  previews.track({
    ...publication,
    updateIdentifier: 10,
    authorIdentifier: 42,
    commitSha,
    mergeSynchronization: true,
  });
  previews.close();
  const sent = [];
  const service = await startService({
    environment,
    telegram: {
      ...telegramStub(),
      async sendMessage(message) {
        sent.push(message.text);
      },
    },
    github: {
      async getCommitCheckRuns() {
        return [
          { name: "Validate", status: "completed", conclusion: "success" },
        ];
      },
      async getCommitStatuses() {
        return [];
      },
      async listIssueComments() {
        return [];
      },
      async getPullRequest() {
        return { state: "open", headSha: "b".repeat(40) };
      },
    },
    runner: async () => ({}),
  });
  context.after(() => service.closeStateStores());
  const runWorkers = async () => {
    await service.ciWorker.runOnce();
    await service.previewWorker.runOnce();
  };
  service.queue.admit({
    updateIdentifier: 11,
    messageIdentifier: 1011,
    sessionKey,
    authorIdentifier: 42,
    instruction: "canvi nou",
  });

  await runWorkers();
  service.queue.next();
  service.queue.markUncertain(11, "uncertain");
  await runWorkers();
  assert.deepEqual(sent, []);

  service.queue.resolveUncertain({
    updateIdentifier: 11,
    outcome: "reconciled",
    trace: { action: "uncertain_reconciled" },
  });
  await runWorkers();
  assert.equal(sent.length, 2);
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
        environment: { ...environment },
        telegram: telegramStub(),
        github: {},
        runner: async () => ({}),
      }),
      { message: /unknown external result/u },
    );
  }
});

test("completes every local recovery before refusing the start", async (context) => {
  const { environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  const queue = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
  });
  queue.admit({
    updateIdentifier: 20,
    messageIdentifier: 2020,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 42,
    instruction: "synthetic private instruction",
  });
  queue.next();
  queue.close();
  interruptedMerge(statePath);

  // The refusal reports the instruction, but the merge must be recovered too.
  await assert.rejects(
    startService({
      environment,
      telegram: telegramStub(),
      github: {},
      runner: async () => ({}),
    }),
    {
      message: /interrupted instruction\(s\) have an unknown external result/u,
    },
  );

  const merges = new MergeRequestStore(join(statePath, "merge-request.sqlite"));
  assert.equal(merges.state(40), "uncertain");
  merges.close();
  const traceSource = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
  });
  const actions = traceSource.traceEntries().map((entry) => entry.action);
  traceSource.close();
  assert.ok(actions.includes("merge_uncertain"));
  assert.ok(actions.includes("startup_refused_uncertain"));
});

test("resumes a preview awaiting the publisher after a restart", async (context) => {
  const { environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  const store = new PreviewRequestStore(
    join(statePath, "preview-request.sqlite"),
  );
  store.track({
    updateIdentifier: 30,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: "a".repeat(40),
  });
  store.close();
  const sent = [];
  const commit = "a".repeat(40);
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
      async listIssueComments() {
        return [
          {
            user: { login: "github-actions[bot]" },
            body: `<!-- mountain-runners-preview -->\nPreview publicada: https://pr-200.preview.mountainrunners.cat\nCommit: \`${commit}\`.`,
            updated_at: "2026-11-14T10:05:00Z",
          },
        ];
      },
      async getPullRequest() {
        return {
          state: "open",
          headSha: commit,
          headRepository: "rboixaderg/mountain-runners",
          previewLabeled: true,
          previewRevoked: false,
        };
      },
    },
    runner: async () => ({}),
  });
  context.after(() => {
    service.previewRequests.close();
    service.ciWatches.close();
    service.queue.close();
  });

  await service.previewWorker.runOnce();

  assert.equal(service.previewRequests.state(30), "confirmed");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(sent[0].text, /pr-200\.preview\.mountainrunners\.cat/u);
  const trace = service.queue
    .traceEntries()
    .find((entry) => entry.action === "preview_confirmed");
  assert.equal(trace.update_identifier, 30);
  assert.equal(trace.author_identifier, 555);
});

test("runs the preview watcher beside the bridge and stops it with the service", async () => {
  const controller = new AbortController();
  let stopped = false;
  const previewWorker = {
    async run({ signal }) {
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      stopped = true;
    },
  };

  await runBridgeWithCiWatcher({
    bridge: { async run() {} },
    ciWorker: { async run() {} },
    previewWorker,
    signal: controller.signal,
    abort: () => controller.abort(),
    logger: () => {},
  });

  assert.equal(stopped, true);
});

const mergedPullRequest = {
  state: "closed",
  htmlUrl: "https://github.com/example/project/pull/200",
  headSha: "a".repeat(40),
  headRepository: "rboixaderg/mountain-runners",
  draft: false,
  baseRef: "main",
  mergeableState: "clean",
  merged: true,
  mergeCommitSha: "b".repeat(40),
};

function interruptedMerge(statePath) {
  mkdirSync(statePath, { recursive: true });
  const merges = new MergeRequestStore(join(statePath, "merge-request.sqlite"));
  merges.begin({
    updateIdentifier: 40,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: "a".repeat(40),
  });
  merges.close();
}

test("keeps an interrupted merge uncertain, attributed in the trace, and still starts", async (context) => {
  const { environment, statePath } = environmentFor(context);
  interruptedMerge(statePath);
  const sent = [];
  const service = await startService({
    environment,
    telegram: {
      ...telegramStub(),
      async sendMessage(message) {
        sent.push(message);
      },
    },
    github: {
      async getPullRequest() {
        return { ...mergedPullRequest, state: "open", merged: false };
      },
    },
    runner: async () => ({}),
  });

  assert.equal(service.mergeRequests.state(40), "uncertain");
  assert.equal(sent.length, 1);
  assert.ok(
    sent[0].text.includes(`\`/merge 200 ${"a".repeat(40)}\``),
    "the topic carries the exact command to confirm the unknown result",
  );
  assert.notEqual(service.mergeRequests.uncertain()[0].notified_at, null);
  const trace = service.queue
    .traceEntries()
    .find((entry) => entry.action === "merge_uncertain");
  assert.equal(trace.update_identifier, 40);
  assert.equal(trace.author_identifier, 555);
  assert.equal(trace.detail, `#200 ${"a".repeat(7)}`);
  service.mergeRequests.close();
  service.ciWatches.close();
  service.queue.close();
});

test("closes an interrupted merge that GitHub shows as merged and tells the topic", async (context) => {
  const { environment, statePath } = environmentFor(context);
  interruptedMerge(statePath);
  const sent = [];
  const service = await startService({
    environment,
    telegram: {
      ...telegramStub(),
      async sendMessage(message) {
        sent.push(message);
      },
    },
    github: {
      async getPullRequest() {
        return mergedPullRequest;
      },
    },
    runner: async () => ({}),
  });

  assert.equal(service.mergeRequests.state(40), "merged");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /proposta #200 fusionada/u);
  assert.equal(
    service.queue
      .traceEntries()
      .some((entry) => entry.action === "merge_reconciled"),
    true,
  );
  service.mergeRequests.close();
  service.ciWatches.close();
  service.queue.close();
});

function mergeCommandUpdate(updateIdentifier, chat = { id: -1001234567890 }) {
  return {
    update_id: updateIdentifier,
    message: {
      message_id: updateIdentifier,
      chat,
      message_thread_id: 7,
      is_topic_message: true,
      from: { id: 555, is_bot: false },
      text: "/merge @mountain_agent_bot",
      entities: [{ type: "mention", offset: 7, length: 19 }],
    },
  };
}

async function runMergeCommand(
  context,
  {
    membershipAtExecution = "member",
    membershipAtAdmission = "member",
    membershipStatuses = null,
    updates = [mergeCommandUpdate(100)],
    followups = [],
    prepare = () => {},
    deliveredPreview = true,
  },
) {
  const { environment } = environmentFor(context);
  const replies = [];
  const membershipChecks = [];
  const merges = [];
  const commit = "a".repeat(40);
  const service = await startService({
    environment,
    telegram: {
      ...telegramStub(),
      async getUpdates() {
        return updates.splice(0);
      },
      async getChatMember() {
        membershipChecks.push("checked");
        if (membershipStatuses !== null) {
          const index = Math.min(
            membershipChecks.length - 1,
            membershipStatuses.length - 1,
          );
          return { status: membershipStatuses[index] };
        }
        return {
          status:
            membershipChecks.length === 1
              ? membershipAtAdmission
              : membershipAtExecution,
        };
      },
      async sendMessage(message) {
        replies.push(message.text);
        return { message_id: 70 + replies.length };
      },
    },
    github: {
      async getPullRequest() {
        return {
          ...mergedPullRequest,
          state: "open",
          merged: false,
          mergeCommitSha: null,
          previewLabeled: true,
        };
      },
      async getCommitCheckRuns() {
        return [
          { name: "Validate", status: "completed", conclusion: "success" },
        ];
      },
      async getCommitStatuses() {
        return [];
      },
      async getChangedPaths() {
        const paths = ["apps/web/src/content/posts/la-cursa.yaml"];
        return { paths, presentPaths: paths };
      },
      async getTreeModes() {
        return new Map([
          ["apps/web/src/content/posts/la-cursa.yaml", "100644"],
        ]);
      },
      async mergePullRequest({ number, sha }) {
        merges.push({ number, sha });
        return { mergeCommitSha: "b".repeat(40) };
      },
    },
  });
  service.ciWatches.add({
    updateIdentifier: 10,
    sessionKey: "-1001234567890:7",
    pullRequestNumber: 200,
    commitSha: commit,
  });
  service.ciWatches.finishSend(10, "success");
  if (deliveredPreview) {
    service.previewRequests.track({
      updateIdentifier: 10,
      sessionKey: "-1001234567890:7",
      authorIdentifier: 42,
      pullRequestNumber: 200,
      commitSha: commit,
    });
    service.previewRequests.finish(
      10,
      commit,
      "confirmed",
      "https://pr-200.preview.mountainrunners.cat",
      51,
    );
  }

  await service.bridge.pollOnce();
  prepare(service);
  await service.bridge.executeNext();
  for (const update of followups) {
    updates.push(update);
    await service.bridge.pollOnce();
    await service.bridge.executeNext();
  }

  const outcome = { replies, membershipChecks, merges, service };
  service.previewRequests.close();
  service.mergeRequests.close();
  service.ciWatches.close();
  service.queue.close();
  return outcome;
}

function mergeReply(updateIdentifier, messageIdentifier, text, author = 555) {
  const { message } = mergeCommandUpdate(updateIdentifier);
  return {
    update_id: updateIdentifier,
    message: {
      ...message,
      from: { id: author, is_bot: false },
      text,
      entities: [],
      reply_to_message: {
        message_id: messageIdentifier,
        chat: message.chat,
        message_thread_id: message.message_thread_id,
        from: { id: 999, is_bot: true },
      },
    },
  };
}

test("the current preview receives only the fixed question and only its author's reply merges", async (context) => {
  const { replies, merges, membershipChecks } = await runMergeCommand(context, {
    updates: [mergeReply(100, 51, "La feina està validada")],
    followups: [
      mergeReply(101, 71, "Sí, a producció", 556),
      mergeReply(103, 71, "si, produccio"),
      mergeReply(104, 71, "Sí, a producció"),
    ],
  });
  assert.equal(replies.length, 3);
  assert.match(replies[2], /ja s'havia atès/u);
  assert.equal(
    replies[0],
    "Segur que vols donar aquesta feina per acabada? Si confirmes, els canvis d'aquesta versió es fusionaran i es publicaran a producció si el desplegament acaba bé. Respon «Sí, a producció» a aquest missatge per confirmar.",
  );
  assert.deepEqual(merges, [{ number: 200, sha: "a".repeat(40) }]);
  assert.match(replies[1], /La proposta #200 ja està fusionada/u);
  assert.equal(membershipChecks.length, 6);
});

test("revoking membership between the question and the confirmation refuses the merge", async (context) => {
  const { replies, merges } = await runMergeCommand(context, {
    // 1: validation admission, 2: validation execution,
    // 3: confirmation admission, 4: confirmation execution (revoked)
    membershipStatuses: ["member", "member", "member", "left"],
    updates: [mergeReply(100, 51, "La feina està validada")],
    followups: [mergeReply(101, 71, "Sí, a producció")],
  });
  assert.equal(replies.length, 2);
  assert.match(replies[0], /Respon «Sí, a producció»/u);
  assert.match(replies[1], /Ja no constes com a membre/u);
  assert.deepEqual(merges, []);
});

test("an out-of-context validation still receives the working acknowledgement", async (context) => {
  const { replies, merges } = await runMergeCommand(context, {
    updates: [mergeReply(100, 99, "La feina està validada")],
  });
  assert.equal(replies[0], "Hi estic treballant.");
  assert.deepEqual(merges, []);
});

test("merges through the bridge after verifying the membership again at execution", async (context) => {
  const { replies, membershipChecks, merges } = await runMergeCommand(context, {
    membershipAtExecution: "member",
  });

  assert.equal(membershipChecks.length, 2);
  assert.deepEqual(merges, [{ number: 200, sha: "a".repeat(40) }]);
  assert.match(replies.at(-1), /La proposta #200 ja està fusionada/u);
});

test("a green CI notice without a delivered preview cannot authorize a merge through the bridge", async (context) => {
  const { replies, merges } = await runMergeCommand(context, {
    deliveredPreview: false,
  });

  assert.deepEqual(merges, []);
  assert.match(replies.at(-1), /no hi ha cap avís vigent de preview/u);
});

test("a newer publication without a preview record invalidates the earlier notice even at the same SHA", async (context) => {
  const { replies, merges } = await runMergeCommand(context, {
    prepare: ({ ciWatches }) => {
      ciWatches.add({
        updateIdentifier: 11,
        sessionKey: "-1001234567890:7",
        pullRequestNumber: 200,
        commitSha: "a".repeat(40),
      });
      ciWatches.finishSend(11, "success");
    },
  });

  assert.deepEqual(merges, []);
  assert.match(replies.at(-1), /no hi ha cap avís vigent de preview/u);
});

test("the former topic cannot merge a pull request now owned by another topic", async (context) => {
  const { replies, merges } = await runMergeCommand(context, {
    prepare: ({ ciWatches }) => {
      ciWatches.add({
        updateIdentifier: 11,
        sessionKey: "-1001234567890:8",
        pullRequestNumber: 200,
        commitSha: "a".repeat(40),
      });
    },
  });

  assert.deepEqual(merges, []);
  assert.match(replies.at(-1), /no hi ha cap avís vigent de preview/u);
});

test("keeps the result of a merge for the next turn of the session", async (context) => {
  const { service } = await runMergeCommand(context, {});

  const notes = service.sessionNotes.claim("-1001234567890:7");
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /La proposta #200 ja està fusionada/u);
  service.sessionNotes.close();
});

test("does not merge when the author left the group between admission and execution", async (context) => {
  const { replies, membershipChecks, merges } = await runMergeCommand(context, {
    membershipAtExecution: "left",
  });

  assert.equal(membershipChecks.length, 2);
  assert.deepEqual(merges, []);
  assert.match(replies.at(-1), /Ja no constes com a membre del grup/u);
});

test("never reaches the merge for a command outside the configured group topic or from a non-member", async (context) => {
  for (const [name, options] of [
    [
      "another chat",
      { updates: [mergeCommandUpdate(100, { id: -1009999999999 })] },
    ],
    [
      "a private chat",
      { updates: [mergeCommandUpdate(100, { id: 555, type: "private" })] },
    ],
    ["a non-member", { membershipAtAdmission: "left" }],
  ]) {
    const { merges, replies } = await runMergeCommand(context, options);

    assert.deepEqual(merges, [], name);
    assert.equal(
      replies.some((reply) => /fusionada/u.test(reply)),
      false,
      name,
    );
  }
});

test("refuses the merge while the topic has another instruction waiting", async (context) => {
  const { merges, replies } = await runMergeCommand(context, {
    updates: [
      mergeCommandUpdate(100),
      { ...mergeCommandUpdate(101), update_id: 101 },
    ],
  });

  assert.deepEqual(merges, []);
  assert.match(replies.at(-1), /feina més nova que l'últim avís/u);
});

test("keeps the older notice blocked after reconciling a publication without a watch", async (context) => {
  const { directory, environment, statePath } = environmentFor(context);
  mkdirSync(statePath, { recursive: true });
  openIdentifierNames(statePath);
  const topic = "-1001234567890:7";
  const greenCommit = "a".repeat(40);
  const publishedCommit = "c".repeat(40);
  const publishedPullRequest = 201;

  // A's green notice was delivered.
  const watches = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  watches.add({
    updateIdentifier: 10,
    sessionKey: topic,
    pullRequestNumber: 200,
    commitSha: greenCommit,
  });
  watches.finishSend(10, "success");
  watches.close();
  const previews = new PreviewRequestStore(
    join(statePath, "preview-request.sqlite"),
  );
  function deliverPreview(updateIdentifier, pullRequestNumber, commitSha) {
    previews.track({
      updateIdentifier,
      sessionKey: topic,
      authorIdentifier: 42,
      pullRequestNumber,
      commitSha,
    });
    assert.equal(
      previews.finish(
        updateIdentifier,
        commitSha,
        "confirmed",
        `https://pr-${pullRequestNumber}.preview.mountainrunners.cat`,
        updateIdentifier + 50,
      ),
      true,
    );
  }
  deliverPreview(10, 200, greenCommit);
  context.after(() => previews.close());
  // B was published, but registering its watch failed: the instruction is
  // unknown until a person reconciles it.
  const queue = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
  });
  queue.admit({
    updateIdentifier: 20,
    messageIdentifier: 2020,
    sessionKey: topic,
    authorIdentifier: 42,
    instruction: "synthetic private instruction",
  });
  queue.next();
  queue.markUncertain(20, "uncertain");
  queue.close();

  // The operator confirms the publication with its pull request: the command
  // restores the watch the failed registration lost.
  const reconcileStores = {
    instructions: new AdmissionQueue(join(statePath, "admission.sqlite"), {
      maxPending: 10,
    }),
    ciWatches: new CiWatchStore(join(statePath, "ci-watch.sqlite")),
    previews,
    topicJobs: new TopicJobStore(join(statePath, "topic-jobs.sqlite")),
  };
  reconcileStores.topicJobs.bind({
    sessionKey: topic,
    branch: "feat/agent-synthetic-change-20",
    pullRequestNumber: publishedPullRequest,
  });
  await resolveUncertainCase({
    config: {
      paths: {
        repository: join(directory, "repository"),
        worktrees: join(directory, "worktrees"),
        state: statePath,
      },
    },
    stores: reconcileStores,
    telegram: { async sendMessage() {} },
    kind: "instruction",
    updateIdentifier: 20,
    resolution: reconcileResolutions.published,
    commit: publishedCommit,
    pullRequestNumber: publishedPullRequest,
  });
  assert.deepEqual(
    reconcileStores.ciWatches
      .pending()
      .map((row) => [
        row.update_identifier,
        row.pull_request_number,
        row.commit_sha,
      ]),
    [[20, publishedPullRequest, publishedCommit]],
  );
  reconcileStores.topicJobs.close();
  reconcileStores.ciWatches.close();
  reconcileStores.instructions.close();

  async function mergeOnce(updateIdentifier) {
    const merges = [];
    const replies = [];
    const service = await startService({
      environment: { ...environment },
      telegram: {
        ...telegramStub(),
        async getUpdates() {
          return [mergeCommandUpdate(updateIdentifier)];
        },
        async getChatMember() {
          return { status: "member" };
        },
        async sendMessage(message) {
          replies.push(message.text);
        },
      },
      github: {
        async getPullRequest() {
          return {
            state: "open",
            headSha: publishedCommit,
            headRepository: "rboixaderg/mountain-runners",
            draft: false,
            baseRef: "main",
            mergeableState: "clean",
            merged: false,
            mergeCommitSha: null,
            previewLabeled: true,
          };
        },
        async getCommitCheckRuns() {
          return [
            { name: "Validate", status: "completed", conclusion: "success" },
          ];
        },
        async getCommitStatuses() {
          return [];
        },
        async getChangedPaths() {
          const paths = ["apps/web/src/content/posts/la-cursa.yaml"];
          return { paths, presentPaths: paths };
        },
        async getTreeModes() {
          return new Map([
            ["apps/web/src/content/posts/la-cursa.yaml", "100644"],
          ]);
        },
        async mergePullRequest({ number, sha }) {
          merges.push({ number, sha });
          return { mergeCommitSha: "b".repeat(40) };
        },
      },
    });
    await service.bridge.pollOnce();
    await service.bridge.executeNext();
    service.previewRequests.close();
    service.mergeRequests.close();
    service.ciWatches.close();
    service.queue.close();
    return { merges, replies };
  }

  // The reconciled publication has no delivered preview: A must not be merged.
  const refused = await mergeOnce(100);
  assert.deepEqual(refused.merges, []);
  assert.match(refused.replies.at(-1), /preview/iu);

  // A green notice does not replace the new publication's preview.
  const delivered = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  assert.equal(delivered.finishSend(20, "success"), true);
  delivered.close();

  const stillRefused = await mergeOnce(200);
  assert.deepEqual(stillRefused.merges, []);
  assert.match(stillRefused.replies.at(-1), /preview/iu);

  deliverPreview(20, publishedPullRequest, publishedCommit);
  const resolved = await mergeOnce(300);
  assert.deepEqual(resolved.merges, [
    { number: publishedPullRequest, sha: publishedCommit },
  ]);
  assert.match(resolved.replies.at(-1), /La proposta #201 ja està fusionada/u);
});

function implementationUpdate(updateIdentifier) {
  return {
    update_id: updateIdentifier,
    message: {
      message_id: updateIdentifier,
      chat: { id: -1001234567890 },
      message_thread_id: 7,
      is_topic_message: true,
      from: { id: 555, is_bot: false },
      text: "@mountain_agent_bot implementa el canvi",
      entities: [{ type: "mention", offset: 0, length: 19 }],
    },
  };
}

test("still runs an instruction admitted before its author left the group", async (context) => {
  const { environment } = environmentFor(context);
  const updates = [implementationUpdate(100)];
  const replies = [];
  const membershipChecks = [];
  const executed = [];
  const service = await startService({
    environment,
    telegram: {
      ...telegramStub(),
      async getUpdates() {
        return updates.splice(0);
      },
      async getChatMember() {
        membershipChecks.push("checked");
        // Admitted as a member; the author has left by the time it runs.
        return { status: membershipChecks.length === 1 ? "member" : "left" };
      },
      async sendMessage(message) {
        replies.push(message.text);
      },
    },
    github: {},
    runner: async (request) => {
      executed.push(request.updateIdentifier);
      return { outcome: "answered", report: "Canvi publicat." };
    },
  });
  context.after(() => {
    service.ciWatches.close();
    service.queue.close();
  });

  await service.bridge.pollOnce();
  await service.bridge.executeNext();

  assert.equal(membershipChecks.length, 1);
  assert.deepEqual(executed, [100]);
  assert.ok(replies.some((reply) => /Canvi publicat/u.test(reply)));
});

test("prunes a finished topic worktree when idle and skips it while an instruction is running", async (context) => {
  const { environment, statePath } = environmentFor(context);
  const repository = environment.MOUNTAIN_AGENT_REPOSITORY_PATH;
  const worktreeRoot = environment.MOUNTAIN_AGENT_WORKTREE_PATH;
  const origin = `${repository}-origin.git`;
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  for (const argumentsList of [
    ["add", "README.md"],
    ["commit", "-m", "chore: initial"],
    ["push", "origin", "main"],
  ]) {
    await executeFile("git", [
      "-C",
      repository,
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.test",
      ...argumentsList,
    ]);
  }
  mkdirSync(statePath, { recursive: true });
  const names = openIdentifierNames(statePath);
  const sessionKey = "-1001234567890:77";
  const branch = "fix/finished-topic-0077";
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: names.worktreeName(sessionKey),
  });
  await createBranch({ worktree, branch });
  const { stdout: head } = await executeFile("git", [
    "-C",
    worktree.path,
    "rev-parse",
    "HEAD",
  ]);
  recordPublication(worktree, head.trim());
  const topicJobs = new TopicJobStore(join(statePath, "topic-jobs.sqlite"));
  topicJobs.bind({ sessionKey, branch, pullRequestNumber: 77 });
  topicJobs.close();

  const pullRequestState = { state: "open", merged: false, headRef: branch };
  const service = await startService({
    environment,
    telegram: telegramStub(),
    github: {
      async getPullRequest() {
        return { ...pullRequestState };
      },
    },
    runner: async () => ({}),
  });
  context.after(() => service.closeStateStores());
  assert.equal(existsSync(worktree.path), true);

  // While an instruction is running, finished-topic pruning must not touch worktrees.
  pullRequestState.state = "closed";
  pullRequestState.merged = true;
  service.queue.admit({
    updateIdentifier: 900,
    messageIdentifier: 901,
    sessionKey,
    authorIdentifier: 555,
    instruction: "in flight",
  });
  const running = service.queue.next();
  assert.equal(running?.updateIdentifier, 900);
  await service.applyRetention();
  assert.equal(existsSync(worktree.path), true);

  // Once idle, retention removes the clean published merged-topic worktree.
  service.queue.complete(900, "done");
  await service.applyRetention();
  assert.equal(existsSync(worktree.path), false);
});
