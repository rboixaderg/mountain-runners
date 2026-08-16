// Release tooling configuration (phase 5, task 5.3).
//
// Paths follow the approved server layout documented in docs/runbook.md:
//   /var/lib/mountain-runners/releases/<commit>/  extracted releases
//   /var/lib/mountain-runners/current             atomic symlink to the active release
//   /var/lib/mountain-runners/releases.json       permanent release registry
//   /var/lib/mountain-runners/incoming/           uploads staged before installation
//
// Tests override MOUNTAIN_RELEASE_ROOT to a temporary directory. The approved
// limits are server-side constants (defense in depth): they are never taken
// from the manifest, so a tampered manifest cannot relax them.

import { join } from "node:path";

export const approvedLimits = Object.freeze({
  // Approved in T5.2: measured build is 149 files and ~21 MB expanded.
  maxExpandedBytes: 134_217_728, // 128 MiB
  maxFileCount: 5_000,
});

export function releaseRoot() {
  return process.env.MOUNTAIN_RELEASE_ROOT ?? "/var/lib/mountain-runners";
}

export function lockTimeoutMs() {
  const value = Number.parseInt(
    process.env.MOUNTAIN_RELEASE_LOCK_TIMEOUT_MS ?? "30000",
    10,
  );
  return Number.isNaN(value) || value <= 0 ? 30_000 : value;
}

export function releasePaths() {
  const root = releaseRoot();
  return {
    root,
    releasesDirectory: join(root, "releases"),
    incomingDirectory: join(root, "incoming"),
    currentLink: join(root, "current"),
    registryFile: join(root, "releases.json"),
    lockFile: join(root, ".release.lock"),
  };
}
