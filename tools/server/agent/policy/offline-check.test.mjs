import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkCommands, sandboxCheckCommand } from "./development.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-offline-check-"));
  const binaries = join(directory, "bin");
  const workspace = join(directory, "work");
  const log = join(directory, "calls");
  mkdirSync(binaries);
  mkdirSync(workspace);
  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.33.0" }),
  );
  const pnpm = join(binaries, "pnpm");
  writeFileSync(
    pnpm,
    `#!/bin/sh
if [ "$1" = --version ]; then printf '10.33.0\\n'; exit 0; fi
printf '%s\\n' "$*" >> "$TEST_CALLS"
if [ "$1" = install ]; then
  if [ "$TEST_FAIL_INSTALL" = yes ]; then exit 9; fi
  mkdir -p node_modules
elif [ "$1" = check ] || [ "$1" = check:local ]; then
  test -d "$TMPDIR" || exit 8
  printf '%s\\n' "$TMPDIR" "$MR_AGENT_BROWSER_PROFILE" >> "$TEST_CALLS"
fi
`,
  );
  chmodSync(pnpm, 0o755);
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return { binaries, workspace, log };
}

function runCheck(
  { binaries, workspace, log },
  { failInstall = false, checkCommand = checkCommands.full } = {},
) {
  return execFileSync("bash", ["-c", sandboxCheckCommand(checkCommand)], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      PATH: `${binaries}:${process.env.PATH}`,
      TEST_CALLS: log,
      TEST_FAIL_INSTALL: failInstall ? "yes" : "no",
    },
  });
}

function assertCheckRun(paths, checkArgument) {
  const lines = readFileSync(paths.log, "utf8").trim().split("\n");
  assert.equal(
    lines[0],
    "install --offline --frozen-lockfile --store-dir /opt/mountain-agent/store",
  );
  assert.equal(lines[1], checkArgument);
  assert.match(lines[2], /^.+\/\.agent-check\.[A-Za-z0-9]+$/u);
  assert.equal(lines[3], "chromium");
}

test("installs from the offline store before checking with a private worktree temporary directory", (context) => {
  const paths = fixture(context);
  runCheck(paths);
  assertCheckRun(paths, "check");
});

test("prepares and isolates the fast web checks the same way", (context) => {
  const paths = fixture(context);
  runCheck(paths, { checkCommand: checkCommands.webOnly });
  assertCheckRun(paths, "check:local");
});

test("rejects a package-manager version missing from the image before running pnpm install", (context) => {
  const paths = fixture(context);
  writeFileSync(
    join(paths.workspace, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.33.1" }),
  );
  assert.throws(() => runCheck(paths));
  assert.equal(existsSync(paths.log), false);
});

test("does not run checks after offline installation fails", (context) => {
  const paths = fixture(context);
  assert.throws(() => runCheck(paths, { failInstall: true }), { status: 9 });
  assert.equal(
    readFileSync(paths.log, "utf8").trim(),
    "install --offline --frozen-lockfile --store-dir /opt/mountain-agent/store",
  );
});
