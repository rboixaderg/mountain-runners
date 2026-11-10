import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { buildSandboxArguments, readSandboxSettings } from "./arguments.mjs";
import { runSandboxedCommand } from "./commands.mjs";

const image = process.env.MR_ISOLATION_TEST_IMAGE;

const limits = {
  sandboxProcessLimit: 64,
  sandboxMemoryMegabytes: 256,
  sandboxCpuCount: 1,
};

function workspaceFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-sandbox-"));
  const worktreeRoot = join(directory, "worktrees");
  const workspace = join(worktreeRoot, "feat-sample");
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return { directory, worktreeRoot, workspace };
}

test("builds a sandbox with no network, no credentials and one writable worktree", (context) => {
  const { worktreeRoot, workspace } = workspaceFixture(context);

  const argumentsList = buildSandboxArguments({
    image: "mountain-agent-pi:1.5.0",
    workspacePath: workspace,
    worktreeRoot,
    command: ["node", "-e", "console.log('ok')"],
    limits,
    containerName: "mountain-agent-test",
    sessionIdentifier: "topic_n1001234567890_7",
  });

  for (const required of [
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=64",
    "--memory=256m",
    "--cpus=1",
    `--user=${process.getuid()}:${process.getgid()}`,
    "--workdir=/work",
    "--name",
    "mountain-agent-test",
    "mountain-agent.session=topic_n1001234567890_7",
  ]) {
    assert.equal(
      argumentsList.includes(required),
      true,
      `expected ${required} in ${argumentsList.join(" ")}`,
    );
  }

  const mountIndex = argumentsList.indexOf("--mount");
  assert.equal(
    argumentsList[mountIndex + 1],
    `type=bind,src=${realpathSync(workspace)},dst=/work`,
  );
  const imageIndex = argumentsList.indexOf("mountain-agent-pi:1.5.0");
  assert.equal(argumentsList.slice(0, imageIndex).includes("-e"), false);
  assert.equal(argumentsList.slice(0, imageIndex).includes("--env"), false);
  assert.equal(argumentsList.slice(-3).join(" "), "node -e console.log('ok')");
});

test("rejects a workspace outside the configured worktree root", (context) => {
  const { directory, worktreeRoot, workspace } = workspaceFixture(context);
  const outside = join(directory, "outside");
  mkdirSync(outside);

  assert.throws(
    () =>
      buildSandboxArguments({
        image: "mountain-agent-pi:1.5.0",
        workspacePath: outside,
        worktreeRoot,
        command: ["true"],
        limits,
        containerName: "mountain-agent-test",
        sessionIdentifier: "topic_n1001234567890_7",
      }),
    { message: /outside the configured worktree root/u },
  );

  const escape = join(workspace, "escape");
  symlinkSync(outside, escape);
  assert.throws(
    () =>
      buildSandboxArguments({
        image: "mountain-agent-pi:1.5.0",
        workspacePath: escape,
        worktreeRoot,
        command: ["true"],
        limits,
        containerName: "mountain-agent-test",
        sessionIdentifier: "topic_n1001234567890_7",
      }),
    { message: /outside the configured worktree root/u },
  );
});

test("rejects an unpinned image or an empty command", (context) => {
  const { worktreeRoot, workspace } = workspaceFixture(context);

  assert.throws(
    () =>
      buildSandboxArguments({
        image: "mountain-agent-pi:latest",
        workspacePath: workspace,
        worktreeRoot,
        command: ["true"],
        limits,
        containerName: "mountain-agent-test",
        sessionIdentifier: "topic_n1001234567890_7",
      }),
    { message: /latest tag/u },
  );

  assert.throws(
    () =>
      buildSandboxArguments({
        image: "mountain-agent-pi:1.5.0",
        workspacePath: workspace,
        worktreeRoot,
        command: [],
        limits,
        containerName: "mountain-agent-test",
        sessionIdentifier: "topic_n1001234567890_7",
      }),
    { message: /sandbox command/u },
  );
});

