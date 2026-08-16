#!/usr/bin/env node
// Production artifact contract (T5.2). Builds the web in a clean checkout,
// verifies the canonical output surface, records a manifest that binds commit,
// origin, editorial date, workflow and every file with its SHA-256 digest, and
// packages only regular files under a relative root with approved limits.
//
// Required environment:
//   PUBLIC_SITE_ORIGIN  production origin (https://mountainrunners.cat)
//   BUILD_TODAY         editorial date, explicit and coherent with Madrid time
// Optional environment (CI):
//   GITHUB_SHA          commit to record in the manifest
//   GITHUB_WORKFLOW     workflow name to record in the manifest
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
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyInternalLinks } from "./verify-internal-links.mjs";

const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));
const distDirectory = resolve(rootDirectory, "apps/web/dist");
const releaseDirectory = resolve(rootDirectory, "artifacts/release");

// Approved limits (T5.2): measured build is 149 files and ~21 MB expanded, so
// these values leave headroom while still failing loudly on an accidental
// size explosion or file-count bomb.
const approvedLimits = {
  maxExpandedBytes: 134_217_728, // 128 MiB
  maxFileCount: 5_000,
};

const manifestSchemaVersion = 1;

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to build the production artifact.`);
  }
  return value;
}

const publicSiteOrigin = requireEnvironment("PUBLIC_SITE_ORIGIN");
const buildToday = requireEnvironment("BUILD_TODAY");
if (!/^\d{4}-\d{2}-\d{2}$/u.test(buildToday)) {
  throw new Error(
    `BUILD_TODAY must use the YYYY-MM-DD format, got ${buildToday}.`,
  );
}

function currentCommit() {
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

function runBuild() {
  const result = spawnSync("pnpm", ["build"], {
    cwd: rootDirectory,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Build failed with status ${result.status}.`);
  }
}

async function listRegularFiles(directory, root) {
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

function writeManifest(manifest, destination) {
  return writeFile(
    destination,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
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

const commit = currentCommit();
const workflow = process.env.GITHUB_WORKFLOW ?? "local";

runBuild();
await verifyInternalLinks(distDirectory);

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
const expandedBytes = enforceLimits(files, approvedLimits);

const shortCommit = commit.slice(0, 12);
const archiveName = `mountain-runners-${shortCommit}.tar.gz`;
const fileListPath = join(releaseDirectory, ".file-list.txt");
const archivePath = join(releaseDirectory, archiveName);
const manifestPath = join(releaseDirectory, "manifest.json");

const manifest = {
  schemaVersion: manifestSchemaVersion,
  commit,
  origin: publicSiteOrigin,
  buildToday,
  workflow,
  limits: approvedLimits,
  totals: {
    fileCount: files.length,
    expandedBytes,
  },
  files,
};

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });
await writeFile(
  fileListPath,
  files.map((file) => file.path).join("\n"),
  "utf8",
);
buildArchive(distDirectory, fileListPath, archivePath);

const archiveEntries = listArchiveEntries(archivePath).sort();
const manifestPaths = files.map((file) => file.path).sort();
if (JSON.stringify(archiveEntries) !== JSON.stringify(manifestPaths)) {
  throw new Error("Archive entries do not match the manifest file list.");
}

await writeManifest(manifest, manifestPath);
await rm(fileListPath, { force: true });

console.log(`Commit:      ${commit}`);
console.log(`Origin:      ${publicSiteOrigin}`);
console.log(`BUILD_TODAY: ${buildToday}`);
console.log(`Workflow:    ${workflow}`);
console.log(`Files:       ${files.length} (${expandedBytes} bytes expanded)`);
console.log(`Archive:     ${archivePath}`);
console.log(`Manifest:    ${manifestPath}`);
