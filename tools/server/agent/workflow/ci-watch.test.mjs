import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TelegramApi } from "telegram-pi-bridge/telegram";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import { defaultRequestTimeoutMilliseconds } from "../repository/request-signal.mjs";
import { maximumAutomaticRepairs } from "../policy/development.mjs";
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
  pullRequest = {
    state: "open",
    headSha: commit,
    htmlUrl: "https://github.com/example/project/pull/200",
  },
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
  recordTrace = () => {},
  recordServiceNote = () => {},
  secrets = [],
  requiredChecks: checks = requiredChecks,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
}) {
  return createCiWatchWorker({
    store,
    repairs: store,
    github,
    telegram,
    requiredChecks: checks,
    pollIntervalMilliseconds: 1,
    watchTimeoutMilliseconds: 60 * 60 * 1000,
    maximumAutomaticRepairs,
    secrets,
    requestTimeoutMilliseconds,
    recordTrace,
    recordServiceNote,
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
    logger: (event, detail) => logger.push({ event, detail }),
  });

  await worker.runOnce();
  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].chatIdentifier, -1001234567890);
  assert.equal(telegram.sent[0].messageThreadIdentifier, 7);
  assert.equal(
    telegram.sent[0].text,
    [
      "La proposta està llesta. Vols veure com queda? Demana la preview.",
      "Enllaç per a revisió: https://github.com/example/project/pull/200",
    ].join("\n"),
  );
  assert.doesNotMatch(telegram.sent[0].text, /Validate|bbbbbbb|PR #/u);
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
  assert.deepEqual(logger, [
    {
      event: "ci_notification_sent",
      detail: `#200 ${commit.slice(0, 7)} success Validate`,
    },
  ]);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});

test("keeps the CI notice as a service event of the session", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const notes = [];
  const worker = workerFor({
    store,
    github: fakeGithub(),
    telegram,
    recordServiceNote: (note) => notes.push(note),
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.deepEqual(notes, [
    {
      sessionKey: registration.sessionKey,
      text: "Comprovacions obligatòries configurades en verd al commit bbbbbbb (PR #200): Validate.",
      receivedText: telegram.sent[0].text,
      effectKey: `ci:${registration.updateIdentifier}:${commit}:success`,
    },
  ]);
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

test("reserves the first automatic repair of the failing checks", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const traces = [];
  const worker = workerFor({
    store,
    github: fakeGithub({
      checkRuns: [
        {
          name: "Validate",
          status: "completed",
          conclusion: "failure",
          output: {
            title: "pnpm check failed",
            summary: "src/a.ts: error TS2322",
          },
        },
      ],
    }),
    telegram,
    recordTrace: (entry) => traces.push(entry),
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(
    telegram.sent[0].text,
    /Una part de les comprovacions del canvi no ha passat/u,
  );
  assert.match(telegram.sent[0].text, /L'estic corregint/u);
  assert.doesNotMatch(telegram.sent[0].text, /Validate|bbbbbbb|PR #/u);
  assert.equal(store.state(registration.updateIdentifier), "sent");

  const repair = store.claimNextRepair();
  assert.equal(repair.commit_sha, commit);
  assert.equal(repair.pull_request_number, registration.pullRequestNumber);
  assert.equal(repair.update_identifier, registration.updateIdentifier);
  assert.equal(repair.attempt_number, 1);
  assert.deepEqual(JSON.parse(repair.failed_checks), ["Validate"]);
  assert.deepEqual(JSON.parse(repair.evidence), [
    { name: "Validate", detail: "pnpm check failed\nsrc/a.ts: error TS2322" },
  ]);
  assert.deepEqual(traces, [
    {
      updateIdentifier: registration.updateIdentifier,
      sessionKey: registration.sessionKey,
      action: "ci_repair_requested",
      detail: `#${registration.pullRequestNumber} ${commit.slice(0, 7)} 1/2`,
    },
  ]);

  // The watch is finished: a second cycle neither reports again nor reserves
  // another repair.
  await worker.runOnce();
  assert.equal(telegram.sent.length, 1);
  assert.equal(store.claimNextRepair(), null);
});

// The repair published a new commit: the service reopens the same watch, so the
// topic keeps following the change without resetting the repair budget.
function registerRepairPublication(store, nextHead) {
  createCiWatchRegistration({ store })({
    ...registration,
    commit: nextHead,
    automatic: true,
  });
}

test("repairs the same failure a second time and then stops at the limit", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const failingValidate = fakeGithub({
    checkRuns: [checkRun("Validate", "completed", "failure")],
  });
  const first = fakeTelegram();
  await workerFor({
    store,
    github: failingValidate,
    telegram: first,
  }).runOnce();
  assert.match(first.sent[0].text, /L'estic corregint/u);
  const firstRepair = store.claimNextRepair();
  store.finishRepair(firstRepair.sequence, {
    status: "done",
    outcome: "published",
  });

  registerRepairPublication(store, nextCommit);
  const second = fakeTelegram();
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
      pullRequest: { state: "open", headSha: nextCommit },
    }),
    telegram: second,
  }).runOnce();

  assert.equal(second.sent.length, 1);
  assert.match(second.sent[0].text, /L'estic corregint/u);
  const secondRepair = store.claimNextRepair();
  assert.equal(secondRepair.attempt_number, 2);
  assert.equal(secondRepair.commit_sha, nextCommit);
  store.finishRepair(secondRepair.sequence, {
    status: "done",
    outcome: "published",
  });

  const thirdCommit = "d".repeat(40);
  registerRepairPublication(store, thirdCommit);
  const limit = fakeTelegram();
  const traces = [];
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
      pullRequest: { state: "open", headSha: thirdCommit },
    }),
    telegram: limit,
    recordTrace: (entry) => traces.push(entry),
  }).runOnce();

  assert.equal(limit.sent.length, 1);
  assert.match(
    limit.sent[0].text,
    /ja he fet els intents de correcció automàtica/u,
  );
  assert.match(limit.sent[0].text, /digues-me què vols fer/u);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_limit_reached"],
  );
  assert.equal(store.claimNextRepair(), null);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});

