import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { SessionNoteStore } from "../../repository/session-note-store.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import { runReconcileCommand } from "./command.mjs";

const sessionKey = "-1001234567890:7";

function serviceFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-reconcile-command-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const statePath = join(directory, "state");
  mkdirSync(statePath);
  // The installation already ran the identifier migration.
  openIdentifierNames(statePath);
  return {
    statePath,
    environment: {
      PATH: process.env.PATH,
      MOUNTAIN_AGENT_REPOSITORY: "example/repository",
      MOUNTAIN_AGENT_TELEGRAM_GROUP_ID: "-1001234567890",
      MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME: "example_bot",
      MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN: "synthetic-telegram",
      MOUNTAIN_AGENT_GITHUB_TOKEN: "synthetic-github",
      MOUNTAIN_AGENT_REQUIRED_CHECKS: "Validate",
      MOUNTAIN_AGENT_SANDBOX_IMAGE: "synthetic:1",
      MOUNTAIN_AGENT_REPOSITORY_PATH: join(directory, "repository"),
      MOUNTAIN_AGENT_WORKTREE_PATH: join(directory, "worktrees"),
      MOUNTAIN_AGENT_SESSION_PATH: join(directory, "sessions"),
      MOUNTAIN_AGENT_STATE_PATH: statePath,
    },
  };
}

function interruptInstruction(statePath) {
  const queue = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
  });
  queue.admit({
    updateIdentifier: 11,
    messageIdentifier: 1011,
    sessionKey,
    authorIdentifier: 42,
    instruction: "synthetic private instruction",
  });
  queue.next();
  queue.markUncertain(11, "uncertain");
  queue.close();
}

// A publication whose notice may or may not have reached the topic. The private
// trace database exists, because a resolution is never kept without its trace.
function uncertainNotice(statePath) {
  const queue = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
  });
  queue.close();
  const store = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  store.add({
    updateIdentifier: 31,
    sessionKey,
    pullRequestNumber: 200,
    commitSha: "a".repeat(40),
  });
  store.beginSend(31, "success");
  store.markUncertain(31);
  store.close();
}

test("resolves an unknown notice without sending anything to the topic", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  uncertainNotice(statePath);
  const messages = [];
  const output = [];
  const warnings = [];
  const run = () =>
    runReconcileCommand({
      argv: [
        "resolve",
        "--kind",
        "notice",
        "--update",
        "31",
        "--resolution",
        "delivered",
      ],
      environment,
      github: {},
      telegram: {
        async sendMessage(message) {
          messages.push(message);
        },
      },
      write: (text) => output.push(text),
      warn: (message) => warnings.push(message),
    });

  assert.equal(await run(), 0);
  assert.deepEqual(warnings, []);
  // The person confirmed the topic already received the notice.
  assert.deepEqual(messages, []);
  assert.deepEqual(JSON.parse(output.join("").trimEnd()), {
    kind: "notice",
    update_identifier: 31,
    session_key: sessionKey,
    resolution: "delivered",
    pull_request_number: 200,
    commit: "a".repeat(40),
  });
  const store = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  assert.equal(store.state(31), "sent");
  store.close();

  assert.equal(await run(), 1);
  assert.match(warnings[0], /not an uncertain case/u);
});

test("follows a published instruction with the pull request the operator confirms", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  interruptInstruction(statePath);
  // The service already tracks CI notices; the failed registration is what the
  // command restores.
  new CiWatchStore(join(statePath, "ci-watch.sqlite")).close();
  const commit = "a".repeat(40);
  const messages = [];
  const output = [];
  const warnings = [];

  const exitCode = await runReconcileCommand({
    argv: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "11",
      "--resolution",
      "published",
      "--commit",
      commit,
      "--pull-request",
      "200",
    ],
    environment,
    github: {},
    telegram: {
      async sendMessage(message) {
        messages.push(message);
      },
    },
    write: (text) => output.push(text),
    warn: (message) => warnings.push(message),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(warnings, []);
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(output.join("").trimEnd()), {
    kind: "instruction",
    update_identifier: 11,
    session_key: sessionKey,
    resolution: "published",
    pull_request_number: 200,
    commit,
  });
  const watches = new CiWatchStore(join(statePath, "ci-watch.sqlite"));
  assert.deepEqual(
    watches
      .pending()
      .map((row) => [
        row.update_identifier,
        row.session_key,
        row.pull_request_number,
        row.commit_sha,
      ]),
    [[11, sessionKey, 200, commit]],
  );
  watches.close();
});

test("resolves one case in-process and refuses to repeat it without a second notice", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  interruptInstruction(statePath);
  const messages = [];
  const output = [];
  const warnings = [];
  const run = () =>
    runReconcileCommand({
      argv: [
        "resolve",
        "--kind",
        "instruction",
        "--update",
        "11",
        "--resolution",
        "not_published",
      ],
      environment,
      github: {},
      telegram: {
        async sendMessage(message) {
          messages.push(message);
        },
      },
      write: (text) => output.push(text),
      warn: (message) => warnings.push(message),
    });

  assert.equal(await run(), 0);
  assert.deepEqual(warnings, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chatIdentifier, -1001234567890);
  assert.equal(messages[0].messageThreadIdentifier, 7);
  const lines = output.join("").trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    kind: "instruction",
    update_identifier: 11,
    session_key: sessionKey,
    resolution: "not_published",
    pull_request_number: null,
    commit: null,
  });

  assert.equal(await run(), 1);
  assert.match(warnings[0], /not an uncertain case/u);
  assert.equal(messages.length, 1);
  assert.equal(output.join("").trimEnd().split("\n").length, 1);
});

test("keeps the notice of a resolution for the next turn of the session", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  interruptInstruction(statePath);
  new CiWatchStore(join(statePath, "ci-watch.sqlite")).close();
  // The service already created its conversation state.
  const notes = new SessionNoteStore(join(statePath, "session-notes.sqlite"));
  notes.close();
  const messages = [];

  const exitCode = await runReconcileCommand({
    argv: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "11",
      "--resolution",
      "not_published",
    ],
    environment,
    github: {},
    telegram: {
      async sendMessage(message) {
        messages.push(message);
      },
    },
    write: () => {},
    warn: () => {},
  });

  assert.equal(exitCode, 0);
  assert.equal(messages.length, 1);
  const reopened = new SessionNoteStore(
    join(statePath, "session-notes.sqlite"),
  );
  assert.equal(reopened.lastReply(sessionKey), messages[0].text);
  assert.deepEqual(
    reopened.claim(sessionKey).map((note) => note.text),
    [messages[0].text],
    "the resolution reaches the next turn once",
  );
  reopened.close();
});

test("keeps the notice of a resolution that Telegram cannot deliver", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  interruptInstruction(statePath);
  new CiWatchStore(join(statePath, "ci-watch.sqlite")).close();
  new SessionNoteStore(join(statePath, "session-notes.sqlite")).close();
  const warnings = [];

  const exitCode = await runReconcileCommand({
    argv: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "11",
      "--resolution",
      "not_published",
    ],
    environment,
    github: {},
    telegram: {
      async sendMessage() {
        throw new Error("telegram is down");
      },
    },
    write: () => {},
    warn: (message) => warnings.push(message),
  });

  assert.equal(exitCode, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not be sent/u);
  const reopened = new SessionNoteStore(
    join(statePath, "session-notes.sqlite"),
  );
  assert.equal(
    reopened.claim(sessionKey).length,
    1,
    "the effect is kept even when its notice fails",
  );
  reopened.close();
});
