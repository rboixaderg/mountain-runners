import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPiArguments } from "telegram-pi-bridge/pi";
import { projectPiOptions } from "./pi-adapter.mjs";

test("classifies without tools, repository context, extensions or session history", () => {
  const argumentsList = buildPiArguments(
    projectPiOptions({
      config: {
        model: { identifier: "synthetic", providerEnvironmentVariables: [] },
        paths: {},
        limits: { executionTimeoutMs: 1000 },
      },
      profileDirectory: "/synthetic-profile",
      classifyOnly: true,
    }),
  );
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
});
