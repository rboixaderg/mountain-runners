#!/usr/bin/env node
// Production deploy entrypoint (phase 5, task 5.4).
//
// Intended to run on a GitHub-hosted runner with the production environment
// secrets. It never prints credentials, never rebuilds the site and never
// deploys from a local worktree.

import {
  createGithubHeadResolver,
  createSmokeRunner,
  deployRelease,
  smokeExpectsNoIndex,
} from "./operations.mjs";
import { createSshTransport } from "./ssh.mjs";

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function main() {
  const candidateCommit = requireEnvironment("CANDIDATE_COMMIT");
  const message = await deployRelease({
    artifactDirectory: process.env.ARTIFACT_DIRECTORY ?? "artifacts/release",
    candidateCommit,
    resolveHead: createGithubHeadResolver(process.env),
    transport: createSshTransport({
      host: requireEnvironment("DEPLOY_HOST"),
      user: process.env.DEPLOY_USER || "mountain-deploy",
      privateKey: requireEnvironment("DEPLOY_SSH_PRIVATE_KEY"),
      knownHosts: requireEnvironment("DEPLOY_KNOWN_HOSTS"),
    }),
    smoke: createSmokeRunner({
      baseUrl: requireEnvironment("SMOKE_BASE_URL"),
      expectNoIndex: smokeExpectsNoIndex(process.env.SMOKE_EXPECT_NOINDEX),
    }),
  });
  console.log(message);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
