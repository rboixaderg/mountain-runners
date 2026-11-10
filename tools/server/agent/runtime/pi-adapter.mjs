// Mountain Runners adapter for the generic RPC transport. Only this layer
// knows the model environment allowlist, the sandbox extension and Docker cleanup.

import { join } from "node:path";
import { runPiPrompt } from "telegram-pi-bridge/pi";
import { stopSandboxedCommands } from "../sandbox/commands.mjs";

export function buildPiEnvironment({
  environment,
  profileDirectory,
  providerEnvironmentVariables,
  sandbox,
  sessionIdentifier,
  readOnly = false,
}) {
  const allowedEnvironment = {
    PATH: environment.PATH,
    HOME: environment.HOME,
    PI_CODING_AGENT_DIR: profileDirectory,
    MR_AGENT_SANDBOX_IMAGE: sandbox.image,
    MR_AGENT_WORKTREE_ROOT: sandbox.worktreeRoot,
    MR_AGENT_SANDBOX_LIMITS: JSON.stringify(sandbox.limits),
    MR_AGENT_SESSION_IDENTIFIER: sessionIdentifier,
    MR_AGENT_READ_ONLY: String(readOnly),
  };
  for (const name of providerEnvironmentVariables) {
    if (environment[name] !== undefined) {
      allowedEnvironment[name] = environment[name];
    }
  }
  return allowedEnvironment;
}

export function projectPiOptions({
  config,
  profileDirectory,
  sessionIdentifier,
  message,
  worktreePath,
  environment = process.env,
  timeoutMilliseconds = config.limits.executionTimeoutMs,
  signal,
  stopCommands = stopSandboxedCommands,
  readOnly = false,
  classifyOnly = false,
}) {
  return {
    command: config.model.piCommand,
    model: config.model.identifier,
    cwd: worktreePath,
    profileDirectory,
    sessionIdentifier: classifyOnly ? undefined : sessionIdentifier,
    sessionDirectory: classifyOnly ? undefined : config.paths.sessions,
    tools: classifyOnly ? [] : ["sandbox_bash"],
    extensions: classifyOnly
      ? []
      : [join(profileDirectory, "extensions", "sandbox-bash.ts")],
    message,
    timeoutMilliseconds,
    signal,
    onInterrupted: classifyOnly
      ? undefined
      : () => stopCommands(sessionIdentifier),
    environment: buildPiEnvironment({
      environment,
      profileDirectory,
      providerEnvironmentVariables: config.model.providerEnvironmentVariables,
      sandbox: {
        image: config.model.sandboxImage,
        worktreeRoot: config.paths.worktrees,
        limits: config.limits,
      },
      sessionIdentifier,
      readOnly,
    }),
  };
}

export function runProjectPrompt(options) {
  return runPiPrompt(projectPiOptions(options));
}
