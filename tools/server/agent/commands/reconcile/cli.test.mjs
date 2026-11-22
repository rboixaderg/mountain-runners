import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";

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

function serviceEnvironment(directory, state) {
  return {
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
    MOUNTAIN_AGENT_STATE_PATH: state,
  };
}

function runCli(argumentsList, environment = { PATH: process.env.PATH }) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    env: environment,
  });
}

// The installation already ran the identifier migration: the instruction case
// can be attributed and the command does not need to create the salt.
function createInstallationIdentity(state) {
  openIdentifierNames(state);
}

// An interrupted instruction whose topic worktree does not exist locally: the
// GitHub read is skipped, so the command never needs the network.
function createUncertainInstruction(state) {
  const queue = new AdmissionQueue(join(state, "admission.sqlite"), {
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

// A publication whose notice may or may not have reached the topic.
function createUncertainNotice(state) {
  const store = new CiWatchStore(join(state, "ci-watch.sqlite"));
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

// A case a person already resolved: it must be refused, never overwritten.
function createResolvedInstruction(state) {
  const queue = new AdmissionQueue(join(state, "admission.sqlite"), {
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

test("lists an uncertain CI notice without the network", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");
  mkdirSync(state);
  createUncertainNotice(state);

  const result = runCli(["list"], serviceEnvironment(directory, state));

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  const facts = JSON.parse(lines[0]);
  assert.equal(facts.kind, "notice");
  assert.equal(facts.update_identifier, 31);
  assert.equal(facts.session_key, sessionKey);
  assert.equal(facts.pull_request_number, 200);
  assert.equal(facts.commit, "a".repeat(40));
  assert.equal(facts.result, "success");
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
  { argumentsList: ["list", "--kind", "notice"] },
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
    argumentsList: [
      "resolve",
      "--kind",
      "repair",
      "--update",
      "1",
      "--resolution",
      "published",
      "--commit",
      "A".repeat(40),
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "repair",
      "--update",
      "1",
      "--resolution",
      "not_published",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "repair",
      "--update",
      "1",
      "--sequence",
      "1",
      "--resolution",
      "not_published",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "repair",
      "--update",
      "1",
      "--sequence",
      "1",
      "--failed-commit",
      "abc",
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
      "--sequence",
      "1",
      "--failed-commit",
      "a".repeat(40),
      "--resolution",
      "not_published",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "notice",
      "--update",
      "1",
      "--resolution",
      "commented",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "notice",
      "--update",
      "1",
      "--resolution",
      "delivered",
      "--commit",
      "a".repeat(40),
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "notice",
      "--update",
      "1",
      "--sequence",
      "1",
      "--resolution",
      "resend",
    ],
  },
  {
    argumentsList: ["resolve", "--kind", "notice", "--update", "1"],
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
  {
    argumentsList: [
      "resolve",
      "--kind",
      "repair",
      "--update",
      "1",
      "--sequence",
      "1",
      "--failed-commit",
      "a".repeat(40),
      "--resolution",
      "published",
      "--commit",
      "a".repeat(40),
      "--pull-request",
      "5",
    ],
  },
  {
    argumentsList: [
      "resolve",
      "--kind",
      "notice",
      "--update",
      "1",
      "--resolution",
      "delivered",
      "--pull-request",
      "5",
    ],
  },
  { argumentsList: ["list", "--pull-request", "5"] },
  {
    // The published commit of a repair is a different commit than the failed one.
    argumentsList: [
      "resolve",
      "--kind",
      "repair",
      "--update",
      "12",
      "--sequence",
      "1",
      "--failed-commit",
      "a".repeat(40),
      "--resolution",
      "published",
      "--commit",
      "a".repeat(40),
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

test("exits with code 1 when a repair is not uncertain", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");
  mkdirSync(state);

  const result = runCli(
    [
      "resolve",
      "--kind",
      "repair",
      "--update",
      "12",
      "--sequence",
      "1",
      "--failed-commit",
      "a".repeat(40),
      "--resolution",
      "not_published",
    ],
    serviceEnvironment(directory, state),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an uncertain case/u);
  assert.equal(result.stdout, "");
  assert.deepEqual(readdirSync(state), []);
});
