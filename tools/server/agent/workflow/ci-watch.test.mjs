import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { createCiWatchRegistration, createCiWatchWorker } from "./ci-watch.mjs";

const commit = "b".repeat(40);
const nextCommit = "c".repeat(40);
const requiredChecks = ["Validate"];

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-watch-worker-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const path = join(directory, "ci-watch.sqlite");
  const store = new CiWatchStore(path);
  context.after(() => store.close());
  return { store, path };
}

const registration = {
  updateIdentifier: 501,
  sessionKey: "-1001234567890:7",
  pullRequestNumber: 200,
  commit,
};

function checkRun(name, status, conclusion) {
  return { name, status, conclusion };
}

function fakeGithub({
  checkRuns = [checkRun("Validate", "completed", "success")],
  statuses = [],
  pullRequest = { state: "open", headSha: commit },
} = {}) {
  const reads = [];
  return {
    reads,
    async getCommitCheckRuns({ commit: readCommit }) {
      reads.push({ kind: "check-runs", commit: readCommit });
      return checkRuns;
    },
    async getCommitStatuses({ commit: readCommit }) {
      reads.push({ kind: "statuses", commit: readCommit });
      return statuses;
    },
    async getPullRequest({ number }) {
      reads.push({ kind: "pull-request", number });
      return pullRequest;
    },
  };
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

function workerFor({
  store,
  github,
  telegram,
  logger,
  now,
  requestTimeoutMilliseconds = 30 * 1000,
}) {
  return createCiWatchWorker({
    store,
    github,
    telegram,
    requiredChecks,
    pollIntervalMilliseconds: 1,
    watchTimeoutMilliseconds: 60 * 60 * 1000,
    requestTimeoutMilliseconds,
    logger,
    now,
  });
}

test("registers the watch for the exact published commit", (context) => {
  const { store } = fixture(context);
  const register = createCiWatchRegistration({ store });

  assert.equal(
    register({
      updateIdentifier: registration.updateIdentifier,
      sessionKey: registration.sessionKey,
      pullRequestNumber: registration.pullRequestNumber,
      commit,
    }),
    "registered",
  );
  const [watch] = store.pending();
  assert.equal(watch.commit_sha, commit);
  assert.equal(watch.pull_request_number, 200);
  assert.equal(watch.session_key, registration.sessionKey);
});

test("reports an unavailable watch instead of losing the publication", () => {
  const events = [];
  const register = createCiWatchRegistration({
    store: {
      add() {
        throw new Error("state volume full");
      },
    },
    logger: (event, detail) => events.push({ event, detail }),
  });

  assert.equal(
    register({
      updateIdentifier: 1,
      sessionKey: "-1001234567890:7",
      pullRequestNumber: 200,
      commit,
    }),
    "unavailable",
  );
  assert.deepEqual(events, [
    { event: "ci_watch_registration_failed", detail: "state volume full" },
  ]);
});

test("sends the green result once for the pinned commit and pull request", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const github = fakeGithub();
  const logger = [];
  const worker = workerFor({
    store,
    github,
    telegram,
    logger: (event) => logger.push(event),
  });

  await worker.runOnce();
  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].chatIdentifier, -1001234567890);
  assert.equal(telegram.sent[0].messageThreadIdentifier, 7);
  assert.equal(
    telegram.sent[0].text,
    "Comprovacions obligatòries configurades en verd al commit bbbbbbb (PR #200): Validate.",
  );
  assert.deepEqual(
    github.reads.filter((read) => read.kind !== "pull-request"),
    [
      { kind: "check-runs", commit },
      { kind: "statuses", commit },
    ],
  );
  assert.deepEqual(github.reads.at(-1), {
    kind: "pull-request",
    number: 200,
  });
  assert.deepEqual(logger, ["ci_notification_sent"]);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});

test("waits while a required check is still running", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "in_progress", null)],
    }),
    telegram,
  });

  await worker.runOnce();

  assert.deepEqual(telegram.sent, []);
  assert.equal(store.state(registration.updateIdentifier), "pending");
});

test("reports the failing required checks of the pinned commit", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram,
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /CI fallida al commit bbbbbbb/u);
  assert.match(telegram.sent[0].text, /Validate no ha acabat correctament/u);
});

test("never reports green for another head and says the commit changed", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub({ pullRequest: { state: "open", headSha: nextCommit } }),
    telegram,
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /El cap de la PR #200 ha canviat/u);
  assert.doesNotMatch(telegram.sent[0].text, /en verd/u);
});

