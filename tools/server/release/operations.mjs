// Release operations (phase 5, task 5.3).
//
// Single implementation of the release lifecycle shared by the human CLI
// (run by the maintainer as root) and the release daemon (run by systemd as
// root and driven by the deploy SSH identity through the validated gate).
// Every operation returns an exit code and a message; failures throw.

import { createHash } from "node:crypto";
import {
  mkdir,
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
import { releasePaths, approvedLimits } from "./config.mjs";
import { readFileBounded } from "./fsutil.mjs";
import { loadAndValidateManifest } from "./manifest.mjs";
import {
  eligibleReleases,
  findRelease,
  loadRegistry,
  saveRegistry,
  withRegistryLock,
} from "./registry.mjs";

export class NoEligibleReleaseError extends Error {}

export async function performInstall(archivePath, manifestPath) {
  const manifest = await loadAndValidateManifest(manifestPath);
  const archiveBuffer = readFileBounded(
    archivePath,
    2 * approvedLimits.maxExpandedBytes,
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
      selectedCommit = candidates[0].commit;
    }
    const message = await activateLocked(selectedCommit);
    return `${message}\nRolled back to release ${selectedCommit}.`;
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
      const reason =
        entry.status === "revoked" ? ` (${entry.revokedReason})` : "";
      return `${entry.status.padEnd(8)} ${entry.commit.slice(0, 12)} build ${entry.buildToday} installed ${entry.installedAt}${reason}`;
    })
    .join("\n");
}

export async function performHealth() {
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

  return formatHealth(findings);
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
  await verifyReleaseDigests(
    join(releasePaths().releasesDirectory, commit),
    entry.files,
  );

  await swapCurrentLink(join(releasePaths().releasesDirectory, commit));

  for (const candidate of registry.releases) {
    if (candidate.status === "active") {
      candidate.status = "eligible";
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
  if (entry === undefined || entry.status !== "eligible") {
    throw new Error(
      `Release ${commit} is not eligible (${entry?.status ?? "not registered"}).`,
    );
  }
  return entry;
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
