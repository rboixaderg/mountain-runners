import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createLegacyDatabase } from "../../repository/test-support/legacy-databases.mjs";

const cliPath = fileURLToPath(new URL("cli.mjs", import.meta.url));

function directoryFor(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-migrate-state-cli-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runCli(...argumentsList) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
}

test("prints the row counts of a rehearsal and leaves the directory as it was", (context) => {
  const state = directoryFor(context);
  createLegacyDatabase(state, "topic-jobs.sqlite", {
    topic_jobs: [
      {
        session_key: "-100123:7",
        branch: "feat/agent-synthetic",
        pull_request_number: 42,
      },
    ],
  });
  const before = readFileSync(join(state, "topic-jobs.sqlite"));

  const result = runCli(state);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Before:\n {2}topic-jobs\.sqlite topic_jobs: 1\nAfter:\n/u,
  );
  assert.match(result.stdout, /agent\.sqlite topic_jobs: 1\n/u);
  assert.match(result.stdout, /agent\.sqlite publications: 0\n/u);
  assert.match(result.stdout, /succeeded: topic-jobs\.sqlite\./u);
  assert.deepEqual(readdirSync(state), ["topic-jobs.sqlite"]);
  assert.deepEqual(readFileSync(join(state, "topic-jobs.sqlite")), before);
});

test("exits with code 1 when the copy cannot be migrated", (context) => {
  const state = directoryFor(context);
  writeFileSync(join(state, "topic-jobs.sqlite"), "broken".repeat(100));

  const result = runCli(state);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /file is not a database/u);
  assert.deepEqual(readdirSync(state), ["topic-jobs.sqlite"]);
});

test("exits with code 2 without exactly one directory", () => {
  for (const argumentsList of [[], ["a", "b"]]) {
    const result = runCli(...argumentsList);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage/u);
  }
});
