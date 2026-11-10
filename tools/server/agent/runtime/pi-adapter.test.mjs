import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPiArguments } from "telegram-pi-bridge/pi";
import { projectPiOptions } from "./pi-adapter.mjs";

test("keeps project credentials out of Pi and explicitly enables only the isolated tool", async () => {
  const stopped = [];
  const options = projectPiOptions({
    config: {
      model: {
        identifier: "example/model",
        providerEnvironmentVariables: ["PROVIDER_KEY"],
        sandboxImage: "sandbox:1",
      },
      paths: { sessions: "/private/sessions", worktrees: "/private/worktrees" },
      limits: { executionTimeoutMs: 1000 },
    },
    profileDirectory: "/private/profile",
    sessionIdentifier: "synthetic_topic_7",
    worktreePath: "/private/worktrees/topic",
    readOnly: true,
    environment: {
      PATH: "/usr/bin",
      HOME: "/private/home",
      XDG_RUNTIME_DIR: "/private/runtime",
      PROVIDER_KEY: "synthetic-provider",
      GITHUB_TOKEN: "synthetic-github",
      TELEGRAM_BOT_TOKEN: "synthetic-telegram",
    },
    stopCommands: async (identifier) => stopped.push(identifier),
  });
  assert.equal(options.environment.PROVIDER_KEY, "synthetic-provider");
  assert.equal(options.environment.XDG_RUNTIME_DIR, "/private/runtime");
  assert.equal(options.environment.GITHUB_TOKEN, undefined);
  assert.equal(options.environment.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(options.environment.MR_AGENT_READ_ONLY, "true");
  assert.deepEqual(options.tools, ["sandbox_bash"]);
  assert.deepEqual(options.extensions, [
    "/private/profile/extensions/sandbox-bash.ts",
  ]);
  const argumentsList = buildPiArguments(options);
  assert.equal(argumentsList.includes("--no-extensions"), true);
  assert.equal(argumentsList.includes("--no-context-files"), true);
  assert.equal(
    argumentsList[argumentsList.indexOf("--tools") + 1],
    "sandbox_bash",
  );
  await options.onInterrupted();
  assert.deepEqual(stopped, ["synthetic_topic_7"]);
});