test("counts a different failing check set as its own repair budget", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram: fakeTelegram(),
  }).runOnce();
  const firstRepair = store.claimNextRepair();
  store.finishRepair(firstRepair.sequence, {
    status: "done",
    outcome: "published",
  });

  registerRepairPublication(store, nextCommit);
  const telegram = fakeTelegram();
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Gitleaks", "completed", "failure")],
      pullRequest: { state: "open", headSha: nextCommit },
    }),
    telegram,
    requiredChecks: ["Gitleaks"],
  }).runOnce();

  assert.match(telegram.sent[0].text, /L'estic corregint/u);
  const repair = store.claimNextRepair();
  assert.equal(repair.attempt_number, 1);
  assert.deepEqual(JSON.parse(repair.failed_checks), ["Gitleaks"]);
});

test("redacts known credentials from the failure evidence", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const worker = workerFor({
    store,
    github: fakeGithub({
      checkRuns: [
        {
          name: "Validate",
          status: "completed",
          conclusion: "failure",
          output: { title: "token ghp_synthetic_secret rejected" },
        },
      ],
    }),
    telegram: fakeTelegram(),
    secrets: ["ghp_synthetic_secret"],
  });

  await worker.runOnce();

  const repair = store.claimNextRepair();
  assert.deepEqual(JSON.parse(repair.evidence), [
    { name: "Validate", detail: "token *** rejected" },
  ]);
});

test("closes the repair budget of a pull request when its CI is green", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram: fakeTelegram(),
  }).runOnce();
  const repair = store.claimNextRepair();
  store.finishRepair(repair.sequence, { status: "done", outcome: "failed" });

  registerRepairPublication(store, nextCommit);
  await workerFor({
    store,
    github: fakeGithub({ pullRequest: { state: "open", headSha: nextCommit } }),
    telegram: fakeTelegram(),
  }).runOnce();

  assert.equal(store.repair(repair.sequence), undefined);
});

test("waits for every required check before reserving a repair", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();

  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [
        checkRun("Validate", "completed", "failure"),
        checkRun("Gitleaks", "in_progress", null),
      ],
    }),
    telegram,
    requiredChecks: ["Validate", "Gitleaks"],
  }).runOnce();

  assert.deepEqual(telegram.sent, []);
  assert.equal(store.state(registration.updateIdentifier), "pending");
  assert.equal(store.claimNextRepair(), null);

  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [
        checkRun("Validate", "completed", "failure"),
        checkRun("Gitleaks", "completed", "failure"),
      ],
    }),
    telegram,
    requiredChecks: ["Validate", "Gitleaks"],
  }).runOnce();

  assert.match(telegram.sent[0].text, /L'estic corregint/u);
  assert.doesNotMatch(telegram.sent[0].text, /Validate|Gitleaks/u);
  const repair = store.claimNextRepair();
  assert.deepEqual(JSON.parse(repair.failed_checks), ["Validate", "Gitleaks"]);
});

