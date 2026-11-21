// Mountain Runners adapter for the generic RPC transport. Only this layer
// knows the model environment allowlist, the sandbox extension and Podman cleanup.

import { join } from "node:path";
import { runPiPrompt } from "telegram-pi-bridge/pi";
import { attachmentDirectoryName } from "../attachments/destination.mjs";
import { stopSandboxedCommands } from "../sandbox/commands.mjs";

export function buildPiEnvironment({
  environment,
  profileDirectory,
  providerEnvironmentVariables,
  sandbox,
  sandboxIdentifier,
  worktreePath,
  attachments = [],
  readOnly = false,
  classifyOnly = false,
}) {
  const allowedEnvironment = {
    PATH: environment.PATH,
    HOME: environment.HOME,
    TMPDIR: environment.TMPDIR,
    XDG_RUNTIME_DIR: environment.XDG_RUNTIME_DIR,
    PI_CODING_AGENT_DIR: profileDirectory,
  };
  // The classifier runs without a worktree, a sandbox or tools: it receives no
  // sandbox or attachment configuration that a later turn could inherit.
  if (!classifyOnly) {
    allowedEnvironment.MR_AGENT_SANDBOX_IMAGE = sandbox.image;
    allowedEnvironment.MR_AGENT_WORKTREE_ROOT = sandbox.worktreeRoot;
    allowedEnvironment.MR_AGENT_SANDBOX_LIMITS = JSON.stringify(sandbox.limits);
    // The extension labels and cleans its containers with this value, so it is
    // the opaque worktree name: never the Telegram session identifier.
    allowedEnvironment.MR_AGENT_SESSION_IDENTIFIER = sandboxIdentifier;
    allowedEnvironment.MR_AGENT_READ_ONLY = String(readOnly);
  }
  for (const name of providerEnvironmentVariables) {
    if (environment[name] !== undefined) {
      allowedEnvironment[name] = environment[name];
    }
  }
  // The view_attachment tool reads the copy in the worktree, never the store in
  // the state directory. The names are the service list; a free path is not
  // accepted. The classifier runs without a worktree and without tools.
  if (!classifyOnly && typeof worktreePath === "string") {
    allowedEnvironment.MR_AGENT_ATTACHMENT_PATH = join(
      worktreePath,
      attachmentDirectoryName,
    );
    allowedEnvironment.MR_AGENT_ATTACHMENT_NAMES = JSON.stringify(
      attachments.map((attachment) => attachment.name),
    );
  }
  return allowedEnvironment;
}

export function projectPiOptions({
  config,
  profileDirectory,
  sessionIdentifier,
  sandboxIdentifier,
  message,
  images = [],
  attachments = [],
  worktreePath,
  environment = process.env,
  timeoutMilliseconds = config.limits.executionTimeoutMs,
  signal,
  onPromptSent,
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
    tools: classifyOnly ? [] : ["sandbox_bash", "view_attachment"],
    extensions: classifyOnly
      ? []
      : [join(profileDirectory, "extensions", "sandbox-bash.ts")],
    message,
    images,
    timeoutMilliseconds,
    signal,
    onPromptSent,
    onInterrupted: classifyOnly
      ? undefined
      : () => stopCommands(sandboxIdentifier),
    environment: buildPiEnvironment({
      environment,
      profileDirectory,
      providerEnvironmentVariables: config.model.providerEnvironmentVariables,
      sandbox: {
        image: config.model.sandboxImage,
        worktreeRoot: config.paths.worktrees,
        limits: config.limits,
      },
      sandboxIdentifier,
      worktreePath,
      attachments,
      readOnly,
      classifyOnly,
    }),
  };
}

export async function runProjectPrompt(options) {
  const piOptions = projectPiOptions(options);
  let interrupted = false;
  try {
    return await runPiPrompt({
      ...piOptions,
      onInterrupted: async () => {
        interrupted = true;
        await piOptions.onInterrupted?.();
      },
    });
  } finally {
    // A tool error reported to the model must not hide a surviving container.
    // Verify cleanup after settled turns too, before checks or publication.
    if (!interrupted) await piOptions.onInterrupted?.();
  }
}
