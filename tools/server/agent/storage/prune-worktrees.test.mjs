import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";

const cliPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "prune-worktrees.mjs",
);

function runCli(argumentsList, extraEnvironment = {}) {
  return spawnSync(process.execPath, [cliPath, ...argumentsList], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...extraEnvironment },
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

// A complete synthetic installation whose `systemctl` reports `serviceState`.
function createInstallation(context, serviceState) {
  const directory = mkdtempSync(join(tmpdir(), "mr-prune-cli-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state");
  mkdirSync(statePath, { recursive: true });
  const systemctl = join(directory, "systemctl");
  writeFileSync(systemctl, `#!/bin/sh\necho ${serviceState}\n`);
  chmodSync(systemctl, 0o755);
  return {
    statePath,
    environment: {
      PATH: `${directory}${delimiter}${process.env.PATH}`,
      MOUNTAIN_AGENT_REPOSITORY: "rboixaderg/mountain-runners",
      MOUNTAIN_AGENT_TELEGRAM_GROUP_ID: "-1001234567890",
      MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME: "mountain_agent_bot",
      MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN: "synthetic-telegram",
      MOUNTAIN_AGENT_GITHUB_TOKEN: "synthetic-github",
      MOUNTAIN_AGENT_REQUIRED_CHECKS: "Validate",
      MOUNTAIN_AGENT_SANDBOX_IMAGE: "localhost/mountain-agent:test",
      MOUNTAIN_AGENT_REPOSITORY_PATH: join(directory, "repository"),
      MOUNTAIN_AGENT_WORKTREE_PATH: join(directory, "worktrees"),
      MOUNTAIN_AGENT_SESSION_PATH: join(directory, "sessions"),
      MOUNTAIN_AGENT_STATE_PATH: statePath,
    },
  };
}

test("refuses non-dry-run execution while the service is not stopped", (context) => {
  for (const serviceState of ["active", "activating"]) {
    const { environment } = createInstallation(context, serviceState);

    const result = runCli([], environment);

    assert.equal(result.status, 1, serviceState);
    assert.match(
      result.stderr,
      new RegExp(`is-active mountain-agent reports "${serviceState}"`, "u"),
    );
    assert.equal(result.stdout, "");
  }
});

test("refuses non-dry-run execution while an instruction is running or uncertain", (context) => {
  const { statePath, environment } = createInstallation(context, "inactive");
  const queue = new AdmissionQueue(join(statePath, "agent.sqlite"), {
    maxPending: 10,
  });
  queue.admit({
    updateIdentifier: 1,
    messageIdentifier: 2,
    sessionKey: "-100123:1",
    authorIdentifier: 555,
    instruction: "running",
  });
  queue.next();
  queue.close();

  const result = runCli([], environment);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /running or uncertain/u);
});