test(
  "cannot read host files or credentials and can write the worktree",
  { skip: !image },
  async (context) => {
    const { directory, worktreeRoot, workspace } = workspaceFixture(context);
    const canary = join(directory, "canary");
    writeFileSync(canary, "synthetic", { mode: 0o600 });
    symlinkSync(canary, join(workspace, "escape"));
    const probe = `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const os = require('node:os');
      assert.equal(process.getuid(), ${process.getuid()});
      assert.equal(fs.existsSync(${JSON.stringify(canary)}), false);
      assert.throws(() => fs.readFileSync('/work/escape'));
      assert.equal(fs.existsSync('/var/run/docker.sock'), false);
      assert.deepEqual(Object.keys(os.networkInterfaces()), ['lo']);
      fs.writeFileSync('/work/result.txt', 'sandboxed');
      assert.throws(() => fs.writeFileSync('/write-probe', 'x'), { code: 'EROFS' });
    `;

    const result = await runSandboxedCommand({
      image,
      workspacePath: workspace,
      worktreeRoot,
      command: ["node", "-e", probe],
      limits,
      sessionIdentifier: "topic_n1001234567890_7",
      timeoutMilliseconds: 30000,
    });

    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(workspace, "result.txt"), "utf8"),
      ),
      "sandboxed",
    );
  },
);

test("reads the extension sandbox configuration and rejects an invalid one", () => {
  const validEnvironment = {
    MR_AGENT_SANDBOX_IMAGE: "mountain-agent-pi:1.5.0",
    MR_AGENT_WORKTREE_ROOT: "/srv/agent/worktrees",
    MR_AGENT_SESSION_IDENTIFIER: "topic_n1001234567890_7",
    MR_AGENT_SANDBOX_LIMITS: JSON.stringify(limits),
  };

  assert.deepEqual(readSandboxSettings(validEnvironment), {
    image: "mountain-agent-pi:1.5.0",
    worktreeRoot: "/srv/agent/worktrees",
    sessionIdentifier: "topic_n1001234567890_7",
    limits,
    readOnly: false,
  });

  assert.throws(
    () =>
      readSandboxSettings({ ...validEnvironment, MR_AGENT_SANDBOX_IMAGE: "" }),
    { message: /incomplete/u },
  );
  assert.throws(
    () =>
      readSandboxSettings({
        ...validEnvironment,
        MR_AGENT_SANDBOX_LIMITS: "{",
      }),
    { message: /not valid JSON/u },
  );
  assert.throws(
    () =>
      readSandboxSettings({
        ...validEnvironment,
        MR_AGENT_SANDBOX_LIMITS: JSON.stringify({
          ...limits,
          sandboxMemoryMegabytes: 0,
        }),
      }),
    { message: /sandboxMemoryMegabytes/u },
  );
});

test(
  "a consultation cannot write its private worktree",
  { skip: !image },
  async (context) => {
    const { worktreeRoot, workspace } = workspaceFixture(context);
    const result = await runSandboxedCommand({
      image,
      workspacePath: workspace,
      worktreeRoot,
      command: [
        "node",
        "-e",
        "const fs=require('node:fs'); const assert=require('node:assert/strict'); assert.throws(()=>fs.writeFileSync('/work/forbidden','x'), {code:'EROFS'});",
      ],
      limits,
      readOnly: true,
      sessionIdentifier: `synthetic_${randomUUID()}`,
      timeoutMilliseconds: 30000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
  },
);

test(
  "a command deadline stops the actual container",
  { skip: !image, timeout: 15000 },
  async (context) => {
    const { worktreeRoot, workspace } = workspaceFixture(context);
    const identifier = `synthetic_${randomUUID()}`;
    const result = await runSandboxedCommand({
      image,
      workspacePath: workspace,
      worktreeRoot,
      command: [
        "node",
        "-e",
        "console.log('started');setInterval(()=>{},1000)",
      ],
      limits,
      sessionIdentifier: identifier,
      timeoutMilliseconds: 2500,
    });
    assert.equal(result.timedOut, true);
    assert.match(result.stdout, /started/u);
    const { stdout } = await promisify(execFile)("docker", [
      "ps",
      "--quiet",
      "--filter",
      `label=mountain-agent.session=${identifier}`,
    ]);
    assert.equal(stdout.trim(), "");
  },
);
