#!/usr/bin/env node
// Reproducibility verification (T5.2): two clean builds with identical inputs
// must produce the same file list and identical SHA-256 digests. The build is
// executed twice from the same checkout, lockfile and environment, deleting
// the generated output between runs so neither build can reuse the previous
// one.
//
// Required environment:
//   PUBLIC_SITE_ORIGIN  production origin (https://mountainrunners.cat)
//   BUILD_TODAY         editorial date, fixed for both builds
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));
const distDirectory = resolve(rootDirectory, "apps/web/dist");

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to verify reproducibility.`);
  }
  return value;
}

requireEnvironment("PUBLIC_SITE_ORIGIN");
requireEnvironment("BUILD_TODAY");

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
        `Output entry is not a regular file: ${relative(root, absolutePath)}`,
      );
    }
  }
  return files;
}

async function snapshotOutput() {
  const files = await listRegularFiles(distDirectory, distDirectory);
  const entries = [];
  for (const file of files) {
    const content = await readFile(file.absolutePath);
    const hash = createHash("sha256");
    hash.update(content);
    entries.push({ path: file.relativePath, sha256: hash.digest("hex") });
  }
  entries.sort((first, second) => first.path.localeCompare(second.path));
  return entries;
}

function describeDifferences(firstSnapshot, secondSnapshot) {
  const firstByPath = new Map(
    firstSnapshot.map((entry) => [entry.path, entry.sha256]),
  );
  const secondByPath = new Map(
    secondSnapshot.map((entry) => [entry.path, entry.sha256]),
  );
  const differences = [];
  for (const path of firstByPath.keys()) {
    if (!secondByPath.has(path)) {
      differences.push(`missing from the second build: ${path}`);
    } else if (firstByPath.get(path) !== secondByPath.get(path)) {
      differences.push(`different digest in the second build: ${path}`);
    }
  }
  for (const path of secondByPath.keys()) {
    if (!firstByPath.has(path)) {
      differences.push(`unexpected in the second build: ${path}`);
    }
  }
  return differences;
}

runBuild();
const firstSnapshot = await snapshotOutput();
await rm(distDirectory, { recursive: true, force: true });
runBuild();
const secondSnapshot = await snapshotOutput();

if (JSON.stringify(firstSnapshot) !== JSON.stringify(secondSnapshot)) {
  const differences = describeDifferences(firstSnapshot, secondSnapshot);
  const shown = differences.slice(0, 20);
  const hidden = differences.length - shown.length;
  const suffix = hidden > 0 ? `\n… and ${hidden} more differences` : "";
  throw new Error(
    `Two clean builds with identical inputs differ:\n${shown.join("\n")}${suffix}`,
  );
}

console.log(
  `Reproducibility verified: ${firstSnapshot.length} files with identical digests across two clean builds.`,
);
