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
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectManifestFiles,
  currentCommit,
  manifestLimits,
  manifestSchemaVersion,
  packageArtifact,
  requireEnvironment,
  requireEditorialDate,
  runBuild,
} from "./packaging.mjs";
import { verifyInternalLinks } from "./verify-internal-links.mjs";

const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));
const distDirectory = resolve(rootDirectory, "apps/web/dist");
const releaseDirectory = resolve(rootDirectory, "artifacts/release");

const publicSiteOrigin = requireEnvironment(
  "PUBLIC_SITE_ORIGIN",
  "build the production artifact.",
);
const buildToday = requireEditorialDate("build the production artifact.");

const commit = currentCommit();
const workflow = process.env.GITHUB_WORKFLOW ?? "local";

runBuild();
await verifyInternalLinks(distDirectory);

const { files, expandedBytes } = await collectManifestFiles(distDirectory);

const manifest = {
  schemaVersion: manifestSchemaVersion,
  commit,
  origin: publicSiteOrigin,
  buildToday,
  workflow,
  limits: manifestLimits,
  totals: {
    fileCount: files.length,
    expandedBytes,
  },
  files,
};

const { archivePath, manifestPath } = await packageArtifact({
  distDirectory,
  outputDirectory: releaseDirectory,
  manifest,
});

console.log(`Commit:      ${commit}`);
console.log(`Origin:      ${publicSiteOrigin}`);
console.log(`BUILD_TODAY: ${buildToday}`);
console.log(`Workflow:    ${workflow}`);
console.log(`Files:       ${files.length} (${expandedBytes} bytes expanded)`);
console.log(`Archive:     ${archivePath}`);
console.log(`Manifest:    ${manifestPath}`);
