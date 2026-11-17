import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");

function temporaryDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-migrate-cli-"));
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

test("creates the salt with a private mode whatever the caller umask is", (context) => {
  const directory = temporaryDirectory(context);
  const state = join(directory, "state");

  const previousUmask = process.umask(0o022);
  const result = spawnSync(process.execPath, [cliPath], {
    encoding: "utf8",
    env: serviceEnvironment(directory, state),
  });
  process.umask(previousUmask);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /migrated 0 worktree\(s\)/u);
  assert.equal(
    (statSync(join(state, "identifier-salt")).mode & 0o777).toString(8),
    "600",
  );
});

test("exits with code 1 on a missing configuration value", (context) => {
  const directory = temporaryDirectory(context);
  const environment = serviceEnvironment(directory, join(directory, "state"));
  delete environment.MOUNTAIN_AGENT_GITHUB_TOKEN;

  const result = spawnSync(process.execPath, [cliPath], {
    encoding: "utf8",
    env: environment,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /MOUNTAIN_AGENT_GITHUB_TOKEN/u);
});
