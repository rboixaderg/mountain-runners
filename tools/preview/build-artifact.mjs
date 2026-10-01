#!/usr/bin/env node
// Preview artifact contract (T6.3). The untrusted pull_request job builds the
// web with the exact preview origin bound to the PR, records a manifest that
// binds commit, PR number, origin, editorial date, workflow and every file
// with its SHA-256 digest, and packages an intermediate artifact that a
// maintainer may authorize for publication through the trusted publisher. The
// origin is derived here and validated again by the publisher; the artifact
// carries no secrets.
//
// Required environment:
//   PUBLIC_SITE_ORIGIN  preview origin (https://pr-<n>.preview.mountainrunners.cat)
//   BUILD_TODAY         editorial date, explicit and coherent with Madrid time
//   PR_NUMBER           pull request number the artifact belongs to
// Optional environment (CI):
//   GITHUB_SHA          PR head commit to record in the manifest
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
} from "../release/packaging.mjs";
import { verifyInternalLinks } from "../release/verify-internal-links.mjs";

const rootDirectory = fileURLToPath(new URL("../..", import.meta.url));
const distDirectory = resolve(rootDirectory, "apps/web/dist");
const previewArtifactDirectory = resolve(rootDirectory, "artifacts/preview");

const pullRequestNumber = requireEnvironment(
  "PR_NUMBER",
  "build the preview artifact.",
);
if (!/^\d+$/u.test(pullRequestNumber)) {
  throw new Error(
    `PR_NUMBER must be a decimal pull request number, got ${pullRequestNumber}.`,
  );
}
const previewOrigin = `https://pr-${pullRequestNumber}.preview.mountainrunners.cat`;

const publicSiteOrigin = requireEnvironment(
  "PUBLIC_SITE_ORIGIN",
  "build the preview artifact.",
);
if (publicSiteOrigin !== previewOrigin) {
  throw new Error(
    `PUBLIC_SITE_ORIGIN must be the preview origin ${previewOrigin}, got ${publicSiteOrigin}.`,
  );
}
const buildToday = requireEditorialDate("build the preview artifact.");

const commit = currentCommit();
const workflow = process.env.GITHUB_WORKFLOW ?? "local";

runBuild();
await verifyInternalLinks(distDirectory);

const { files, expandedBytes } = await collectManifestFiles(distDirectory);

const manifest = {
  schemaVersion: manifestSchemaVersion,
  commit,
  pullRequestNumber: Number(pullRequestNumber),
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
  outputDirectory: previewArtifactDirectory,
  manifest,
});

console.log(`Commit:      ${commit}`);
console.log(`PR:          ${pullRequestNumber}`);
console.log(`Origin:      ${publicSiteOrigin}`);
console.log(`BUILD_TODAY: ${buildToday}`);
console.log(`Workflow:    ${workflow}`);
console.log(`Files:       ${files.length} (${expandedBytes} bytes expanded)`);
console.log(`Archive:     ${archivePath}`);
console.log(`Manifest:    ${manifestPath}`);
