// Release operations (phase 5, task 5.3).
//
// Single implementation of the release lifecycle shared by the human CLI
// (run by the maintainer as root) and the release daemon (run by systemd as
// root and driven by the deploy SSH identity through the validated gate).
// Every operation returns an exit code and a message; failures throw.

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import {
  assertManifestMatchesArchive,
  extractArchive,
  listArchiveEntries,
  validateArchiveEntries,
  verifyReleaseDigests,
} from "./archive.mjs";
import { releasePaths, approvedLimits, retentionPolicy } from "./config.mjs";
import { readFileBounded } from "./fsutil.mjs";
import { loadAndValidateManifest } from "./manifest.mjs";
import {
  eligibleReleases,
  findRelease,
  isEligibleRelease,
  loadRegistry,
  saveRegistry,
  withRegistryLock,
} from "./registry.mjs";

export class NoEligibleReleaseError extends Error {}

export async function performInstall(archivePath, manifestPath) {
  const manifest = await loadAndValidateManifest(manifestPath);
  const archiveBuffer = readFileBounded(
    archivePath,
    approvedLimits.maxArchiveBytes,
  );
  const archiveSha256 = sha256OfBuffer(archiveBuffer);
  const archiveEntries = listArchiveEntries(archiveBuffer);
  const { filesByName, expandedBytes } = validateArchiveEntries(archiveEntries);
  assertManifestMatchesArchive(manifest.files, filesByName);

  // The whole extraction runs under the registry lock so two installs of the
  // same commit can never interleave.
  return withRegistryLock(async () => {
    const registry = loadRegistry();
    if (findRelease(registry, manifest.commit) !== undefined) {
      throw new Error(`Release ${manifest.commit} is already registered.`);
    }

    const releaseDirectory = join(
      releasePaths().releasesDirectory,
      manifest.commit,
    );
    if (await pathExists(releaseDirectory)) {
      // Orphan from an interrupted install: never registered, never served.
      await rm(releaseDirectory, { recursive: true, force: true });
    }

    await mkdir(releaseDirectory, { recursive: true });
    try {
      extractArchive(archiveBuffer, releaseDirectory);
      await verifyReleaseDigests(releaseDirectory, manifest.files);
    } catch (error) {
      // A failed install must leave no incomplete release behind.
      await rm(releaseDirectory, { recursive: true, force: true });
      throw error;
    }

    const registryEntry = {
      commit: manifest.commit,
      origin: manifest.origin,
      buildToday: manifest.buildToday,
      workflow: manifest.workflow,
      archiveSha256,
      fileCount: manifest.files.length,
      expandedBytes,
      files: manifest.files.map((entry) => ({
        path: entry.path,
        sha256: entry.sha256,
      })),
      installedAt: new Date().toISOString(),
      status: "eligible",
    };

    registry.releases.push(registryEntry);
    saveRegistry(registry);
    // The uploads are consumed from here on. The deploy job re-transfers them
    // on every run, so keeping them would only grow incoming/ with every
    // deployment; a failed install keeps its uploads for diagnosis.
    await discardConsumedUploads(archivePath, manifestPath);
    return `Installed release ${manifest.commit} (${registryEntry.fileCount} files).`;
  });
}

export async function performActivate(commit) {
  return withRegistryLock(() => activateLocked(commit));
}

export async function performRollback(commit) {
  return withRegistryLock(async () => {
    const registry = loadRegistry();
    let selectedCommit = commit;
    if (selectedCommit === undefined) {
      const candidates = eligibleReleases(registry).sort((first, second) =>
        second.installedAt.localeCompare(first.installedAt),
      );
      if (candidates.length === 0) {
        throw new NoEligibleReleaseError(
          "No eligible release remains; apply the emergency response defined in the runbook.",
        );
      }
      const previous = candidates.find(
        (entry) => entry.commit === registry.previousActiveCommit,
      );
      selectedCommit = previous?.commit ?? candidates[0].commit;
    }
    const message = await activateLocked(selectedCommit);
    return `${message}\nRolled back to release ${selectedCommit}.`;
  });
}

