import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runProjectPrompt } from "./pi-adapter.mjs";

// Real Podman is not available here. This runs the real chain up to it: the
// adapter starts a Node stand-in for Pi with the web research pipe on FD 3, and
// that process starts the sandbox with the code of the extension. A stand-in
// for Podman reports its arguments and whether it inherited the descriptor.
test(
  "the web research descriptor reaches Pi and never the sandbox runtime",
  { skip: process.getuid() === 0 },
  async (context) => {
    const directory = mkdtempSync(join(tmpdir(), "mr-agent-fd-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const worktrees = join(directory, "worktrees");
    const workspace = join(worktrees, "topic");
    mkdirSync(workspace, { recursive: true });
    const report = join(directory, "report");
    const podman = join(directory, "podman");
    writeFileSync(
      podman,
      `#!/bin/sh
case " $* " in
  *" run "*)
    if { true >&3; } 2>/dev/null; then echo open; else echo closed; fi
    echo "$*"
    ;;
esac
`,
      { mode: 0o755 },
    );
    const commands = new URL("../sandbox/commands.mjs", import.meta.url);
    const pi = join(directory, "pi.mjs");
    writeFileSync(
      pi,
      `#!${process.execPath}
import { fstatSync, writeFileSync } from "node:fs";
import { runSandboxedCommand } from ${JSON.stringify(commands.href)};

process.stdin.once("data", async () => {
  fstatSync(3);
  const result = await runSandboxedCommand({
    image: "sandbox:1",
    workspacePath: process.cwd(),
    worktreeRoot: ${JSON.stringify(worktrees)},
    command: ["true"],
    limits: ${JSON.stringify({
      sandboxProcessLimit: 64,
      sandboxMemoryMegabytes: 256,
      sandboxCpuCount: 1,
    })},
    sessionIdentifier: "synthetic",
    timeoutMilliseconds: 10_000,
  });
  writeFileSync(${JSON.stringify(report)}, result.stdout);
  console.log(JSON.stringify({ type: "agent_settled" }));
});
`,
      { mode: 0o755 },
    );

    await runProjectPrompt({
      config: {
        model: {
          piCommand: pi,
          identifier: "example/model",
          providerEnvironment: {},
          sandboxImage: "sandbox:1",
        },
        paths: { sessions: join(directory, "sessions"), worktrees },
        limits: { executionTimeoutMs: 20_000 },
      },
      profileDirectory: directory,
      sessionIdentifier: "synthetic",
      sandboxIdentifier: "synthetic",
      worktreePath: workspace,
      message: "synthetic",
      environment: { PATH: `${directory}:${process.env.PATH}` },
      stopCommands: async () => {},
      webResearch: async () => assert.fail("no research is requested"),
    });

    const [descriptor, podmanArguments] = readFileSync(report, "utf8").split(
      "\n",
    );
    assert.equal(descriptor, "closed");
    assert.doesNotMatch(podmanArguments, /--preserve-fd/u);
    // The probe does detect a descriptor that is passed on.
    const control = spawnSync(podman, ["run"], {
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
    assert.match(control.stdout, /^open\n/u);
  },
);
