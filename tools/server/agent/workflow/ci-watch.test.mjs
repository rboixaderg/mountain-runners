import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import { defaultRequestTimeoutMilliseconds } from "../repository/request-signal.mjs";
import { failedMaintainerNotice, savedNotice } from "../policy/development.mjs";
import { createCiWatchRegistration, createCiWatchWorker } from "./ci-watch.mjs";

const commit = "b".repeat(40);
const nextCommit = "c".repeat(40);
const requiredChecks = ["Validate"];

function fixture(context, options = {}) {
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
  const store = new CiWatchStore(path, options);
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
  requiredChecks: checks = requiredChecks,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
}) {
  return createCiWatchWorker({
    store,
    github,
    telegram,
    requiredChecks: checks,
    pollIntervalMilliseconds: 1,
    watchTimeoutMilliseconds: 60 * 60 * 1000,
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

  assert.equal(
    telegram.sent.length,
    0,
    "the publication already said the change is saved",
  );
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

  assert.equal(telegram.sent.length, 0, "the person already read the save");
  assert.deepEqual(notes, [
    {
      sessionKey: registration.sessionKey,
      text: "Comprovacions obligatòries configurades en verd al commit bbbbbbb (PR #200): Validate.",
      receivedText: `${savedNotice}\nEnllaç per a revisió: https://github.com/example/project/pull/200`,
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

test("waits for every required check before reporting a failure", async (context) => {
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
});

for (const conclusion of ["failure", "cancelled", "timed_out"]) {
  test(`reports a ${conclusion} check with the plain failure notice`, async (context) => {
    const { store } = fixture(context);
    createCiWatchRegistration({ store })(registration);
    const telegram = fakeTelegram();
    const notes = [];
    const traces = [];

    await workerFor({
      store,
      github: fakeGithub({
        checkRuns: [checkRun("Validate", "completed", conclusion)],
      }),
      telegram,
      recordServiceNote: (note) => notes.push(note),
      recordTrace: (entry) => traces.push(entry),
    }).runOnce();

    assert.deepEqual(
      telegram.sent.map((message) => message.text),
      [failedMaintainerNotice],
    );
    assert.equal(
      notes[0].text,
      "CI fallida al commit bbbbbbb (PR #200): Validate no ha acabat correctament. El treball es conserva; dona una instrucció nova en aquest tema si vols que es corregeixi.",
    );
    assert.deepEqual(
      traces.map(({ action, detail }) => [action, detail]),
      [["maintainer_attention", "failure"]],
    );
    assert.equal(store.state(registration.updateIdentifier), "sent");
  });
}

test("ends an incomplete failure at the deadline", async (context) => {
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
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
  assert.equal(store.state(registration.updateIdentifier), "sent");
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
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
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
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
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
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
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

  assert.equal(telegram.sent.length, 0);
  assert.equal(store.state(registration.updateIdentifier), "sent");
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
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
  assert.equal(store.state(registration.updateIdentifier), "sent");
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

test("ends a watch at its deadline even when GitHub keeps failing", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: {
      async getCommitCheckRuns() {
        throw new Error("GitHub GET check-runs failed with HTTP 502.");
      },
      async getCommitStatuses() {
        return [];
      },
    },
    telegram,
    now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});

test("ends a watch at its deadline when only the pull request read fails", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const worker = workerFor({
    store,
    github: {
      async getCommitCheckRuns() {
        return [checkRun("Validate", "completed", "success")];
      },
      async getCommitStatuses() {
        return [];
      },
      async getPullRequest() {
        throw new Error("GitHub GET pull failed with HTTP 502.");
      },
    },
    telegram,
    now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 1);
  assert.equal(store.state(registration.updateIdentifier), "sent");
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

  assert.equal(telegram.sent.length, 0);
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

  assert.deepEqual(notes.map((note) => note.sessionKey).sort(), [
    "-1001234567890:7",
    "-1001234567890:8",
  ]);
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
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
  assert.deepEqual(events, [
    "ci_trace_failed",
    "maintainer_attention",
    "ci_notification_sent",
  ]);
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
  assert.equal(store.state(registration.updateIdentifier), "pending");

  // One required check reported by two sources leaves the set ambiguous: the
  // failure is never reported as final from an inconclusive picture.
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
});

test("repeats a notice after an unknown delivery, with one note in the session", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-watch-notes-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const delivered = [];
  const traces = [];
  const events = [];
  let lost = true;
  let instant = Date.now();
  const worker = workerFor({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    // The first message arrives, but its answer is lost.
    telegram: {
      async sendMessage(message) {
        delivered.push(message.text);
        if (lost) {
          lost = false;
          throw new Error("network down");
        }
      },
    },
    recordServiceNote: (note) => notes.addNote(note),
    recordTrace: (entry) => traces.push(entry.action),
    logger: (event) => events.push(event),
    now: () => new Date(instant),
  });

  await worker.runOnce();
  assert.equal(store.state(registration.updateIdentifier), "pending");
  assert.equal(store.hasUnreportedWork(registration.sessionKey), true);
  assert.deepEqual(traces, []);
  assert.deepEqual(events, ["ci_notification_failed"]);
  notes.recordReply({
    sessionKey: registration.sessionKey,
    text: "Resposta més nova del model.",
  });

  instant += 1;
  await worker.runOnce();
  await worker.runOnce();

  assert.deepEqual(delivered, [failedMaintainerNotice, failedMaintainerNotice]);
  assert.equal(store.state(registration.updateIdentifier), "sent");
  assert.equal(store.hasUnreportedWork(registration.sessionKey), false);
  assert.deepEqual(traces, ["maintainer_attention"]);
  assert.equal(notes.claim(registration.sessionKey).length, 1);
  assert.equal(
    notes.lastReply(registration.sessionKey),
    "Resposta més nova del model.",
  );
});

test("doubles the delay of a notice that keeps failing, up to one hour", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const start = Date.now();
  let instant = start;
  const attempts = [];
  let failing = true;
  const worker = createCiWatchWorker({
    store,
    github: fakeGithub({
      checkRuns: [checkRun("Validate", "completed", "failure")],
    }),
    telegram: {
      async sendMessage() {
        attempts.push((instant - start) / 60_000);
        if (failing) throw new Error("chat not found");
      },
    },
    requiredChecks,
    pollIntervalMilliseconds: 20 * 60_000,
    watchTimeoutMilliseconds: 24 * 60 * 60_000,
    now: () => new Date(instant),
  });
  const runUntil = async (minute) => {
    for (; instant <= start + minute * 60_000; instant += 10 * 60_000) {
      await worker.runOnce();
    }
  };

  await runUntil(170);
  assert.deepEqual(attempts, [0, 20, 60, 120]);

  failing = false;
  await runUntil(240);
  assert.deepEqual(attempts, [0, 20, 60, 120, 180]);
  assert.equal(store.state(registration.updateIdentifier), "sent");
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
  assert.equal(telegram.sent[0].text, failedMaintainerNotice);
  assert.doesNotMatch(telegram.sent[0].text, /Validate/u);
  assert.match(notes[0].text, /però Validate ha fallat/u);
  assert.match(notes[0].text, /bbbbbbb/u);
  assert.equal(store.state(registration.updateIdentifier), "sent");
});

test("keeps the notice when the note of its effect cannot be stored", async (context) => {
  const { store } = fixture(context);
  createCiWatchRegistration({ store })(registration);
  const telegram = fakeTelegram();
  const events = [];
  const worker = workerFor({
    store,
    github: fakeGithub(),
    telegram,
    recordServiceNote: () => {
      throw new Error("the note store is unavailable");
    },
    logger: (event) => events.push(event),
  });

  await worker.runOnce();

  assert.equal(telegram.sent.length, 0);
  assert.equal(store.state(registration.updateIdentifier), "sent");
  assert.deepEqual(events, ["ci_note_failed", "ci_notification_sent"]);
});
