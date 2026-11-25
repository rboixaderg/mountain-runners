import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");
const commit = "0a5722d".padEnd(40, "0");

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
}

test("prints the usage and exits 0 with --help", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: node commands\/update\/cli\.mjs/u);
  assert.match(result.stdout, /--image-rebuilt/u);
  assert.equal(result.stderr, "");
});

test("exits 2 without the required arguments", () => {
  for (const [args, message] of [
    [[], /--repository is required/u],
    [["--repository", "/srv/checkout"], /--commit is required/u],
    [["--unknown"], /Unknown option/u],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, message);
  }
});

test(
  "exits 1 when the process is not root",
  // Root never reaches the refusal, and a platform without getuid has no
  // identity to check.
  { skip: process.getuid === undefined || process.getuid() === 0 },
  () => {
    const result = runCli(["--repository", tmpdir(), "--commit", commit]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /run it as root \(uid 0\)/u);
  },
);