test("ends an incomplete failure at the deadline without repairing it", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [
        checkRun("Validate", "completed", "failure"),
        checkRun("Gitleaks", "in_progress", null),
      ],
    }),
    telegram,
    requiredChecks: ["Validate", "Gitleaks"],
    now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(
    telegram.sent[0].text,
    /No he pogut confirmar del tot les comprovacions/u,
  );
  assert.equal(store.claimNextRepair(), null);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});

test("reports an unavailable follow-up when the repaired watch cannot be reopened", (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const events = [];
  const register = createCiWatchRegistration({
    store,
    logger: (event) => events.push({ event }),
  });

  assert.equal(
    register({ ...registration, commit: nextCommit, automatic: true }),
    "unavailable",
  );
  assert.deepEqual(events, [{ event: "ci_watch_registration_failed" }]);
  assert.equal(store.pending()[0].commit_sha, commit);
});

test("starts the repair budget again after a new human publication", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const failing = [checkRun("Validate", "completed", "failure")];

  // Two automatic attempts of the same failure reach the limit.
  await workerFor({
    store,
    github: fakeGithub({ checkRuns: failing }),
    telegram: fakeTelegram(),
  }).runOnce();
  store.finishRepair(store.claimNextRepair().sequence, {
    status: "done",
    outcome: "published",
  });
  registerRepairPublication(store, nextCommit);
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: failing,
      pullRequest: { state: "open", headSha: nextCommit },
    }),
    telegram: fakeTelegram(),
  }).runOnce();
  store.finishRepair(store.claimNextRepair().sequence, {
    status: "done",
    outcome: "published",
  });
  assert.equal(
    store.requestRepair({
      updateIdentifier: registration.updateIdentifier,
      sessionKey: registration.sessionKey,
      pullRequestNumber: registration.pullRequestNumber,
      failureFingerprint: JSON.stringify(["Validate"]),
      failedChecks: ["Validate"],
      evidence: [],
      commitSha: "d".repeat(40),
      maximumAttempts: 2,
    }),
    null,
  );

  // A person publishes a new commit and CI fails again: a fresh budget.
  const humanCommit = "e".repeat(40);
  createCiWatchRegistration({ store })({
    ...registration,
    updateIdentifier: 502,
    commit: humanCommit,
  });
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: failing,
      pullRequest: { state: "open", headSha: humanCommit },
    }),
    telegram: fakeTelegram(),
  }).runOnce();

  const repair = store.claimNextRepair();
  assert.equal(repair.attempt_number, 1);
  assert.equal(repair.commit_sha, humanCommit);
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
  assert.match(telegram.sent[0].text, /El canvi té una versió més nova/u);
  assert.match(
    telegram.sent[0].text,
    /no les miro jo tot sol/u,
    "the new version is not followed automatically",
  );
  assert.match(telegram.sent[0].text, /Demana'm en aquest tema/u);
  assert.doesNotMatch(
    telegram.sent[0].text,
    /T'avisaré/u,
    "a watch that ends with the head changed never promises another message",
  );
  assert.doesNotMatch(telegram.sent[0].text, /en verd|bbbbbbb/u);
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

test("ends the watch of a merged pull request with the closed notice", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub({
      pullRequest: { state: "closed", merged: true, headSha: commit },
    }),
    telegram,
  });

  await worker.runOnce();
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
  assert.match(telegram.sent[0].text, /La proposta està llesta/u);
  assert.match(telegram.sent[0].text, /Enllaç per a revisió:/u);
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
  assert.match(
    telegram.sent[0].text,
    /No he pogut confirmar com han anat les comprovacions/u,
  );
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

