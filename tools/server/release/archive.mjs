// Safe archive handling (phase 5, task 5.3).
//
// Production only accepts the artifact packaged by tools/release/
// build-artifact.mjs (T5.2), but the server validates the archive defensively
// before anything touches disk: absolute paths, `..` traversal, symlinks,
// hardlinks, devices, FIFOs, unexpected types, duplicate entries and any entry
// exceeding the approved size/count limits are all rejected.
//
// Listing and extraction both consume the same in-memory buffer through
// stdin, so the bytes validated are exactly the bytes extracted (no TOCTOU
// window between listing and extraction). After extraction the tree is walked
// again and every file digest is compared against the manifest, so the
// extracted set must match the manifest set exactly.

import { spawnSync } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { approvedLimits } from "./config.mjs";
import { isSafeRelativePath, sha256OfFile } from "./manifest.mjs";

// Type flag shown as the first character of a `tar -tv` mode string.
const entryTypes = Object.freeze({
  regular: "-",
  directory: "d",
  symlink: "l",
  hardlink: "h",
  characterDevice: "c",
  blockDevice: "b",
  fifo: "p",
});

// GNU tar lists dates as "2026-08-16 13:45" (optionally with seconds) and
// owners as a single "user/group" token; BSD tar lists "Aug 16 13:45" (or
// "Aug 16  2025" for old files) with separate user and group fields and a link
// count. Both are parsed by locating the date and name from the right of the
// line, so the same validation runs on developer machines and on the Debian
// server; any line that matches neither format aborts the install (fail
// closed).
const datePatternSource =
  "\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}(?::\\d{2})?" +
  "|[A-Z][a-z]{2}\\s+\\d{1,2}\\s+(?:\\d{2}:\\d{2}|\\d{4})";
const modePattern = /^[bcdlhp-][rwxStT-]{9}$/u;

// Minimum on-disk cost charged per directory entry so that a directory bomb
// cannot bypass the approved expanded-size limit.
const directoryEntryOverhead = 512;

function runTar(args, input) {
  const result = spawnSync("tar", args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    input,
  });
  if (result.status !== 0) {
    const diagnostics = result.stderr?.trim() || "unknown tar error";
    throw new Error(`tar failed (${diagnostics}).`);
  }
  return result;
}

export function listArchiveEntries(archiveBuffer) {
  const result = runTar(
    ["--list", "--verbose", "--gzip", "--file", "-"],
    archiveBuffer,
  );
  const entries = [];
  for (const [lineIndex, line] of result.stdout.split("\n").entries()) {
    if (line.trim() === "") {
      continue;
    }
    const entry = parseListingLine(line);
    if (entry === null) {
      throw new Error(
        `Cannot parse archive listing line ${lineIndex + 1}: ${JSON.stringify(line)}.`,
      );
    }
    entries.push(entry);
  }
  return entries;
}

function parseListingLine(line) {
  const dateMatch = new RegExp(`(${datePatternSource})\\s+(.+)$`, "u").exec(
    line,
  );
  if (dateMatch === null) {
    return null;
  }
  const tokens = line.slice(0, dateMatch.index).trim().split(/\s+/u);
  const mode = tokens[0];
  if (mode === undefined || !modePattern.test(mode)) {
    return null;
  }
  const size = Number.parseInt(tokens[tokens.length - 1], 10);
  if (!Number.isInteger(size) || size < 0) {
    return null;
  }
  return {
    rawType: mode[0],
    size,
    rawName: dateMatch[2].trim(),
  };
}

export function validateArchiveEntries(entries) {
  const seenNames = new Set();
  const filesByName = new Map();
  let totalEntries = 0;
  let expandedBytes = 0;

  for (const entry of entries) {
    const name = normalizeEntryName(entry.rawName, entry.rawType);
    if (!isSafeRelativePath(name)) {
      throw new Error(
        `Archive contains an unsafe entry name: ${entry.rawName}.`,
      );
    }
    if (seenNames.has(name)) {
      throw new Error(`Archive contains the entry ${name} more than once.`);
    }
    seenNames.add(name);
    totalEntries += 1;

    if (entry.rawType === entryTypes.regular) {
      if (!Number.isInteger(entry.size) || entry.size < 0) {
        throw new Error(`Archive entry ${name} has an invalid size.`);
      }
      filesByName.set(name, entry.size);
      expandedBytes += entry.size;
    } else if (entry.rawType === entryTypes.directory) {
      expandedBytes += directoryEntryOverhead;
    } else {
      throw new Error(
        `Archive entry ${name} has an unsupported type (${entry.rawType}); only regular files and directories are allowed.`,
      );
    }
  }

  // Directories count against the approved limits too: a crafted archive must
  // not be able to exhaust inodes or disk with unlimited empty directories.
  assertWithinApprovedLimits(totalEntries, expandedBytes);
  return { filesByName, expandedBytes };
}

