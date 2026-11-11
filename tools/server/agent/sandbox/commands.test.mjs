import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
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
import {
  buildModelCommand,
  buildSandboxArguments,
  readSandboxSettings,
} from "./arguments.mjs";
import {
  runSandboxedCommand,
  stopSandboxedCommands,
  stopAllSandboxedCommands,
} from "./commands.mjs";

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

  assert.deepEqual(argumentsList, [
    "--remote=false",
    "--cgroup-manager=cgroupfs",
    "run",
    "--rm",
    "--pull=never",
    "--userns=keep-id",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=64",
    "--memory=256m",
    "--cpus=1",
    `--user=${process.getuid()}:${process.getgid()}`,
    "--workdir=/work",
    "--label",
    "mountain-agent.session=topic_n1001234567890_7",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=256m",
    "--mount",
    `type=bind,src=${realpathSync(workspace)},dst=/work`,
    "--name",
    "mountain-agent-test",
    "mountain-agent-pi:1.5.0",
    "node",
    "-e",
    "console.log('ok')",
  ]);
});

test("prepares an executable temporary path for writable model commands only", () => {
  assert.deepEqual(buildModelCommand("pnpm check", false), [
    "env",
    "HOME=/tmp",
    "TMPDIR=/work/.agent-runtime-tmp",
    "bash",
    "-lc",
    "pnpm check",
  ]);
  assert.deepEqual(buildModelCommand("pwd", true), [
    "env",
    "HOME=/tmp",
    "bash",
    "-lc",
    "pwd",
  ]);
});

test("the service has no Docker group or daemon dependency", () => {
  const unit = readFileSync(
    new URL("../../systemd/mountain-agent.service", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(unit, /docker\.service|SupplementaryGroups=/u);
  assert.match(unit, /InaccessiblePaths=.*\/run\/docker\.sock/u);
  assert.match(unit, /Delegate=yes/u);
  assert.match(unit, /^CPUQuota=150%$/mu);
  assert.match(unit, /^MemoryMax=2560M$/mu);
  assert.match(unit, /^MemorySwapMax=0$/mu);
  assert.match(unit, /^TasksMax=384$/mu);
});

test("runs and stops only local rootless Podman with a minimal host environment", async (context) => {
  const { directory, worktreeRoot, workspace } = workspaceFixture(context);
  const callsPath = join(directory, "calls.jsonl");
  const script = `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ executable: require('node:path').basename(process.argv[1]), arguments: process.argv.slice(2), environment: Object.keys(process.env).sort() }) + '\\n');
process.stdout.write(process.argv.includes('ps') ? 'synthetic-container\\n' : 'sandboxed');
`;
  for (const executable of ["podman", "docker"]) {
    const path = join(directory, executable);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
  const originalPath = process.env.PATH;
  const originalRuntime = process.env.XDG_RUNTIME_DIR;
  process.env.PATH = directory;
  process.env.XDG_RUNTIME_DIR = directory;
  context.after(() => {
    process.env.PATH = originalPath;
    if (originalRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = originalRuntime;
  });
  const result = await runSandboxedCommand({
    image: "synthetic:1",
    workspacePath: workspace,
    worktreeRoot,
    command: ["true"],
    limits,
    sessionIdentifier: "topic-test",
    timeoutMilliseconds: 5000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(await stopSandboxedCommands("topic-test"), 1);
  assert.equal(await stopAllSandboxedCommands(), 1);
  const calls = readFileSync(callsPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.executable, "podman");
    assert.equal(call.arguments[0], "--remote=false");
    // macOS adds this platform variable when starting a process.
    const expectedEnvironment = ["HOME", "PATH", "XDG_RUNTIME_DIR"];
    if (process.platform === "darwin")
      expectedEnvironment.push("__CF_USER_TEXT_ENCODING");
    assert.deepEqual(call.environment, expectedEnvironment);
  }
  assert.deepEqual(calls[1].arguments.slice(1), [
    "ps",
    "--quiet",
    "--filter",
    "label=mountain-agent.session=topic-test",
  ]);
  assert.deepEqual(calls[3].arguments.slice(1), [
    "ps",
    "--quiet",
    "--filter",
    "label=mountain-agent.session",
  ]);
});

test("bounds combined command output and stops its container on overflow", async (context) => {
  const { directory, worktreeRoot, workspace } = workspaceFixture(context);
  const callsPath = join(directory, "cleanup.txt");
  const executable = join(directory, "podman");
  writeFileSync(
    executable,
    `#!${process.execPath}
const fs = require("node:fs");
if (process.argv.includes("run")) {
 process.stdout.write("x".repeat(600*1024));
 process.stderr.write("y".repeat(600*1024));
 setInterval(()=>{},1000);
} else {
 fs.appendFileSync(${JSON.stringify(callsPath)},process.argv.slice(2).join(" ")+"\\n");
 if (process.argv.includes("ps")) process.stdout.write("synthetic-container\\n");
}
`,
  );
  chmodSync(executable, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = directory;
  context.after(() => {
    process.env.PATH = originalPath;
  });
  const result = await runSandboxedCommand({
    image: "synthetic:1",
    workspacePath: workspace,
    worktreeRoot,
    command: ["true"],
    limits,
    sessionIdentifier: "topic-output",
    timeoutMilliseconds: 5000,
  });
  assert.equal(result.outputLimitExceeded, true);
  assert.equal(result.timedOut, false);
  assert.notEqual(result.exitCode, 0);
  assert.ok(
    Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <=
      1024 * 1024,
  );
  assert.match(readFileSync(callsPath, "utf8"), /kill synthetic-container/u);
});

test("refuses to start the container runtime as root", async (context) => {
  const { worktreeRoot, workspace } = workspaceFixture(context);
  context.mock.method(process, "getuid", () => 0);
  await assert.rejects(
    runSandboxedCommand({
      image: "synthetic:1",
      workspacePath: workspace,
      worktreeRoot,
      command: ["true"],
      limits,
      sessionIdentifier: "topic-test",
      timeoutMilliseconds: 5000,
    }),
    /runtime must run without root/u,
  );
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
    const { stdout } = await promisify(execFile)("podman", [
      "--remote=false",
      "ps",
      "--quiet",
      "--filter",
      `label=mountain-agent.session=${identifier}`,
    ]);
    assert.equal(stdout.trim(), "");
  },
);
