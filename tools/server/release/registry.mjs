// Release registry (phase 5, task 5.3).
//
// The registry is the permanent record at
// /var/lib/mountain-runners/releases.json. Every release starts as "eligible"
// after installation, becomes "active" when the `current` symlink points to it
// and is rejected by activation and rollback once "revoked".
//
// Mutations are serialized through an exclusive lock file so concurrent CI
// executions cannot interleave partial state (spec: exclusive mutual exclusion,
// no two partial activations).

import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { lockTimeoutMs, releasePaths } from "./config.mjs";

export const releaseStatuses = Object.freeze(["eligible", "active", "revoked"]);

export const registrySchemaVersion = 1;

export function loadRegistry() {
  const { registryFile } = releasePaths();
  let content;
  try {
    content = readFileSync(registryFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { schemaVersion: registrySchemaVersion, releases: [] };
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Release registry is corrupted and cannot be parsed: ${error.message}`,
      { cause: error },
    );
  }

  if (
    parsed.schemaVersion !== registrySchemaVersion ||
    !Array.isArray(parsed.releases)
  ) {
    throw new Error(
      `Release registry has an unsupported shape (schemaVersion ${parsed.schemaVersion}).`,
    );
  }
  return parsed;
}

export function saveRegistry(registry) {
  const { registryFile } = releasePaths();
  const temporaryFile = `${registryFile}.tmp`;
  // Write, fsync and rename: atomic AND durable, so a crash cannot roll back
  // a revocation or an activation to an earlier state.
  const descriptor = openSync(temporaryFile, "w", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryFile, registryFile);
  fsyncDirectory(dirname(registryFile));
}

function fsyncDirectory(directoryPath) {
  const descriptor = openSync(directoryPath, "r");
  try {
    fsyncSync(descriptor);
  } catch (error) {
    // Some filesystems do not support fsync on directories; the rename itself
    // is still atomic.
    if (error.code !== "EINVAL" && error.code !== "ENOTSUP") {
      throw error;
    }
  } finally {
    closeSync(descriptor);
  }
}

export async function withRegistryLock(operation) {
  const { lockFile } = releasePaths();
  const timeoutMs = lockTimeoutMs();
  const deadline = Date.now() + timeoutMs;
  let descriptor;

  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockFile, "wx", 0o600);
      writeFileSync(
        descriptor,
        `${process.pid}\n${new Date().toISOString()}\n`,
      );
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      if (isStaleLock(lockFile)) {
        unlinkSync(lockFile);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Another release operation holds the lock (${lockFile}); giving up after ${timeoutMs} ms.`,
          { cause: error },
        );
      }
      await sleep(200);
    }
  }

  try {
    return await operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(lockFile);
  }
}

export function findRelease(registry, commit) {
  return registry.releases.find((entry) => entry.commit === commit);
}

export function eligibleReleases(registry) {
  return registry.releases.filter((entry) => entry.status === "eligible");
}

function isStaleLock(lockFile) {
  try {
    return Date.now() - statSync(lockFile).mtimeMs > 10 * 60 * 1000;
  } catch (error) {
    if (error.code === "ENOENT") {
      return true;
    }
    return false;
  }
}
