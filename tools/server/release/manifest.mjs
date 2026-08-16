// Production artifact manifest validation (phase 5, task 5.3).
//
// The manifest is produced by tools/release/build-artifact.mjs (T5.2) and
// binds commit, origin, editorial date, workflow and every file with its
// SHA-256 digest. The server re-validates it defensively: a tampered manifest
// is rejected before anything is extracted.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { normalize } from "node:path";
import { readFileBounded } from "./fsutil.mjs";

export const manifestSchemaVersion = 1;
export const commitPattern = /^[0-9a-f]{40}$/u;
export const sha256Pattern = /^[0-9a-f]{64}$/u;
export const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

// Manifests are a few dozen KiB; the bound is a hard ceiling against a
// malicious upload.
const maxManifestBytes = 1 * 1024 * 1024;

export async function loadAndValidateManifest(manifestPath) {
  let content;
  try {
    content = readFileBounded(manifestPath, maxManifestBytes).toString("utf8");
  } catch (error) {
    throw new Error(
      `Cannot read the manifest at ${manifestPath}: ${error.message}`,
      { cause: error },
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch (error) {
    throw new Error(`The manifest is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }

  validateManifest(manifest);
  return manifest;
}

export function validateManifest(manifest) {
  if (manifest.schemaVersion !== manifestSchemaVersion) {
    throw new Error(
      `Unsupported manifest schemaVersion ${manifest.schemaVersion}; expected ${manifestSchemaVersion}.`,
    );
  }
  if (
    typeof manifest.commit !== "string" ||
    !commitPattern.test(manifest.commit)
  ) {
    throw new Error("The manifest commit must be a 40-character hex SHA-1.");
  }
  if (typeof manifest.origin !== "string" || manifest.origin.length === 0) {
    throw new Error("The manifest origin is missing.");
  }
  if (
    typeof manifest.buildToday !== "string" ||
    !datePattern.test(manifest.buildToday)
  ) {
    throw new Error("The manifest buildToday must use the YYYY-MM-DD format.");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("The manifest must list at least one file.");
  }

  const seenPaths = new Set();
  let expandedBytes = 0;
  for (const entry of manifest.files) {
    validateManifestFileEntry(entry);
    if (seenPaths.has(entry.path)) {
      throw new Error(
        `The manifest lists the path ${entry.path} more than once.`,
      );
    }
    seenPaths.add(entry.path);
    expandedBytes += entry.size;
  }

  const totals = manifest.totals ?? {};
  if (totals.fileCount !== manifest.files.length) {
    throw new Error(
      `Manifest totals.fileCount (${totals.fileCount}) does not match the file list (${manifest.files.length}).`,
    );
  }
  if (totals.expandedBytes !== expandedBytes) {
    throw new Error(
      `Manifest totals.expandedBytes (${totals.expandedBytes}) does not match the file list (${expandedBytes}).`,
    );
  }
}

function validateManifestFileEntry(entry) {
  if (typeof entry.path !== "string" || !isSafeRelativePath(entry.path)) {
    throw new Error(
      `The manifest contains an unsafe path: ${JSON.stringify(entry?.path)}.`,
    );
  }
  if (
    typeof entry.size !== "number" ||
    !Number.isInteger(entry.size) ||
    entry.size < 0
  ) {
    throw new Error(`The manifest contains an invalid size for ${entry.path}.`);
  }
  if (typeof entry.sha256 !== "string" || !sha256Pattern.test(entry.sha256)) {
    throw new Error(
      `The manifest contains an invalid digest for ${entry.path}.`,
    );
  }
}

// A path is safe when it is relative, never escapes its root and contains no
// control characters. Normalization guarantees "a/../b" is caught as well.
export function isSafeRelativePath(path) {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  for (const character of path) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return false;
  }
  const normalized = normalize(path);
  return normalized !== ".." && !normalized.startsWith(`..${"/"}`);
}

export function sha256OfFile(absolutePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

export function sha256OfBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