export function assertWithinApprovedLimits(fileCount, expandedBytes, limits) {
  const effectiveLimits = limits ?? approvedLimits;
  if (fileCount > effectiveLimits.maxFileCount) {
    throw new Error(
      `Artifact exceeds the approved file count limit: ${fileCount} > ${effectiveLimits.maxFileCount}.`,
    );
  }
  if (expandedBytes > effectiveLimits.maxExpandedBytes) {
    throw new Error(
      `Artifact exceeds the approved expanded size limit: ${expandedBytes} bytes > ${effectiveLimits.maxExpandedBytes} bytes.`,
    );
  }
}

export function assertManifestMatchesArchive(
  manifestFiles,
  archiveFilesByName,
) {
  const manifestPaths = manifestFiles.map((entry) => entry.path).sort();
  const archivePaths = [...archiveFilesByName.keys()].sort();
  if (JSON.stringify(manifestPaths) !== JSON.stringify(archivePaths)) {
    const missing = manifestPaths.filter(
      (path) => !archiveFilesByName.has(path),
    );
    const unexpected = archivePaths.filter(
      (path) => !manifestPaths.includes(path),
    );
    throw new Error(
      `Archive file set does not match the manifest ` +
        `(missing: ${missing.length}, unexpected: ${unexpected.length}).`,
    );
  }
}

export function extractArchive(archiveBuffer, destinationDirectory) {
  runTar(
    [
      "--extract",
      "--gzip",
      "--file",
      "-",
      "--directory",
      destinationDirectory,
      "--no-same-owner",
      "--no-same-permissions",
    ],
    archiveBuffer,
  );
}

// Recursively walks an installed release and returns the normalized relative
// paths of every regular file, rejecting anything that is not a regular file
// or a directory (defense in depth after extraction).
export async function walkReleaseTree(releaseDirectory) {
  const files = [];
  const directories = [releaseDirectory];
  while (directories.length > 0) {
    const currentDirectory = directories.pop();
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(currentDirectory, entry.name);
      const stats = await lstat(absolutePath);
      if (stats.isDirectory()) {
        directories.push(absolutePath);
      } else if (stats.isFile()) {
        files.push(absolutePath.slice(releaseDirectory.length + 1));
      } else {
        throw new Error(
          `Installed release contains a non-regular entry: ${absolutePath}.`,
        );
      }
    }
  }
  return files.sort();
}

export async function verifyReleaseDigests(releaseDirectory, manifestFiles) {
  const manifestByPath = new Map(
    manifestFiles.map((entry) => [entry.path, entry.sha256]),
  );
  const installedPaths = await walkReleaseTree(releaseDirectory);
  if (installedPaths.length !== manifestFiles.length) {
    throw new Error(
      `Installed file count (${installedPaths.length}) does not match the manifest (${manifestFiles.length}).`,
    );
  }
  for (const relativePath of installedPaths) {
    const expectedDigest = manifestByPath.get(relativePath);
    if (expectedDigest === undefined) {
      throw new Error(`Installed file ${relativePath} is not in the manifest.`);
    }
    const actualDigest = await sha256OfFile(
      join(releaseDirectory, relativePath),
    );
    if (actualDigest !== expectedDigest) {
      throw new Error(
        `Digest mismatch for ${relativePath}: expected ${expectedDigest}, got ${actualDigest}.`,
      );
    }
  }
}

// Normalizes a raw tar entry name: strips a leading "./", strips a trailing
// "/" from directories and rejects names that reduce to ".".
function normalizeEntryName(rawName, rawType) {
  let name = rawName;
  if (name.startsWith("./")) {
    name = name.slice(2);
  }
  if (rawType === entryTypes.directory && name.endsWith("/")) {
    name = name.slice(0, -1);
  }
  if (name === "" || name === ".") {
    throw new Error(`Archive contains an empty entry name.`);
  }
  return name;
}
