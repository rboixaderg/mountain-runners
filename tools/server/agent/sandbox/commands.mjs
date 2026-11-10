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
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  };
}

/**
 * Kill the containers of a session. Used on timeout and on shutdown, because
 * killing the Podman client or Pi leaves the container running.
 */
export async function stopSandboxedCommands(sessionIdentifier) {
  try {
    const environment = podmanEnvironment();
    const { stdout } = await executeFile(
      "podman",
      [
        "--remote=false",
        "ps",
        "--quiet",
        "--filter",
        `label=mountain-agent.session=${sessionIdentifier}`,
      ],
      { env: environment },
    );
    const containers = stdout.split("\n").filter(Boolean);
    if (containers.length === 0) {
      return 0;
    }
    await executeFile("podman", ["--remote=false", "kill", ...containers], {
      env: environment,
    });
    return containers.length;
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
    if (timedOut || signal?.aborted || outputLimitExceeded) {
      await stopSandboxedCommands(sessionIdentifier);
    }
  }
}

/** Kill every agent container, regardless of session. */
export async function stopAllSandboxedCommands() {
  try {
    const environment = podmanEnvironment();
    const { stdout } = await executeFile(
      "podman",
      [
        "--remote=false",
        "ps",
        "--quiet",
        "--filter",
        "label=mountain-agent.session",
      ],
      { env: environment },
    );
    const containers = stdout.split("\n").filter(Boolean);
    if (containers.length === 0) {
      return 0;
    }
    await executeFile("podman", ["--remote=false", "kill", ...containers], {
      env: environment,
    });
    return containers.length;
  } catch (error) {
    throw new Error("Could not confirm that the sandbox containers stopped.", {
      cause: error,
    });
  }
}
