// Pure sandbox argument construction (T8.3).
//
// Shared by the trusted component (which runs the project checks) and by the
// Pi extension (which runs the model's commands). Keeping one implementation
// avoids drift between the two boundaries.
//
// This module must stay dependency-free: the Pi profile copies it next to the
// extension, outside the repository.

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

const latestTagPattern = /:latest$/u;

export function buildModelCommand(command, readOnly) {
  if (readOnly) {
    return ["env", "HOME=/tmp", "bash", "-lc", command];
  }
  return [
    "env",
    "HOME=/tmp",
    "MR_AGENT_BROWSER_PROFILE=chromium",
    "TMPDIR=/work/.agent-runtime-tmp",
    "bash",
    "-lc",
    command,
  ];
}

export function assertWorkspaceInsideRoot(workspacePath, worktreeRoot) {
  if (!isAbsolute(workspacePath) || !isAbsolute(worktreeRoot)) {
    throw new Error("The workspace and the worktree root must be absolute.");
  }
  const realWorkspace = realpathSync(workspacePath);
  const realRoot = realpathSync(worktreeRoot);
  const containedPath = relative(realRoot, realWorkspace);
  if (
    containedPath === "" ||
    containedPath.startsWith("..") ||
    isAbsolute(containedPath)
  ) {
    throw new Error(
      `The workspace ${workspacePath} is outside the configured worktree root.`,
    );
  }
  return realWorkspace;
}

export function assertPinnedImage(image) {
  if (typeof image !== "string" || image.trim() === "") {
    throw new Error("A sandbox image is required.");
  }
  if (latestTagPattern.test(image)) {
    throw new Error("The sandbox image must not use the latest tag.");
  }
  return image;
}

export function buildSandboxArguments({
  image,
  workspacePath,
  worktreeRoot,
  command,
  limits,
  containerName,
  sessionIdentifier,
  readOnly = false,
}) {
  const workspace = assertWorkspaceInsideRoot(workspacePath, worktreeRoot);
  assertPinnedImage(image);
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error("A sandbox command is required.");
  }
  if (typeof sessionIdentifier !== "string" || sessionIdentifier === "") {
    throw new Error("A session identifier is required.");
  }

  const owner = statSync(workspace);
  if (owner.uid === 0) {
    throw new Error("The sandbox worktree must have a non-root owner.");
  }

  return [
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
    `--pids-limit=${limits.sandboxProcessLimit}`,
    `--memory=${limits.sandboxMemoryMegabytes}m`,
    `--cpus=${limits.sandboxCpuCount}`,
    `--user=${owner.uid}:${owner.gid}`,
    "--workdir=/work",
    "--label",
    `mountain-agent.session=${sessionIdentifier}`,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=256m",
    "--mount",
    `type=bind,src=${workspace},dst=/work${readOnly ? ",readonly" : ""}`,
    "--name",
    containerName,
    image,
    ...command,
  ];
}

/**
 * Read the sandbox configuration handed to the Pi extension. The values are not
 * secrets; the extension refuses to run with an incomplete configuration.
 */
export function readSandboxSettings(environment) {
  const image = environment.MR_AGENT_SANDBOX_IMAGE;
  const worktreeRoot = environment.MR_AGENT_WORKTREE_ROOT;
  const sessionIdentifier = environment.MR_AGENT_SESSION_IDENTIFIER;
  const rawLimits = environment.MR_AGENT_SANDBOX_LIMITS;
  if (!image || !worktreeRoot || !sessionIdentifier || !rawLimits) {
    throw new Error("The sandbox configuration is incomplete.");
  }

  let limits;
  try {
    limits = JSON.parse(rawLimits);
  } catch {
    throw new Error("The sandbox limits are not valid JSON.");
  }
  for (const name of [
    "sandboxProcessLimit",
    "sandboxMemoryMegabytes",
    "sandboxCpuCount",
  ]) {
    if (!Number.isSafeInteger(limits?.[name]) || limits[name] < 1) {
      throw new Error(`The sandbox limit ${name} is invalid.`);
    }
  }

  return {
    image,
    worktreeRoot,
    sessionIdentifier,
    limits,
    readOnly: environment.MR_AGENT_READ_ONLY === "true",
  };
}
