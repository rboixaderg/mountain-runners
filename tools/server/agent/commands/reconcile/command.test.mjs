import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
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
