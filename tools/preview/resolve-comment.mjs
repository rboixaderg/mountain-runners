#!/usr/bin/env node
// Comment-triggered publish resolution (T6.3).
//
// The trusted publisher runs on every issue_comment event. A comment with the
// exact text `/preview` on a pull request, written by a repository
// collaborator, is the explicit maintainer authorization to publish: this
// script verifies the author, resolves the pull request and its latest
// successful Preview build run from trusted platform metadata and exposes
// them as step outputs. Everything else exits quietly so ordinary comments
// produce a fast no-op run; an unauthorized `/preview` fails loudly.
//
// For workflow_dispatch runs the script only marks the job as publishable:
// the dispatch inputs already carry the pull request and the run id.

import { appendFileSync, readFileSync } from "node:fs";
import {
  assertCommentAuthorized,
  resolveLatestBuildRun,
} from "./publish-operations.mjs";

const previewPublishCommand = "/preview";

function readEvent() {
  if (process.env.GITHUB_EVENT_PATH === undefined) {
    throw new Error("GITHUB_EVENT_PATH is required to read the event.");
  }
  return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
}

function writeOutputs(outputs) {
  if (process.env.GITHUB_OUTPUT === undefined) {
    return;
  }
  const lines = Object.entries(outputs)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to resolve the publish trigger.`);
  }
  return value;
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== "issue_comment") {
    writeOutputs({ should_publish: "true" });
    return;
  }

  const event = readEvent();
  const commentBody = event.comment?.body ?? "";
  if (commentBody.trim() !== previewPublishCommand) {
    writeOutputs({ should_publish: "false" });
    console.log("The comment does not request a preview publish.");
    return;
  }
  if (event.issue?.pull_request === undefined) {
    writeOutputs({ should_publish: "false" });
    console.log("The comment is not on a pull request.");
    return;
  }

  const repository = requireEnvironment("GITHUB_REPOSITORY");
  const pullNumber = event.issue.number;
  await assertCommentAuthorized({
    repository,
    apiUrl: process.env.GITHUB_API_URL,
    token: process.env.GITHUB_TOKEN,
    commentAuthor: event.comment.user?.login,
  });

  const run = await resolveLatestBuildRun({
    repository,
    apiUrl: process.env.GITHUB_API_URL,
    token: process.env.GITHUB_TOKEN,
    pullNumber,
  });

  writeOutputs({
    should_publish: "true",
    pull_number: String(pullNumber),
    build_run_id: String(run.id),
  });
  console.log(
    `Comment authorized by ${event.comment.user?.login}; publishing pull request ${pullNumber} from run ${run.id}.`,
  );
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
