// Destination of a cleaned attachment (T8.4).
//
// The file lands ignored by Git inside the worktree, so it never reaches a
// commit or a publication by accident: the model decides the real content path.
// The name is normalised to a safe slug because it comes from Telegram, and the
// directory is never followed when it is a symbolic link.

import {
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { attachmentRefusalReasons } from "./refusals.mjs";

export const attachmentDirectoryName = ".agent-attachments";
export const attachmentNameMaximumLength = 60;
export const fallbackAttachmentName = "adjunt";

function baseName(fileName) {
  const separator = Math.max(
    fileName.lastIndexOf("/"),
    fileName.lastIndexOf("\\"),
  );
  return separator === -1 ? fileName : fileName.slice(separator + 1);
}

function withoutExtension(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

/**
 * A safe file name: lower case, only `a-z`, digits and hyphens in the base
 * name, at most 60 characters, and the canonical extension of the real type.
 * A name that normalises to nothing becomes `adjunt`, and a path separator can
 * never survive because only the last segment is used.
 */
export function attachmentFileName({ fileName, extension }) {
  const base = withoutExtension(baseName(fileName ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, attachmentNameMaximumLength)
    .replace(/-+$/gu, "");
  return `${base === "" ? fallbackAttachmentName : base}${extension}`;
}

/**
 * Write the cleaned file inside the worktree with exclusive creation. An
 * existing entry, a symbolic link or a file where the directory belongs are
 * refused instead of overwritten or followed.
 */
export function writeAttachmentFile({ worktreePath, fileName, bytes }) {
  const directory = join(worktreePath, attachmentDirectoryName);
  const relativePath = `${attachmentDirectoryName}/${fileName}`;
  let directoryStats = null;
  try {
    directoryStats = lstatSync(directory);
  } catch (error) {
    if (error.code !== "ENOENT") {
      return {
        refusal: { reason: attachmentRefusalReasons.destinationUnavailable },
      };
    }
  }
  if (directoryStats !== null && !directoryStats.isDirectory()) {
    return {
      refusal: { reason: attachmentRefusalReasons.destinationUnavailable },
    };
  }
  if (directoryStats === null) {
    try {
      mkdirSync(directory);
    } catch {
      return {
        refusal: { reason: attachmentRefusalReasons.destinationUnavailable },
      };
    }
  }
  const target = join(directory, fileName);
  let descriptor;
  try {
    descriptor = openSync(target, "wx", 0o644);
  } catch (error) {
    if (error.code === "EEXIST") {
      return {
        refusal: {
          reason: attachmentRefusalReasons.destinationExists,
          path: relativePath,
        },
      };
    }
    return {
      refusal: { reason: attachmentRefusalReasons.destinationUnavailable },
    };
  }
  try {
    // The service runs with UMask=0077, so the readable mode is set on the open
    // file instead of depending on the process umask.
    fchmodSync(descriptor, 0o644);
    writeFileSync(descriptor, bytes);
  } catch {
    rmSync(target, { force: true });
    return {
      refusal: { reason: attachmentRefusalReasons.destinationUnavailable },
    };
  } finally {
    closeSync(descriptor);
  }
  return { relativePath };
}

/**
 * Remove the worktree's attachment directory before the checks and the commit,
 * so a received image never reaches a commit, a pull request or a publication,
 * even on a branch whose .gitignore predates this rule. A symbolic link is
 * removed as a link and never followed.
 */
export function removeAttachmentDirectory({ worktreePath }) {
  const directory = join(worktreePath, attachmentDirectoryName);
  let stats;
  try {
    stats = lstatSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stats.isDirectory()) {
    rmSync(directory, { recursive: true, force: true });
    return;
  }
  unlinkSync(directory);
}
