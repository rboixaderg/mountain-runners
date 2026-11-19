import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");
const topicOne = "-1001234567890:7";
const topicTwo = "-1001234567890:9";

function temporaryStateDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), "mountain-agent-trace-cli-"));
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

function runCli(argumentsList, environment) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...environment },
  });
}

function sequencesOf(result) {
  return result.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line).sequence);
}

// Two entries of the same topic plus one of another, so a filter is observable.
function createStateDirectory(context) {
  const statePath = temporaryStateDirectory(context);
  let hour = 9;
  const queue = new AdmissionQueue(join(statePath, "admission.sqlite"), {
    maxPending: 10,
    now: () => new Date(Date.UTC(2026, 2, 1, hour++, 0, 0)),
  });
  queue.recordTrace({
    updateIdentifier: 700,
    authorIdentifier: 42,
    sessionKey: topicOne,
    action: "instruction_admitted",
    detail: "pr #21",
  });
  queue.recordTrace({
    updateIdentifier: 701,
    authorIdentifier: 43,
    sessionKey: topicOne,
    action: "instruction_completed",
    detail: "pr #21 merged",
  });
  queue.recordTrace({
    updateIdentifier: 702,
    authorIdentifier: 44,
    sessionKey: topicTwo,
    action: "instruction_denied",
    detail: "not_a_group_member",
  });
  queue.close();
  return statePath;
}

test("prints one JSON object per entry as JSON Lines", (context) => {
  const statePath = createStateDirectory(context);
  const result = runCli([], { MOUNTAIN_AGENT_STATE_PATH: statePath });
  assert.equal(result.status, 0, result.stderr);

  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.deepEqual(JSON.parse(lines[0]), {
    sequence: 1,
    update_identifier: 700,
    author_identifier: 42,
    session_key: topicOne,
    action: "instruction_admitted",
    detail: "pr #21",
    created_at: "2026-03-01T09:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(lines[2]), {
    sequence: 3,
    update_identifier: 702,
    author_identifier: 44,
    session_key: topicTwo,
    action: "instruction_denied",
    detail: "not_a_group_member",
    created_at: "2026-03-01T11:00:00.000Z",
  });
});

test("passes each filter to the reader", (context) => {
  const statePath = createStateDirectory(context);
  // Ignoring any option here would print a different selection.
  const filterCases = [
    { argumentsList: ["--since", "2026-03-01T10:00:00Z"], expected: [2, 3] },
    { argumentsList: ["--until", "2026-03-01T10:00:00Z"], expected: [1] },
    { argumentsList: ["--update", "702"], expected: [3] },
    { argumentsList: ["--action", "instruction_denied"], expected: [3] },
    { argumentsList: ["--pull-request", "21"], expected: [1, 2] },
    { argumentsList: [`--topic=${topicOne}`], expected: [1, 2] },
    { argumentsList: ["--limit", "1"], expected: [3] },
  ];

  for (const { argumentsList, expected } of filterCases) {
    const result = runCli(argumentsList, {
      MOUNTAIN_AGENT_STATE_PATH: statePath,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sequencesOf(result), expected, argumentsList.join(" "));
  }
});

test("exits with code 2 on an unknown argument", (context) => {
  const statePath = createStateDirectory(context);
  const result = runCli(["--verbose"], {
    MOUNTAIN_AGENT_STATE_PATH: statePath,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node commands\/trace\/cli\.mjs/u);
});

test("exits with code 2 on an invalid filter value", (context) => {
  const statePath = createStateDirectory(context);
  const result = runCli(["--limit", "0"], {
    MOUNTAIN_AGENT_STATE_PATH: statePath,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /limit must be an integer/u);
});

test("rejects an integer filter that is not a decimal integer", (context) => {
  const statePath = createStateDirectory(context);
  for (const [option, value] of [
    ["--limit", "1e3"],
    ["--limit", "0x10"],
    ["--update", "1.5"],
    ["--pull-request", "+1"],
    ["--limit", " 1"],
  ]) {
    const result = runCli([option, value], {
      MOUNTAIN_AGENT_STATE_PATH: statePath,
    });
    assert.equal(result.status, 2, `${option} ${value}`);
    assert.match(result.stderr, /decimal integer/u, `${option} ${value}`);
  }
});

test("reports misuse before the missing environment variable", () => {
  const result = runCli(["--limit", "0"], {});
  assert.equal(result.status, 2);
  assert.match(result.stderr, /limit must be an integer/u);
  assert.doesNotMatch(result.stderr, /MOUNTAIN_AGENT_STATE_PATH/u);
});

test("exits with code 1 on a missing database", (context) => {
  const statePath = temporaryStateDirectory(context);
  const result = runCli([], { MOUNTAIN_AGENT_STATE_PATH: statePath });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Trace database not found/u);
  assert.equal(existsSync(join(statePath, "admission.sqlite")), false);
});
