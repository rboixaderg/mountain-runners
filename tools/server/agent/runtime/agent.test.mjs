// The whole environment Pi receives, built with the real profile preparation.

import assert from "node:assert/strict";
import {
  chmodSync,
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

  const result = await runAgent(config, {
    sessionIdentifier: "topic_n1001234567890_7",
    sandboxIdentifier,
    message: "synthetic",
    worktreePath: directory,
    environment: { PATH: process.env.PATH, HOME: directory },
    stopCommands: async () => {},
  });

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
