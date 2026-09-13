#!/usr/bin/env node
// Artifact packaging shared by the production contract (T5.2) and the preview
// contract (T6.3). Both builders run the web build, verify the canonical
// output surface, record a manifest that binds commit, origin, editorial date
// and every file with its SHA-256 digest, and package only regular files
// under a relative root with the approved limits.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));

// Approved limits (T5.2): measured build is 149 files and ~21 MB expanded, so
// these values leave headroom while still failing loudly on an accidental
// size explosion or file-count bomb. The server re-applies the same limits as
// frozen constants; the manifest never relaxes them.
export const manifestLimits = Object.freeze({
  maxExpandedBytes: 134_217_728, // 128 MiB
  maxFileCount: 5_000,
});

export const manifestSchemaVersion = 1;

export function requireEnvironment(name, purpose) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to ${purpose}.`);
  }
  return value;
}

export function requireEditorialDate(purpose) {
  const buildToday = requireEnvironment("BUILD_TODAY", purpose);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(buildToday)) {
    throw new Error(
      `BUILD_TODAY must use the YYYY-MM-DD format, got ${buildToday}.`,
    );
  }
  return buildToday;
}

export function currentCommit() {
  if (process.env.GITHUB_SHA !== undefined) {
    return process.env.GITHUB_SHA;
  }
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDirectory,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      "Cannot resolve the current commit (git rev-parse failed).",
    );
  }
  return result.stdout.trim();
}

export function runBuild() {
  const result = spawnSync("pnpm", ["build"], {
    cwd: rootDirectory,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Build failed with status ${result.status}.`);
  }
}

export async function listRegularFiles(directory, root) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const stats = await lstat(absolutePath);
    if (stats.isDirectory()) {
      files.push(...(await listRegularFiles(absolutePath, root)));
    } else if (stats.isFile()) {
      files.push({ relativePath: relative(root, absolutePath), absolutePath });
    } else {
      throw new Error(
        `Output entry is not a regular file and cannot be packaged: ${relative(root, absolutePath)}`,
      );
    }
  }
  return files;
}

function sha256OfFile(absolutePath) {
  const hash = createHash("sha256");
  const content = readFile(absolutePath);
  return content.then((buffer) => {
    hash.update(buffer);
    return hash.digest("hex");
  });
}

function enforceLimits(files, limits) {
  const expandedBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length > limits.maxFileCount) {
    throw new Error(
      `Artifact exceeds the approved file count limit: ${files.length} > ${limits.maxFileCount}`,
    );
  }
  if (expandedBytes > limits.maxExpandedBytes) {
    throw new Error(
      `Artifact exceeds the approved expanded size limit: ${expandedBytes} bytes > ${limits.maxExpandedBytes} bytes`,
    );
  }
  return expandedBytes;
}

// Walks the built output and returns the manifest file list sorted by path,
// enforcing the approved limits.
export async function collectManifestFiles(distDirectory) {
  const regularFiles = await listRegularFiles(distDirectory, distDirectory);
  const files = [];
  for (const file of regularFiles) {
    const size = (await lstat(file.absolutePath)).size;
    files.push({
      path: file.relativePath,
      size,
      sha256: await sha256OfFile(file.absolutePath),
    });
  }
  files.sort((first, second) => first.path.localeCompare(second.path));
  const expandedBytes = enforceLimits(files, manifestLimits);
  return { files, expandedBytes };
}

function buildArchive(distDirectory, fileListPath, archivePath) {
  const result = spawnSync(
    "tar",
    [
      "--create",
      "--gzip",
      "--file",
      archivePath,
      "--directory",
      distDirectory,
      "--files-from",
      fileListPath,
    ],
    { cwd: rootDirectory, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`Archive creation failed with status ${result.status}.`);
  }
}

function listArchiveEntries(archivePath) {
  const result = spawnSync("tar", ["--list", "--gzip", "--file", archivePath], {
    cwd: rootDirectory,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Archive listing failed with status ${result.status}.`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

// Packages the verified output: wipes the output directory, writes the
// archive from the manifest file list, checks the archive entry set against
// the manifest and writes the manifest last. Returns the packaged paths for
// the caller's summary.
export async function packageArtifact({
  distDirectory,
  outputDirectory,
  manifest,
}) {
  const shortCommit = manifest.commit.slice(0, 12);
  const archiveName = `mountain-runners-${shortCommit}.tar.gz`;
  const fileListPath = join(outputDirectory, ".file-list.txt");
  const archivePath = join(outputDirectory, archiveName);
  const manifestPath = join(outputDirectory, "manifest.json");

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    fileListPath,
    manifest.files.map((file) => file.path).join("\n"),
    "utf8",
  );
  buildArchive(distDirectory, fileListPath, archivePath);

  const archiveEntries = listArchiveEntries(archivePath).sort();
  const manifestPaths = manifest.files.map((file) => file.path).sort();
  if (JSON.stringify(archiveEntries) !== JSON.stringify(manifestPaths)) {
    throw new Error("Archive entries do not match the manifest file list.");
  }

  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await rm(fileListPath, { force: true });

  return { archiveName, archivePath, manifestPath };
}
