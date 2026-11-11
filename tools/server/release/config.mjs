// Release tooling configuration (phase 5, task 5.3).
//
// Paths follow the approved server layout documented in docs/runbook.md:
//   /var/lib/mountain-runners/releases/<commit>/  extracted releases, pruned by policy
//   /var/lib/mountain-runners/current             atomic symlink to the active release
//   /var/lib/mountain-runners/releases.json       permanent release registry
//   /var/lib/mountain-runners/incoming/           uploads staged before installation
//
// The registry is permanent: it keeps the commit, the digests and the state of
// every release ever installed. The extracted trees and the staged uploads are
// not: prune bounds them so the disk cannot grow with every deployment.
//
// Tests override MOUNTAIN_RELEASE_ROOT to a temporary directory. The approved
// limits are server-side constants (defense in depth): they are never taken
// from the manifest, so a tampered manifest cannot relax them.

import { join } from "node:path";

export const approvedLimits = Object.freeze({
  // Approved in T5.2: measured build is 149 files and ~21 MB expanded.
  maxExpandedBytes: 134_217_728, // 128 MiB
  maxFileCount: 5_000,
  // Compressed archive ceiling used by install and by the SSH receive path.
  maxArchiveBytes: 268_435_456, // 256 MiB
});

// Retention of the release artifacts (runbook: "Retenció i poda"). The window
// counts releases, not days: the active release plus the most recent eligible
// ones. Below two there is no rollback target left, so prune refuses. The upper
// bound only protects a manual invocation from an accidental huge window; a
// deployment can never change the window because prune takes no arguments over
// the SSH gate.
export const retentionPolicy = Object.freeze({
  retainedReleases: 5,
  minimumRetainedReleases: 2,
  maximumRetainedReleases: 50,
  // Uploads are consumed by a successful install; anything left behind belongs
  // to a failed install or to an interrupted transfer.
  uploadLifetimeMs: 24 * 60 * 60 * 1000,
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
