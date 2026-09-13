#!/usr/bin/env node
// Preview source-run verification (T6.3): the trusted publisher's first
// gate, executed before the artifact is downloaded. Verifies the source
// workflow run against trusted platform metadata: this repository, the
// preview build workflow, a pull_request event, a successful conclusion, a
// same-repository head (forks get no previews) and the platform binding
// between the run and the pull request.
//
// Required environment:
//   PREVIEW_PULL_NUMBER   pull request number to publish
//   PREVIEW_BUILD_RUN_ID  workflow run id that built the preview artifact
//   GITHUB_REPOSITORY     repository the run belongs to
//   GITHUB_API_URL        GitHub API base URL
//   GITHUB_TOKEN          token with actions: read
import { resolveSourceRun } from "./publish-operations.mjs";

function requireEnvironment(name, purpose) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to ${purpose}.`);
  }
  return value;
}

function requireDecimalIdentifier(name, label, purpose) {
  const value = requireEnvironment(name, purpose);
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be a decimal ${label}, got ${value}.`);
  }
  return Number(value);
}

const pullNumber = requireDecimalIdentifier(
  "PREVIEW_PULL_NUMBER",
  "pull request number",
  "verify the preview source run.",
);
const runId = requireDecimalIdentifier(
  "PREVIEW_BUILD_RUN_ID",
  "workflow run id",
  "verify the preview source run.",
);

resolveSourceRun({
  repository: process.env.GITHUB_REPOSITORY,
  apiUrl: process.env.GITHUB_API_URL,
  token: process.env.GITHUB_TOKEN,
  runId,
  pullNumber,
})
  .then(() => {
    console.log(`Source run ${runId} verified for pull request ${pullNumber}.`);
  })
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
