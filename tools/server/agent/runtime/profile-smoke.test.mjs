// Optional installed-Pi contract: no model request, network or credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preparePiProfile } from "./profile.mjs";
import { buildPiArguments } from "telegram-pi-bridge/pi";
import { projectPiOptions } from "./pi-adapter.mjs";

const piCommand = process.env.MR_AGENT_PI_COMMAND;

test(
  "loads the actual sandbox extension in installed Pi without trusting the checkout",
  { skip: !piCommand, timeout: 30000 },
  async (context) => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "mr-agent-pi-smoke-")),
    );
    context.after(() =>
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    );
    const workspace = join(directory, "worktree");
    const marker = join(directory, "untrusted-extension-ran");
    mkdirSync(join(workspace, ".pi", "extensions"), { recursive: true });
    writeFileSync(
      join(workspace, ".pi", "extensions", "evil.ts"),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unexpected'); export default function () {}\n`,
    );
    const identifier = "synthetic_profile_smoke";
    const profile = await preparePiProfile({
      profileRoot: join(directory, "profiles"),
      sessionIdentifier: identifier,
    });
    writeFileSync(
      join(profile, "extensions", "zzz-test-probe.ts"),
      `export default function(pi) { pi.on('session_start', () => { process.stdout.write(JSON.stringify({type:'test_tools',names:pi.getActiveTools()})+'\\n'); }); }\n`,
    );
    const config = {
      paths: { sessions: join(directory, "sessions"), worktrees: directory },
      model: {
        identifier: "opencode-go/glm-5.3-flash",
        providerEnvironmentVariables: [],
        sandboxImage: "synthetic:1",
      },
      limits: { executionTimeoutMs: 10000 },
    };
    const options = projectPiOptions({
      config,
      profileDirectory: profile,
      sessionIdentifier: identifier,
      worktreePath: workspace,
      environment: { PATH: process.env.PATH, HOME: directory },
    });
    options.extensions.push(join(profile, "extensions", "zzz-test-probe.ts"));
    options.environment.PI_OFFLINE = "1";
    const child = spawn(piCommand, buildPiArguments(options), {
      cwd: workspace,
      env: options.environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    context.after(() => child.kill("SIGKILL"));
    const timer = setTimeout(() => child.stdin.end(), 12000);
    context.after(() => clearTimeout(timer));
    child.stdin.write(
      JSON.stringify({ id: "state", type: "get_state" }) + "\n",
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes('"test_tools"')) child.stdin.end();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.includes('"test_tools"')) child.stdin.end();
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(exitCode, 0, stderr);
    const records = (stdout + "\n" + stderr)
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    const tools = records.find((record) => record.type === "test_tools");
    assert.deepEqual(tools?.names, ["sandbox_bash"], stderr);
    assert.equal(existsSync(marker), false);
    assert.doesNotMatch(stderr, /Failed to load extension/u);
  },
);
