import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  validateAgentPaths,
  validatePodmanStorage,
  validateVolume,
} from "./volume-validation.mjs";

const volumeRoot = "/var/lib/mountain-runners-agent-volumes";
const agentRoot = "/var/lib/mountain-runners-agent";

export const agentVolumes = [
  {
    mountPath: agentRoot,
    backingPath: `${volumeRoot}/work.ext4`,
    sizeBytes: 11 * 1024 ** 3,
  },
  {
    mountPath: `${agentRoot}/state`,
    backingPath: `${volumeRoot}/state.ext4`,
    sizeBytes: 1024 ** 3,
  },
];

function command(executable, argumentsList, environment = {}) {
  return execFileSync(executable, argumentsList, {
    encoding: "utf8",
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function inspectVolume(expected) {
  const lines = command("/usr/bin/findmnt", [
    "--json",
    "--mountpoint",
    expected.mountPath,
    "--output",
    "TARGET,SOURCE,FSTYPE,OPTIONS",
  ]);
  const mounts = JSON.parse(lines).filesystems;
  if (!Array.isArray(mounts) || mounts.length !== 1) {
    throw new Error("Expected exactly one mount");
  }
  const mount = mounts[0];
  const backingPath = command("/usr/sbin/losetup", [
    "--noheadings",
    "--output",
    "BACK-FILE",
    mount.source,
  ]);
  const information = lstatSync(expected.backingPath);
  return {
    target: mount.target,
    source: mount.source,
    filesystem: mount.fstype,
    options: mount.options.split(","),
    backingPath,
    isRegularFile: information.isFile(),
    isSymbolicLink:
      information.isSymbolicLink() ||
      realpathSync(expected.backingPath) !== expected.backingPath,
    ownerUid: information.uid,
    mode: information.mode & 0o7777,
    sizeBytes: information.size,
    allocatedBytes: information.blocks * 512,
  };
}

export function verifyAgentVolumes(environment = process.env) {
  const parent = lstatSync(volumeRoot);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== 0 ||
    (parent.mode & 0o022) !== 0 ||
    realpathSync(volumeRoot) !== volumeRoot
  ) {
    throw new Error("Invalid agent volume directory");
  }
  for (const volume of agentVolumes) {
    validateVolume(volume, inspectVolume(volume));
  }
  const paths = {
    HOME: agentRoot,
    MOUNTAIN_AGENT_REPOSITORY_PATH: `${agentRoot}/repository`,
    MOUNTAIN_AGENT_WORKTREE_PATH: `${agentRoot}/worktrees`,
    MOUNTAIN_AGENT_SESSION_PATH: `${agentRoot}/sessions`,
    MOUNTAIN_AGENT_STATE_PATH: `${agentRoot}/state`,
    XDG_RUNTIME_DIR: "/run/mountain-runners-agent",
    TMPDIR: `${agentRoot}/tmp`,
  };
  const canonicalPaths = Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [name, realpathSync(path)]),
  );
  validateAgentPaths(paths, environment, canonicalPaths);
  const storagePath = `${agentRoot}/.local/share/containers/storage`;
  const info = command(
    "/usr/bin/podman",
    [
      "--remote=false",
      "--cgroup-manager=cgroupfs",
      "info",
      "--format",
      "{{.Store.GraphRoot}};{{.Store.RunRoot}};{{.Host.Security.Rootless}}",
    ],
    {
      HOME: agentRoot,
      TMPDIR: paths.TMPDIR,
      XDG_RUNTIME_DIR: paths.XDG_RUNTIME_DIR,
    },
  );
  validatePodmanStorage(
    storagePath,
    `${paths.XDG_RUNTIME_DIR}/containers`,
    info,
    realpathSync(storagePath),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    verifyAgentVolumes();
  } catch {
    process.stderr.write(
      "Agent storage verification failed; refusing to start.\n",
    );
    process.exitCode = 1;
  }
}
