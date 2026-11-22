#!/usr/bin/env node
// Publish request resolution (T6.3).
//
// Resolve the current PR head via the API, never from GITHUB_SHA, which in a
// pull request event is the last commit of main. The workflow filters unrelated
// events; a label removed before authorization skips the build. Other denials fail.

import { appendFileSync, readFileSync } from "node:fs";
import {
  assertActorWritePermission,
  MissingPreviewLabelError,
  previewActorOf,
  resolvePullRequestState,
} from "./publish-operations.mjs";

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

  const eventName = process.env.GITHUB_EVENT_NAME;
  const isPullRequestEvent = eventName === "pull_request_target";
  const event = isPullRequestEvent ? readEvent() : undefined;
  const actor = previewActorOf({
    eventName,
    event,
    workflowActor: process.env.GITHUB_ACTOR,
  });

  const pullNumber = isPullRequestEvent
    ? event.pull_request.number
    : requirePullNumber(process.env.PREVIEW_PULL_NUMBER);
  await assertActorWritePermission({ repository, apiUrl, token, actor });
  const pullRequest = await resolvePullRequestState({
    repository,
    apiUrl,
    token,
    pullNumber,
  }).catch((error) => {
    if (!isPullRequestEvent || !(error instanceof MissingPreviewLabelError))
      throw error;
    console.log(error.message);
    return null;
  });
  if (pullRequest === null) {
    writeOutputs({ should_publish: "false" });
    return;
  }
  const { headSha } = pullRequest;
  writeOutputs({
    should_publish: "true",
    pull_number: String(pullNumber),
    head_sha: headSha,
  });
  console.log(
    `Publish request authorized; building pull request ${pullNumber} at head ${headSha}.`,
  );
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
