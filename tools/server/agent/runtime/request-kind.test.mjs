import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPiArguments } from "telegram-pi-bridge/pi";
import { projectPiOptions } from "./pi-adapter.mjs";
import {
  classificationTimeoutMilliseconds,
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