test("treats a notice that reaches its deadline as uncertain and aborts the repair", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const events = [];
  const traces = [];
  // A Telegram client that never answers: only its request deadline ends it.
  const telegram = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: async (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      }),
    requestTimeoutMilliseconds: 100,
  });

  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram,
    logger: (event) => events.push(event),
    recordTrace: (entry) => traces.push(entry),
  }).runOnce();

  assert.deepEqual(events, ["ci_notification_uncertain"]);
  assert.equal(store.state(registration.updateIdentifier), "uncertain");
  assert.equal(store.repair(1).status, "aborted");
  assert.equal(store.repair(1).outcome, "announcement_failed");
  assert.equal(store.claimNextRepair(), null);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_not_announced"],
  );
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
  const notes = [];
  const pullRequestUrls = {
    200: "https://github.com/example/project/pull/200",
    201: "https://github.com/example/project/pull/201",
  };
  const worker = workerFor({
    store,
    github: {
      async getCommitCheckRuns() {
        return [checkRun("Validate", "completed", "success")];
      },
      async getCommitStatuses() {
        return [];
      },
      async getPullRequest({ number }) {
        return {
          state: "open",
          headSha: commit,
          htmlUrl: pullRequestUrls[number],
        };
      },
    },
    telegram,
    recordServiceNote: (note) => notes.push(note),
  });

  await worker.runOnce();

  assert.deepEqual(
    telegram.sent.map((message) => message.messageThreadIdentifier),
    [7, 8],
  );
  assert.deepEqual(
    telegram.sent.map((message) => message.text.split("\n").at(-1)),
    [
      "Enllaç per a revisió: https://github.com/example/project/pull/200",
      "Enllaç per a revisió: https://github.com/example/project/pull/201",
    ],
    "each topic receives the review link of its own pull request",
  );
  assert.deepEqual(
    notes.map((note) => /PR #(\d+)/u.exec(note.text)[1]),
    ["200", "201"],
    "each notice keeps its own pull request in the service note",
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
    repairs: store,
    maximumAutomaticRepairs,
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

test("informs the topic even when the private trace cannot be written", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const events = [];
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram,
    logger: (event) => events.push(event),
    recordTrace: () => {
      throw new Error("trace unavailable");
    },
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /L'estic corregint/u);
  assert.deepEqual(events, ["ci_notification_sent", "ci_trace_failed"]);
  assert.equal(store.claimNextRepair() !== null, true);
});

test("refuses a new repair while another repair has an unknown result", async (context) => {
  const { store } = fixture(context);
  const unknown = store.requestRepair({
    updateIdentifier: 500,
    sessionKey: registration.sessionKey,
    pullRequestNumber: 999,
    failureFingerprint: JSON.stringify(["Gitleaks"]),
    failedChecks: ["Gitleaks"],
    evidence: [],
    commitSha: "d".repeat(40),
    maximumAttempts: 2,
  });
  store.queueRepair(unknown.sequence);
  store.claimNextRepair();
  store.interruptRepairs();
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const traces = [];

  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram,
    recordTrace: (entry) => traces.push(entry),
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /Hi ha una revisió pendent del servei/u);
  assert.equal(store.claimNextRepair(), null);
  assert.equal(store.repair(unknown.sequence).status, "uncertain");
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_blocked"],
  );
});

test("waits while another required check is missing or ambiguous", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram,
    requiredChecks: ["Validate", "Gitleaks"],
  });

  await worker.runOnce();
  assert.deepEqual(telegram.sent, []);
  assert.equal(store.claimNextRepair(), null);
  assert.equal(store.state(registration.updateIdentifier), "pending");

  // One required check reported by two sources leaves the set ambiguous: the
  // failure is never repaired from an inconclusive picture.
  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [
        checkRun("Validate", "completed", "failure"),
        checkRun("Gitleaks", "completed", "failure"),
      ],
      statuses: [
        {
          context: "Gitleaks",
          state: "failure",
          created_at: "2026-11-14T10:00:00Z",
        },
      ],
    }),
    telegram,
    requiredChecks: ["Validate", "Gitleaks"],
  }).runOnce();
  assert.deepEqual(telegram.sent, []);
  assert.equal(store.claimNextRepair(), null);
});

test("sends the green notice even when the repair budget cannot be reset", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  store.resetRepairs = () => {
    throw new Error("state volume full");
  };
  const telegram = fakeTelegram();
  const events = [];

  await workerFor({
    store,
    github: fakeGithub(),
    telegram,
    logger: (event) => events.push(event),
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(telegram.sent[0].text, /La proposta està llesta/u);
  assert.deepEqual(events, [
    "ci_repair_budget_reset_failed",
    "ci_notification_sent",
  ]);
});

test("reports the registered watch even when the repair budget cannot be reset", (context) => {
  const { store } = fixture(context);
  const events = [];
  const storeWithFailingReset = {
    add: (...options) => store.add(...options),
    resetRepairs() {
      throw new Error("state volume full");
    },
  };

  assert.equal(
    createCiWatchRegistration({
      store: storeWithFailingReset,
      logger: (event) => events.push({ event }),
    })(registration),
    "registered",
  );
  assert.equal(store.pending().length, 1);
  assert.deepEqual(events, [{ event: "ci_repair_budget_reset_failed" }]);
});

test("makes the repair claimable only after the announcement and a reopenable watch", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const observed = [];
  const telegram = {
    async sendMessage() {
      // While the announcement is in flight the repair must not be claimable.
      observed.push(store.claimNextRepair());
    },
  };

  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram,
  }).runOnce();

  assert.deepEqual(observed, [null]);
  // A fast repair finds the watch finished, so its publication can reopen it.
  assert.equal(store.state(registration.updateIdentifier), "sent");
  assert.equal(store.claimNextRepair().attempt_number, 1);
  registerRepairPublication(store, nextCommit);
  assert.equal(store.pending()[0].commit_sha, nextCommit);
});

