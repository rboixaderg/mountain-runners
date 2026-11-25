import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { PublicationStore } from "../../repository/publication-store.mjs";
import { SessionNoteStore } from "../../repository/session-note-store.mjs";
import { TopicJobStore } from "../../repository/topic-job-store.mjs";
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
  const queue = new AdmissionQueue(join(statePath, "agent.sqlite"), {
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

test("follows a published instruction with the pull request the operator confirms", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  interruptInstruction(statePath);
  // The topic already continues this pull request.
  const topicJobs = new TopicJobStore(join(statePath, "agent.sqlite"));
  topicJobs.bind({
    sessionKey,
    branch: "feat/agent-synthetic-change-11",
    pullRequestNumber: 200,
  });
  topicJobs.close();
  const commit = "a".repeat(40);
  const messages = [];
  const output = [];
  const warnings = [];

  const exitCode = await runReconcileCommand({
    readServiceState: () => "inactive",
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
  const publications = new PublicationStore(join(statePath, "agent.sqlite"));
  assert.deepEqual(
    publications
      .pendingCiWatches()
      .map((row) => [
        row.update_identifier,
        row.session_key,
        row.pull_request_number,
        row.commit_sha,
      ]),
    [[11, sessionKey, 200, commit]],
  );
  assert.deepEqual(
    publications
      .awaitingPreviews()
      .map((row) => [row.author_identifier, row.commit_sha]),
    [[42, commit]],
  );
  publications.close();
});

test("resolves one case in-process and refuses to repeat it without a second notice", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  interruptInstruction(statePath);
  const messages = [];
  const output = [];
  const warnings = [];
  const run = () =>
    runReconcileCommand({
      readServiceState: () => "inactive",
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
  const messages = [];

  const exitCode = await runReconcileCommand({
    readServiceState: () => "inactive",
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
  const reopened = new SessionNoteStore(join(statePath, "agent.sqlite"));
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
  const warnings = [];

  const exitCode = await runReconcileCommand({
    readServiceState: () => "inactive",
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
  const reopened = new SessionNoteStore(join(statePath, "agent.sqlite"));
  assert.equal(
    reopened.claim(sessionKey).length,
    1,
    "the effect is kept even when its notice fails",
  );
  reopened.close();
});

test("lists without recovering the claim of a previous turn", async (context) => {
  const { environment, statePath } = serviceFixture(context);
  const notes = new SessionNoteStore(join(statePath, "agent.sqlite"));
  notes.addNote({ sessionKey, text: "Efecte en curs." });
  notes.claim(sessionKey);
  notes.close();

  const exitCode = await runReconcileCommand({
    readServiceState: () => "inactive",
    argv: ["list"],
    environment,
    github: {
      async findOpenPullRequest() {
        return null;
      },
      async getPullRequest() {
        return { state: "open", headSha: "a".repeat(40) };
      },
    },
    write: () => {},
    warn: () => {},
  });

  assert.equal(exitCode, 0);
  const database = new DatabaseSync(join(statePath, "agent.sqlite"), {
    readOnly: true,
  });
  const row = database.prepare("SELECT state FROM session_notes").get();
  database.close();
  assert.equal(row.state, "claimed", "a read-only list changed nothing");
});