export async function performPrune(keep = retentionPolicy.retainedReleases) {
  assertRetentionWindow(keep);
  return withRegistryLock(async () => {
    const registry = loadRegistry();
    const paths = releasePaths();
    const activeEntries = registry.releases.filter(
      (entry) => entry.status === "active",
    );
    if (activeEntries.length !== 1) {
      throw new Error(
        `Pruning requires exactly one active release; found ${activeEntries.length}. Run mountain-release health first.`,
      );
    }
    const activeCommit = activeEntries[0].commit;
    const activeDirectory = join(paths.releasesDirectory, activeCommit);
    const currentTarget = await readCurrentTarget(paths.currentLink);
    if (currentTarget !== activeDirectory) {
      throw new Error(
        `current points to ${currentTarget}, not to the active release ${activeCommit}; run mountain-release health before pruning.`,
      );
    }

    const directoryNames = await listDirectoryNames(paths.releasesDirectory);
    if (!directoryNames.has(activeCommit)) {
      throw new Error(
        `The active release ${activeCommit} is missing; run mountain-release health before pruning.`,
      );
    }
    const kept = retainedCommits(registry, activeCommit, keep, directoryNames);

    const prunedAt = new Date().toISOString();
    let newlyPruned = 0;
    for (const entry of registry.releases) {
      if (kept.has(entry.commit) || entry.prunedAt !== undefined) {
        continue;
      }
      entry.prunedAt = prunedAt;
      newlyPruned += 1;
    }
    if (newlyPruned > 0) {
      // Registry first: an orphan directory is harmless, but an eligible
      // entry without a tree breaks the next activation.
      saveRegistry(registry);
    }

    let removedDirectories = 0;
    for (const name of directoryNames) {
      if (kept.has(name)) {
        continue;
      }
      await rm(join(paths.releasesDirectory, name), {
        recursive: true,
        force: true,
      });
      removedDirectories += 1;
    }
    const removedUploads = await discardExpiredUploads(paths.incomingDirectory);
    await assertCurrentRelease(activeDirectory);

    return `Retained ${kept.size} releases (${newlyPruned} newly pruned), removed ${removedDirectories} release directories and ${removedUploads} expired uploads.`;
  });
}

export async function performRevoke(commit, reason) {
  if (reason.length > 200) {
    throw new Error("The revocation reason must not exceed 200 characters.");
  }
  return withRegistryLock(() => {
    const registry = loadRegistry();
    const entry = findRelease(registry, commit);
    if (entry === undefined) {
      throw new Error(`Release ${commit} is not registered.`);
    }
    if (entry.status === "active") {
      throw new Error(
        `Release ${commit} is active; activate or roll back to another release before revoking it.`,
      );
    }
    if (entry.status === "revoked") {
      throw new Error(`Release ${commit} is already revoked.`);
    }
    entry.status = "revoked";
    entry.revokedAt = new Date().toISOString();
    entry.revokedReason = reason;
    saveRegistry(registry);
    return `Revoked release ${commit}.`;
  });
}

export function performList() {
  const registry = loadRegistry();
  if (registry.releases.length === 0) {
    return "No releases registered.";
  }
  return [...registry.releases]
    .sort((first, second) =>
      second.installedAt.localeCompare(first.installedAt),
    )
    .map((entry) => {
      const markers = [];
      if (entry.status === "revoked") {
        markers.push(`(${entry.revokedReason})`);
      }
      if (entry.prunedAt !== undefined) {
        markers.push("(pruned)");
      }
      const suffix = markers.length === 0 ? "" : ` ${markers.join(" ")}`;
      return `${entry.status.padEnd(8)} ${entry.commit} build ${entry.buildToday} installed ${entry.installedAt}${suffix}`;
    })
    .join("\n");
}

export async function performHealth({ checkInactiveTrees = true } = {}) {
  const findings = [];
  let registry;
  try {
    registry = loadRegistry();
  } catch (error) {
    findings.push(`registry: ${error.message}`);
    return formatHealth(findings);
  }

  const { currentLink, releasesDirectory } = releasePaths();
  let currentTarget;
  try {
    currentTarget = await readlink(currentLink);
  } catch (error) {
    findings.push(`current: ${error.message}`);
    return formatHealth(findings);
  }

  const activeCommit = currentTarget.split("/").pop();
  const activeEntry = findRelease(registry, activeCommit);
  if (activeEntry === undefined || activeEntry.status !== "active") {
    findings.push(
      `current points to ${activeCommit}, which is ${activeEntry?.status ?? "not registered"}; expected active.`,
    );
  } else {
    try {
      await verifyReleaseDigests(
        join(releasesDirectory, activeCommit),
        activeEntry.files,
      );
    } catch (error) {
      findings.push(`active release: ${error.message}`);
    }
  }

  if (checkInactiveTrees) {
    findings.push(...(await findMissingReleaseTrees(registry)));
  }
  return formatHealth(findings);
}

// The registry and the disk must agree on every entry that could still be
// activated: an eligible entry without a tree breaks the next rollback, so it
// degrades health. Leftover directories that the registry does not know about
// are harmless and prune removes them.
async function findMissingReleaseTrees(registry) {
  const { releasesDirectory } = releasePaths();
  const directoryNames = await listDirectoryNames(releasesDirectory);
  const findings = [];
  for (const entry of registry.releases) {
    if (entry.prunedAt !== undefined) {
      continue;
    }
    if (!directoryNames.has(entry.commit)) {
      findings.push(
        `release ${entry.commit}: registered as ${entry.status} but its directory is missing; run mountain-release prune to reconcile it.`,
      );
    }
  }
  return findings;
}

