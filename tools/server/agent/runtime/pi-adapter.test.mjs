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
        providerEnvironmentVariables: ["PROVIDER_KEY", "MR_AGENT_WEB_RESEARCH"],
        sandboxImage: "sandbox:1",
      },
      paths: { sessions: "/private/sessions", worktrees: "/private/worktrees" },
      limits: { executionTimeoutMs: 1000 },
    },
    profileDirectory: "/private/profile",
    sessionIdentifier: "synthetic_topic_7",
    sandboxIdentifier: "topic-0123456789abcdef",
    worktreePath: "/private/worktrees/topic",
    attachments: [
      { name: "imatge-1.jpg", width: 1200, height: 800 },
      { name: "imatge-2.png", width: 320, height: 240 },
    ],
    readOnly: true,
    environment: {
      PATH: "/usr/bin",
      HOME: "/private/home",
      TMPDIR: "/private/home/tmp",
      XDG_RUNTIME_DIR: "/private/runtime",
      PROVIDER_KEY: "synthetic-provider",
      GITHUB_TOKEN: "synthetic-github",
      TELEGRAM_BOT_TOKEN: "synthetic-telegram",
      MR_AGENT_WEB_RESEARCH: "1",
    },
    stopCommands: async (identifier) => stopped.push(identifier),
  });
  assert.equal(options.environment.PROVIDER_KEY, "synthetic-provider");
  assert.equal(options.environment.XDG_RUNTIME_DIR, "/private/runtime");
  assert.equal(options.environment.TMPDIR, "/private/home/tmp");
  assert.equal(options.environment.GITHUB_TOKEN, undefined);
  assert.equal(options.environment.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(options.environment.MR_AGENT_WEB_RESEARCH, undefined);
  assert.equal(options.environment.MR_AGENT_READ_ONLY, "true");
  assert.equal(
    options.environment.MR_AGENT_ATTACHMENT_PATH,
    "/private/worktrees/topic/.agent-attachments",
  );
  assert.deepEqual(JSON.parse(options.environment.MR_AGENT_ATTACHMENT_NAMES), [
    "imatge-1.jpg",
    "imatge-2.png",
  ]);
  assert.equal(
    options.environment.MR_AGENT_SESSION_IDENTIFIER,
    "topic-0123456789abcdef",
    "the extension labels containers with the opaque worktree name",
  );
  assert.deepEqual(options.tools, ["sandbox_bash", "view_attachment"]);
  assert.deepEqual(options.extensions, [
    "/private/profile/extensions/sandbox-bash.ts",
  ]);
  const argumentsList = buildPiArguments(options);
  assert.equal(argumentsList.includes("--no-extensions"), true);
  assert.equal(argumentsList.includes("--no-context-files"), true);
  assert.equal(
    argumentsList[argumentsList.indexOf("--tools") + 1],
    "sandbox_bash,view_attachment",
  );
  await options.onInterrupted();
  assert.deepEqual(stopped, ["topic-0123456789abcdef"]);
});
