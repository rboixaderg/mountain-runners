import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cliPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "prune-worktrees.mjs",
);

function runCli(argumentsList) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
}

test("refuses an unknown or mistyped flag before reading the configuration", () => {
  for (const flag of ["--dryrun", "-n", "--dry-run=maybe"]) {
    const result = runCli([flag]);
    assert.equal(result.status, 1, flag);
    assert.match(
      result.stderr,
      /Usage: node storage\/prune-worktrees\.mjs/u,
      flag,
    );
    assert.doesNotMatch(result.stderr, /MOUNTAIN_AGENT_REPOSITORY/u, flag);
  }
});

test("accepts --dry-run and reads the configuration next", () => {
  const result = runCli(["--dry-run"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /MOUNTAIN_AGENT_REPOSITORY/u);
  assert.doesNotMatch(result.stderr, /Usage: node storage/u);
});
