import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildPiArguments } from "telegram-pi-bridge/pi";
import { projectPiOptions } from "./pi-adapter.mjs";
import {
  classificationRetryDelaysMilliseconds,
  classificationTimeoutMilliseconds,
  classifyRequest,
  maximumClassificationTimeoutMilliseconds,
} from "./request-kind.mjs";

test("classifies without tools, repository context, extensions or session history", () => {
  const options = projectPiOptions({
    config: {
      model: {
        identifier: "synthetic",
        providerEnvironmentVariables: [],
        sandboxImage: "sandbox:1",
      },
      paths: { worktrees: "/synthetic-worktrees" },
      limits: { executionTimeoutMs: 1000 },
    },
    profileDirectory: "/synthetic-profile",
    sandboxIdentifier: "topic-0123456789abcdef",
    worktreePath: "/synthetic-worktrees/topic",
    attachments: [{ name: "imatge-1.png" }],
    classifyOnly: true,
  });
  const argumentsList = buildPiArguments(options);
  for (const flag of [
    "--no-tools",
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-session",
  ]) {
    assert.equal(argumentsList.includes(flag), true, flag);
  }
  assert.equal(argumentsList.includes("--session-id"), false);
  assert.equal(argumentsList.includes("--tools"), false);
  assert.equal(
    Object.keys(options.environment).some((name) =>
      name.startsWith("MR_AGENT_"),
    ),
    false,
    "the classifier inherits neither the sandbox nor the attachment environment",
  );
});

test("bounds the classification with its own short timeout", () => {
  assert.equal(maximumClassificationTimeoutMilliseconds, 60 * 1000);
  assert.deepEqual(classificationRetryDelaysMilliseconds, [2000, 5000]);
  assert.equal(
    classificationTimeoutMilliseconds({
      limits: { executionTimeoutMs: 30 * 60 * 1000 },
    }),
    maximumClassificationTimeoutMilliseconds,
  );
  assert.equal(
    classificationTimeoutMilliseconds({ limits: { executionTimeoutMs: 5000 } }),
    5000,
    "the configured execution deadline still wins when it is shorter",
  );
});

function classificationConfig(directory) {
  return {
    paths: { state: directory },
    limits: { executionTimeoutMs: 30 * 60 * 1000 },
  };
}

const classificationContext = {
  instruction: "fes el títol més curt",
  context: {
    lastAgentReply: null,
    pendingLocalWork: true,
    topicPullRequest: 301,
  },
};

function rateLimited() {
  return {
    text: "",
    timedOut: false,
    aborted: false,
    errorMessage:
      '429: {"message":"Rate limit reached for requests","code":"rate_limit_exceeded"}',
  };
}

function answered(text) {
  return { text, timedOut: false, aborted: false, errorMessage: null };
}

test("asks the classification again after a provider rate limit", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-classifier-retry-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const answers = [
    rateLimited(),
    rateLimited(),
    answered('{"kind":"continuation"}'),
  ];
  const waits = [];
  const result = await classifyRequest(classificationConfig(directory), {
    ...classificationContext,
    environment: {},
    retryDelaysMilliseconds: [10, 20],
    runPrompt: async () => answers.shift(),
    wait: async (milliseconds) => waits.push(milliseconds),
  });
  assert.deepEqual(result, { kind: "continuation" });
  assert.deepEqual(waits, [10, 20], "two retries with the injected backoff");
});

test("stops asking after the last retry of a rate limit", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-classifier-limit-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let attempts = 0;
  await assert.rejects(
    classifyRequest(classificationConfig(directory), {
      ...classificationContext,
      environment: {},
      retryDelaysMilliseconds: [10, 20],
      runPrompt: async () => {
        attempts += 1;
        return rateLimited();
      },
      wait: async () => {},
    }),
    /did not complete/u,
    "a lasting rate limit fails the request instead of becoming a clarification",
  );
  assert.equal(attempts, 3, "the first attempt and two retries");
});

test("never asks again for a failure that is not a rate limit", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-classifier-error-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let attempts = 0;
  await classifyRequest(classificationConfig(directory), {
    ...classificationContext,
    environment: {},
    retryDelaysMilliseconds: [10, 20],
    runPrompt: async () => {
      attempts += 1;
      return { ...answered(""), errorMessage: "401: invalid api key" };
    },
    wait: async () => {},
  });
  assert.equal(attempts, 1);
});

test("never asks again after a stop", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-classifier-abort-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    classifyRequest(classificationConfig(directory), {
      ...classificationContext,
      environment: {},
      signal: controller.signal,
      retryDelaysMilliseconds: [10, 20],
      runPrompt: async () => {
        attempts += 1;
        controller.abort();
        return { ...rateLimited(), aborted: true };
      },
      wait: async () => {},
    }),
    /did not complete/u,
  );
  assert.equal(attempts, 1, "a stopped classification is never asked again");
});
