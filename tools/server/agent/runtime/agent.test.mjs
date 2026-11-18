// The whole environment Pi receives, built with the real profile preparation.

import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runAgent } from "./agent.mjs";

test("passes Pi no chat or topic identifier in any variable", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-environment-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const environmentDump = join(directory, "pi-environment.json");
  const executable = join(directory, "fake-pi");
  writeFileSync(
    executable,
    `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(environmentDump)}, JSON.stringify(process.env));
process.stdin.once("data", () => {
  process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false}) + "\\n");
});
`,
  );
  chmodSync(executable, 0o755);
  const config = {
    paths: {
      state: join(directory, "state"),
      sessions: join(directory, "sessions"),
      worktrees: join(directory, "worktrees"),
    },
    model: {
      identifier: "synthetic",
      piCommand: executable,
      providerEnvironmentVariables: [],
      sandboxImage: "synthetic:1",
    },
    limits: { executionTimeoutMs: 5000 },
  };
  const sandboxIdentifier = "topic-0123456789abcdef";

  const claimed = [];
  const result = await runAgent(config, {
    sessionIdentifier: "topic_n1001234567890_7",
    sandboxIdentifier,
    claimServiceNotes: () => {
      claimed.push("claimed");
      return ["Un efecte del servei."];
    },
    buildMessage: (serviceNotes) => ["synthetic", ...serviceNotes].join("\n"),
    worktreePath: directory,
    environment: { PATH: process.env.PATH, HOME: directory },
    stopCommands: async () => {},
  });

  assert.deepEqual(claimed, ["claimed"], "the effects reach the prompt");

  assert.equal(result.aborted, false);
  const environment = JSON.parse(readFileSync(environmentDump, "utf8"));
  const serialised = JSON.stringify(environment);
  assert.equal(serialised.includes("1001234567890"), false);
  assert.equal(serialised.includes("topic_n"), false);
  assert.equal(environment.MR_AGENT_SESSION_IDENTIFIER, sandboxIdentifier);
  assert.equal(
    environment.PI_CODING_AGENT_DIR,
    join(config.paths.state, "profiles", sandboxIdentifier),
  );
});

test("claims the service events only when Pi is about to receive the prompt", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-order-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  // A file where the profile root belongs: preparing the profile fails before
  // any prompt exists.
  mkdirSync(join(directory, "state"));
  writeFileSync(join(directory, "state", "profiles"), "not a directory");
  const config = {
    paths: {
      state: join(directory, "state"),
      sessions: join(directory, "sessions"),
      worktrees: join(directory, "worktrees"),
    },
    model: {
      identifier: "synthetic",
      piCommand: join(directory, "missing-pi"),
      providerEnvironmentVariables: [],
      sandboxImage: "synthetic:1",
    },
    limits: { executionTimeoutMs: 5000 },
  };
  const claims = [];
  const contextFor = () => ({
    sessionIdentifier: "topic_n1001234567890_7",
    sandboxIdentifier: "topic-0123456789abcdef",
    claimServiceNotes: () => {
      claims.push("claimed");
      return [];
    },
    buildMessage: () => "synthetic",
    worktreePath: directory,
    environment: { PATH: process.env.PATH, HOME: directory },
    stopCommands: async () => {},
  });

  await assert.rejects(runAgent(config, contextFor()));
  assert.deepEqual(
    claims,
    [],
    "a profile that cannot be prepared never consumes an effect",
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runAgent(config, { ...contextFor(), signal: controller.signal }),
  );
  assert.deepEqual(claims, [], "a stopped turn never consumes an effect");
});