test("does not report CI for a pull request that is no longer open", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub({ pullRequest: { state: "closed", headSha: commit } }),
    telegram,
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /ja no està oberta/u);
});

test("reports a result read after the deadline instead of an unconfirmed notice", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub(),
    telegram,
    now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /en verd/u);
});

test("ends an unconfirmed watch at the deadline instead of claiming green", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub({ checkRuns: [] }),
    telegram,
    now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /No s'ha pogut confirmar/u);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});

test("treats a failed delivery as uncertain and never resends it on its own", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const events = [];
  let attempts = 0;
  const telegram = {
    async sendMessage() {
      attempts += 1;
      throw new Error("network error");
    },
  };
  const worker = workerFor({
    store,
    github: fakeGithub(),
    telegram,
    logger: (event) => events.push(event),
  });

  await worker.runOnce();
  await worker.runOnce();

  assert.equal(attempts, 1);
  assert.deepEqual(events, ["ci_notification_uncertain"]);
  assert.equal(store.state(registration.updateIdentifier), "uncertain");
});

test("keeps the watch pending when GitHub cannot answer", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const events = [];
  const worker = workerFor({
    store,
    github: {
      async getCommitCheckRuns() {
        throw new Error("GitHub GET check-runs failed with HTTP 502.");
      },
      async getCommitStatuses() {
        return [];
      },
      async getPullRequest() {
        assert.fail("the pull request is not read without a CI result");
      },
    },
    telegram,
    logger: (event) => events.push(event),
  });

  await worker.runOnce();

  assert.deepEqual(telegram.sent, []);
  assert.deepEqual(events, ["ci_watch_failed"]);
  assert.equal(store.state(registration.updateIdentifier), "pending");
});

test("gives up a GitHub read that never answers without stalling the cycle", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const events = [];
  const worker = workerFor({
    store,
    github: {
      getCommitCheckRuns({ signal }) {
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      },
      async getCommitStatuses() {
        return [];
      },
      async getPullRequest() {
        assert.fail("the pull request is not read without a CI result");
      },
    },
    telegram,
    logger: (event) => events.push(event),
    requestTimeoutMilliseconds: 20,
  });

  await worker.runOnce();

  assert.deepEqual(telegram.sent, []);
  assert.deepEqual(events, ["ci_watch_failed"]);
  assert.equal(store.state(registration.updateIdentifier), "pending");
});

test("resumes a pending watch after a restart", async (context) => {
  const { path } = fixture(context);
  const writer = new CiWatchStore(path);
  createCiWatchRegistration({ store: writer })(registration);
  writer.close();

  const reopened = new CiWatchStore(path);
  context.after(() => reopened.close());
  const telegram = fakeTelegram();
  await workerFor({
    store: reopened,
    github: fakeGithub(),
    telegram,
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.equal(reopened.state(registration.updateIdentifier), "sent");
});

test("notifies each pending watch in its own topic in one cycle", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  createCiWatchRegistration({ store })({
    ...registration,
    updateIdentifier: 502,
    sessionKey: "-1001234567890:8",
    pullRequestNumber: 201,
  });
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub(),
    telegram,
  });

  await worker.runOnce();

  assert.deepEqual(
    telegram.sent.map((message) => message.messageThreadIdentifier),
    [7, 8],
  );
  assert.deepEqual(
    telegram.sent.map((message) => /PR #(\d+)/u.exec(message.text)[1]),
    ["200", "201"],
  );
});

test("runs cycles in the background and returns on abort without leaking listeners", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const controller = new AbortController();
  let reads = 0;
  const worker = createCiWatchWorker({
    store,
    github: {
      async getCommitCheckRuns() {
        reads += 1;
        return [checkRun("Validate", "in_progress", null)];
      },
      async getCommitStatuses() {
        return [];
      },
      async getPullRequest() {
        assert.fail("the pull request is not read without a CI result");
      },
    },
    telegram: fakeTelegram(),
    requiredChecks,
    pollIntervalMilliseconds: 5,
    watchTimeoutMilliseconds: 60 * 60 * 1000,
  });

  const running = worker.run({ signal: controller.signal });
  while (reads < 3) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(getEventListeners(controller.signal, "abort").length <= 1);

  controller.abort();
  await running;

  assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
  assert.equal(store.state(registration.updateIdentifier), "pending");
});
