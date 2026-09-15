#!/usr/bin/env node
// Publish request resolution (T6.3).
//
// The trusted `authorize` job of the Preview workflow runs this script. A
// comment with the exact text `/preview` on a pull request, written by a
// repository collaborator, is the explicit maintainer authorization to
// publish: this script verifies the author, resolves the pull request's
// current head SHA from trusted platform metadata and exposes it to the
// build and publish jobs. A manual workflow_dispatch carries the pull
// request number directly (dispatching already requires write access).
// Everything else exits quietly so ordinary comments produce a fast no-op
// run; an unauthorized `/preview` fails loudly.

import { appendFileSync, readFileSync } from "node:fs";
import {
  assertCommentAuthorized,
  resolvePullRequestState,
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
    throw new Error(`${name} is required to resolve the publish request.`);
  }
  return value;
}

function requirePullNumber(value) {
  if (!/^\d+$/u.test(value ?? "")) {
    throw new Error(
      `PREVIEW_PULL_NUMBER must be a decimal pull request number, got ${value}.`,
    );
  }
  return Number(value);
}

async function main() {
  const repository = requireEnvironment("GITHUB_REPOSITORY");
  const apiUrl = process.env.GITHUB_API_URL;
  const token = process.env.GITHUB_TOKEN;

  let pullNumber;
  if (process.env.GITHUB_EVENT_NAME === "issue_comment") {
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
    pullNumber = event.issue.number;
    await assertCommentAuthorized({
      repository,
      apiUrl,
      token,
      commentAuthor: event.comment.user?.login,
    });
  } else {
    pullNumber = requirePullNumber(process.env.PREVIEW_PULL_NUMBER);
  }

  // Resolves the current head SHA and rejects early a closed pull request or
  // a fork head; the publish job revalidates immediately before activation.
  const pullRequest = await resolvePullRequestState({
    repository,
    apiUrl,
    token,
    pullNumber,
  });

  writeOutputs({
    should_publish: "true",
    pull_number: String(pullNumber),
    head_sha: pullRequest.headSha,
  });
  console.log(
    `Publish request authorized; building pull request ${pullNumber} at head ${pullRequest.headSha}.`,
  );
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