test("closes a repair whose announcement was not delivered so the topic is not blocked", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const traces = [];

  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram: {
      async sendMessage() {
        throw new Error("network down");
      },
    },
    recordTrace: (entry) => traces.push(entry),
  }).runOnce();

  assert.equal(store.state(registration.updateIdentifier), "uncertain");
  assert.equal(store.claimNextRepair(), null);
  const [repair] = store.uncertainRepairs();
  assert.equal(repair, undefined);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["ci_repair_not_announced"],
  );

  // Once the unknown notice is delivered, the failure is not blocked by a
  // reservation that will never run.
  store.resolveUncertainNoticeDelivered(registration.updateIdentifier);
  assert.equal(store.hasUnreportedWork(registration.sessionKey), false);
  assert.equal(store.claimNextRepair(), null);
});

test("tells the two notices of one commit apart in the session", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-watch-notes-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const failing = fakeGithub({
    checkRuns: [checkRun("Validate", "completed", "failure")],
  });
  const recordServiceNote = ({ sessionKey, text: noteText, effectKey }) =>
    notes.addNote({ sessionKey, text: noteText, effectKey });

  await workerFor({
    store,
    github: failing,
    telegram: {
      async sendMessage() {
        throw new Error("network down");
      },
    },
    recordServiceNote,
  }).runOnce();
  const telegram = fakeTelegram();
  store.resolveUncertainNoticeResend(registration.updateIdentifier);
  await workerFor({
    store,
    github: failing,
    telegram,
    recordServiceNote,
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(
    telegram.sent[0].text,
    /aquesta vegada no l'he corregit automàticament/u,
  );
  assert.deepEqual(
    notes.claim(registration.sessionKey).map((note) => note.text),
    [
      "CI fallida al commit bbbbbbb (PR #200): Validate no ha acabat correctament. Reparació automàtica 1/2 en curs; rebràs el resultat en aquest mateix tema.",
      "CI fallida al commit bbbbbbb (PR #200): Validate no ha acabat correctament. No s'executarà cap reparació automàtica d'aquest intent; dona una instrucció nova en aquest tema si vols que es corregeixi.",
    ],
    "the announcement and the news that it will not run are two effects",
  );
});

test("announces that an aborted repair will not run when its notice is re-sent", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const failing = fakeGithub({
    checkRuns: [checkRun("Validate", "completed", "failure")],
  });
  const firstTraces = [];
  await workerFor({
    store,
    github: failing,
    telegram: {
      async sendMessage() {
        throw new Error("network down");
      },
    },
    recordTrace: (entry) => firstTraces.push(entry),
  }).runOnce();
  assert.equal(store.repair(1).status, "aborted");
  assert.equal(store.repair(1).outcome, "announcement_failed");

  // The person decides the announcement is sent again.
  store.resolveUncertainNoticeResend(registration.updateIdentifier);

  const telegram = fakeTelegram();
  const traces = [];
  await workerFor({
    store,
    github: failing,
    telegram,
    recordTrace: (entry) => traces.push(entry),
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(
    telegram.sent[0].text,
    /Una part de les comprovacions del canvi no ha passat/u,
  );
  assert.match(
    telegram.sent[0].text,
    /aquesta vegada no l'he corregit automàticament/u,
  );
  assert.doesNotMatch(telegram.sent[0].text, /Validate|bbbbbbb/u);
  assert.equal(store.state(registration.updateIdentifier), "sent");
  assert.equal(store.claimNextRepair(), null);
  assert.equal(store.repair(1).status, "aborted");
  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [
      [
        "ci_repair_not_run",
        `#${registration.pullRequestNumber} ${commit.slice(0, 7)} aborted`,
      ],
    ],
  );
  assert.equal(
    firstTraces.some((entry) => entry.action === "ci_repair_requested"),
    false,
  );
});

test("names the failed checks in the service note when the deadline ends an incomplete failure", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const notes = [];

  await workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram,
    recordServiceNote: (note) => notes.push(note),
    requiredChecks: ["Validate", "Gitleaks"],
    now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
  }).runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.match(
    telegram.sent[0].text,
    /No he pogut confirmar del tot les comprovacions/u,
  );
  assert.doesNotMatch(telegram.sent[0].text, /Validate|Reparació automàtica/u);
  assert.match(notes[0].text, /però Validate ha fallat/u);
  assert.match(notes[0].text, /bbbbbbb/u);
  assert.equal(store.claimNextRepair(), null);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});
