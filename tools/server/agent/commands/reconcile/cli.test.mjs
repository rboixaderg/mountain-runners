import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import { createLegacyDatabase } from "../../repository/test-support/legacy-databases.mjs";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");
const sessionKey = "-1001234567890:7";

function temporaryDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-reconcile-cli-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return directory;
}

// A complete synthetic environment whose `systemctl` reports `serviceState`.
function serviceEnvironment(directory, state, serviceState = "inactive") {
  writeFileSync(
    join(directory, "systemctl"),
    `#!/bin/sh\necho ${serviceState}\n`,
    { mode: 0o755 },
  );
  return {
    PATH: `${directory}${delimiter}${process.env.PATH}`,
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
    MOUNTAIN_AGENT_STATE_PATH: state,
  };
}

function runCli(argumentsList, environment = { PATH: process.env.PATH }) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    env: environment,
  });
}

// The installation has its salt: the instruction case
// can be attributed and the command does not need to create the salt.
function createInstallationIdentity(state) {
  openIdentifierNames(state);
}

// An interrupted instruction whose topic worktree does not exist locally: the
// GitHub read is skipped, so the command never needs the network.
function createUncertainInstruction(state) {
  const queue = new AdmissionQueue(join(state, "agent.sqlite"), {
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

// A case a person already resolved: it must be refused, never overwritten.
function createResolvedInstruction(state) {
  const queue = new AdmissionQueue(join(state, "agent.sqlite"), {
    maxPending: 10,
  });
  queue.admit({
    updateIdentifier: 12,
    messageIdentifier: 1012,
    sessionKey,
    authorIdentifier: 42,
    instruction: "synthetic private instruction",
  });
  queue.next();
  queue.complete(12, "answered");
  queue.close();
}

test("prints nothing, exits 0 and creates no database in an empty state directory", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");
  mkdirSync(state);

  // The command must not depend on the umask of its caller to keep the state
  // private, and it must never create a database.
  const previousUmask = process.umask(0o022);
  const result = runCli(["list"], serviceEnvironment(directory, state));
  process.umask(previousUmask);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(readdirSync(state), []);
});

test("lists an uncertain instruction without the network", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");
  mkdirSync(state);
  createInstallationIdentity(state);
  createUncertainInstruction(state);

  const result = runCli(["list"], serviceEnvironment(directory, state));

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  const facts = JSON.parse(lines[0]);
  assert.equal(facts.kind, "instruction");
  assert.equal(facts.update_identifier, 11);
  assert.equal(facts.session_key, sessionKey);
  assert.equal(facts.worktree, null);
  assert.equal(facts.pull_request, null);
  assert.equal(facts.github, "skipped");
  assert.doesNotMatch(result.stdout, /synthetic private instruction/u);
});

test("lists the case of a restored earlier state after migrating it", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");
  mkdirSync(state);
  createInstallationIdentity(state);
  createLegacyDatabase(state, "admission.sqlite", {
    instructions: [
      {
        update_identifier: 11,
        message_identifier: 1011,
        session_key: sessionKey,
        author_identifier: 42,
        instruction: "synthetic private instruction",
        status: "uncertain",
        created_at: "2026-11-20T10:00:00.000Z",
      },
    ],
  });

  const result = runCli(["list"], serviceEnvironment(directory, state));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).update_identifier, 11);
  assert.deepEqual(readdirSync(state).sort(), [
    "admission.sqlite.migrated",
    "agent-migration.lock",
    "agent.sqlite",
    "identifier-salt",
  ]);
});

test("refuses to run, and migrates nothing, while the service is not stopped", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");
  mkdirSync(state);
  createLegacyDatabase(state, "admission.sqlite");

  const result = runCli(
    ["list"],
    serviceEnvironment(directory, state, "active"),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is-active mountain-agent reports "active"/u);
  assert.deepEqual(readdirSync(state), ["admission.sqlite"]);
});

test("exits with code 1 when the case is already resolved", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");
  mkdirSync(state);
  createInstallationIdentity(state);
  createResolvedInstruction(state);
  createUncertainInstruction(state);

  const result = runCli(
    [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "12",
      "--resolution",
      "not_published",
    ],
    serviceEnvironment(directory, state),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an uncertain case/u);
  assert.equal(result.stdout, "");
});

test("exits with code 1 on a missing state directory", (context) => {
  const directory = temporaryDirectory(context);

  const result = runCli(
    ["list"],
    serviceEnvironment(directory, join(directory, "state")),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not exist/u);
});

test("exits with code 1 on a missing configuration value", () => {
  const result = runCli(["list"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MOUNTAIN_AGENT_REPOSITORY/u);
});

// Every usage error is reported before the environment is read.
const usageCases = [
  { argumentsList: [] },
  { argumentsList: ["--verbose"] },
  { argumentsList: ["list", "extra"] },
  { argumentsList: ["list", "--kind", "merge"] },
  { argumentsList: ["inspect"] },
  { argumentsList: ["resolve"] },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "merge",
      "--update",
      "1",
      "--resolution",
      "published",
      "--commit",
      "a".repeat(40),
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "0",
      "--resolution",
      "not_published",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "delivered",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "published",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "not_published",
      "--commit",
      "a".repeat(40),
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "published",
      "--commit",
      "abc",
    ],
  },
  {
    // A published instruction needs the pull request of the publication.
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "published",
      "--commit",
      "a".repeat(40),
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "published",
      "--commit",
      "a".repeat(40),
      "--pull-request",
      "0",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "published",
      "--commit",
      "a".repeat(40),
      "--pull-request",
      "twelve",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "instruction",
      "--update",
      "1",
      "--resolution",
      "not_published",
      "--pull-request",
      "5",
    ],
  },
  { argumentsList: ["list", "--pull-request", "5"] },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "notice",
      "--update",
      "1",
      "--resolution",
      "delivered",
    ],
  },
];

test("exits with code 2 on every usage error", () => {
  for (const { argumentsList } of usageCases) {
    const result = runCli(argumentsList);
    assert.equal(result.status, 2, argumentsList.join(" "));
    assert.match(result.stderr, /Usage: node commands\/reconcile\/cli\.mjs/u);
    assert.doesNotMatch(result.stderr, /MOUNTAIN_AGENT_/u);
  }
});