function formatHealth(findings) {
  if (findings.length === 0) {
    return "Health: OK";
  }
  return `Health: DEGRADED\n${findings.map((finding) => `- ${finding}`).join("\n")}`;
}

async function activateLocked(commit) {
  const registry = loadRegistry();
  const entry = requireEligibleRelease(registry, commit);
  try {
    await verifyReleaseDigests(
      join(releasePaths().releasesDirectory, commit),
      entry.files,
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Release ${commit} has no complete release directory on disk; run mountain-release health and mountain-release prune.`,
        { cause: error },
      );
    }
    throw error;
  }

  await swapCurrentLink(join(releasePaths().releasesDirectory, commit));

  for (const candidate of registry.releases) {
    if (candidate.status === "active") {
      candidate.status = "eligible";
      registry.previousActiveCommit = candidate.commit;
      break;
    }
  }
  entry.status = "active";
  entry.activatedAt = new Date().toISOString();
  saveRegistry(registry);
  return `Activated release ${commit}.`;
}

function requireEligibleRelease(registry, commit) {
  const entry = findRelease(registry, commit);
  if (entry !== undefined && isEligibleRelease(entry)) {
    return entry;
  }
  throw new Error(
    `Release ${commit} is not eligible (${describeReleaseState(entry)}).`,
  );
}

function describeReleaseState(entry) {
  if (entry === undefined) {
    return "not registered";
  }
  if (entry.prunedAt !== undefined) {
    return `${entry.status}, pruned`;
  }
  return entry.status;
}

async function swapCurrentLink(releaseDirectory) {
  const { currentLink } = releasePaths();
  const temporaryLink = `${currentLink}.${process.pid}`;
  await symlink(releaseDirectory, temporaryLink);
  try {
    // Rename is atomic: readers always observe either the old or the new link.
    await rename(temporaryLink, currentLink);
  } catch (error) {
    await unlink(temporaryLink).catch(() => {});
    throw error;
  }
}

function sha256OfBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertRetentionWindow(keep) {
  const { minimumRetainedReleases, maximumRetainedReleases } = retentionPolicy;
  if (
    !Number.isInteger(keep) ||
    keep < minimumRetainedReleases ||
    keep > maximumRetainedReleases
  ) {
    throw new Error(
      `The retention window must be an integer between ${minimumRetainedReleases} and ${maximumRetainedReleases} releases (got ${keep}).`,
    );
  }
}

// Keep the displaced active release before newer, potentially unverified installs.
function retainedCommits(registry, activeCommit, keep, directoryNames) {
  const kept = new Set([activeCommit]);
  const candidates = eligibleReleases(registry)
    .filter((entry) => directoryNames.has(entry.commit))
    .sort((first, second) =>
      second.installedAt.localeCompare(first.installedAt),
    );
  const previous = candidates.find(
    (entry) => entry.commit === registry.previousActiveCommit,
  );
  if (previous !== undefined) {
    kept.add(previous.commit);
  }
  for (const entry of candidates) {
    if (kept.size >= keep) {
      break;
    }
    kept.add(entry.commit);
  }
  return kept;
}

async function listDirectoryNames(directory) {
  try {
    return new Set(await readdir(directory));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return new Set();
  }
}

async function readCurrentTarget(currentLink) {
  try {
    return await readlink(currentLink);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    throw new Error(
      "The current release symlink is missing; run mountain-release health before pruning.",
      { cause: error },
    );
  }
}

async function assertCurrentRelease(activeDirectory) {
  const { currentLink } = releasePaths();
  const target = await readCurrentTarget(currentLink);
  if (target !== activeDirectory) {
    throw new Error(
      `current no longer points to the active release ${activeDirectory} after pruning.`,
    );
  }
  if (!(await pathExists(activeDirectory))) {
    throw new Error(
      `The active release ${activeDirectory} is missing after pruning.`,
    );
  }
}

async function discardConsumedUploads(...uploadPaths) {
  for (const uploadPath of uploadPaths) {
    // A leftover upload is harmless (prune removes it after a day), so failing
    // to delete it must not fail an install that already succeeded.
    await unlink(uploadPath).catch(() => {});
  }
}

async function discardExpiredUploads(incomingDirectory) {
  const deadline = Date.now() - retentionPolicy.uploadLifetimeMs;
  let uploads;
  try {
    uploads = await readdir(incomingDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return 0;
  }
  let removed = 0;
  for (const upload of uploads) {
    if (upload.isDirectory()) {
      continue;
    }
    const uploadPath = join(incomingDirectory, upload.name);
    let metadata;
    try {
      metadata = await lstat(uploadPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      continue;
    }
    if (metadata.mtimeMs > deadline) {
      continue;
    }
    await unlink(uploadPath);
    removed += 1;
  }
  return removed;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
