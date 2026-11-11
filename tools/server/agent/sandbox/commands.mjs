// Isolated execution boundary for the private agent (T8.3).
//
// Repository scripts, hooks, dependency installers and tests are untrusted
// code. They run in a non-privileged container with no network, a read-only
// root filesystem, no extra capabilities and no credentials: the model
// credential stays in the Pi process and the GitHub token stays in the trusted
// component. The only writable path is the worktree of the current job.
//
// The flags follow the container probe of T8.2
// (`tools/phase-8-evaluation/isolation.test.mjs`). A real container run is
// exercised only when MR_ISOLATION_TEST_IMAGE names a local image.

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { buildSandboxArguments } from "./arguments.mjs";
import { SandboxCleanupError } from "./errors.mjs";

const maximumOutputBytes = 1024 * 1024;

const executeFile = promisify(execFile);

// Local rootless Podman needs its storage/runtime paths, not bridge credentials.
function podmanEnvironment() {
  if (process.getuid() === 0) {
    throw new Error("The agent container runtime must run without root.");
  }
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  };
}

async function cleanSandboxContainers(label) {
  const environment = podmanEnvironment();
  async function listContainers(includeStopped) {
    const argumentsList = ["--remote=false", "ps", "--quiet"];
    if (includeStopped) argumentsList.push("--all");
    argumentsList.push("--filter", label);
    const { stdout } = await executeFile("podman", argumentsList, {
      env: environment,
    });
    return stdout.split("\n").filter(Boolean);
  }

  const running = await listContainers(false);
  if (running.length > 0) {
    await executeFile("podman", ["--remote=false", "kill", ...running], {
      env: environment,
    });
  }
  const remaining = await listContainers(true);
  if (remaining.length > 0) {
    await executeFile("podman", ["--remote=false", "rm", ...remaining], {
      env: environment,
    });
  }
  if ((await listContainers(true)).length > 0) {
    throw new Error("Sandbox containers remain after cleanup.");
  }
  return running.length;
}

/** Stop and remove only the containers belonging to this session. */
export async function stopSandboxedCommands(sessionIdentifier) {
  try {
    return await cleanSandboxContainers(
      `label=mountain-agent.session=${sessionIdentifier}`,
    );
  } catch (error) {
    throw new SandboxCleanupError({ cause: error });
  }
}

/**
 * Run a command inside the sandbox. The container is killed on timeout or
 * abort. Returns the exit code, output and whether the timeout fired.
 */
export async function runSandboxedCommand({
  image,
  workspacePath,
  worktreeRoot,
  command,
  limits,
  sessionIdentifier,
  timeoutMilliseconds,
  signal,
  readOnly = false,
}) {
  signal?.throwIfAborted();
  const containerName = `mountain-agent-${randomUUID()}`;
  const argumentsList = buildSandboxArguments({
    image,
    workspacePath,
    worktreeRoot,
    command,
    limits,
    containerName,
    sessionIdentifier,
    readOnly,
  });

  let timedOut = false;
  const child = spawn("podman", argumentsList, {
    env: podmanEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  let outputLimitExceeded = false;
  function retainOutput(chunks, chunk) {
    if (outputLimitExceeded) return;
    outputBytes += chunk.length;
    if (outputBytes > maximumOutputBytes) {
      outputLimitExceeded = true;
      child.kill("SIGKILL");
      return;
    }
    chunks.push(chunk);
  }
  child.stdout.on("data", (chunk) => retainOutput(stdout, chunk));
  child.stderr.on("data", (chunk) => retainOutput(stderr, chunk));

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMilliseconds);

  const abortHandler = () => {
    child.kill("SIGKILL");
    // The finally block waits for termination and reports an unconfirmed stop.
  };
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const result = await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", (exitCode, closeSignal) => {
        resolvePromise({
          exitCode: outputLimitExceeded ? -1 : (exitCode ?? -1),
          signal: closeSignal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });
    return { ...result, timedOut, outputLimitExceeded };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortHandler);
    await stopSandboxedCommands(sessionIdentifier);
  }
}

/** Stop and remove every agent container, regardless of session. */
export async function stopAllSandboxedCommands() {
  try {
    return await cleanSandboxContainers("label=mountain-agent.session");
  } catch (error) {
    throw new Error("Could not confirm that the sandbox containers stopped.", {
      cause: error,
    });
  }
}
