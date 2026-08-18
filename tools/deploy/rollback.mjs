#!/usr/bin/env node
// Protected production rollback entrypoint (phase 5, task 5.4).
//
// Activates a previous eligible release without rebuilding. A delayed deploy
// of an older commit is not a rollback: only this workflow may move the live
// pointer backwards.

import { createSmokeRunner, rollbackRelease } from "./operations.mjs";
import { commitPattern } from "../server/release/validate.mjs";
import { createSshTransport } from "./ssh.mjs";

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalCommit() {
  const commit = process.env.ROLLBACK_COMMIT;
  if (commit === undefined || commit === "") {
    return undefined;
  }
  if (!commitPattern.test(commit)) {
    throw new Error("ROLLBACK_COMMIT must be a 40-character hex SHA-1.");
  }
  return commit;
}

async function main() {
  const message = await rollbackRelease({
    commit: optionalCommit(),
    transport: createSshTransport({
      host: requireEnvironment("DEPLOY_HOST"),
      user: process.env.DEPLOY_USER || "mountain-deploy",
      privateKey: requireEnvironment("DEPLOY_SSH_PRIVATE_KEY"),
      knownHosts: requireEnvironment("DEPLOY_KNOWN_HOSTS"),
    }),
    smoke: createSmokeRunner({
      baseUrl: requireEnvironment("SMOKE_BASE_URL"),
      expectNoIndex: process.env.SMOKE_EXPECT_NOINDEX !== "false",
    }),
  });
  console.log(message);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
