// Local verification of the CI artifact before it crosses the server
// boundary (phase 5, task 5.4). The job of build never sees production
// credentials; this module only reads the downloaded package and manifest.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  assertManifestMatchesArchive,
  listArchiveEntries,
  validateArchiveEntries,
} from "../server/release/archive.mjs";
import { approvedLimits } from "../server/release/config.mjs";
import { readFileBounded } from "../server/release/fsutil.mjs";
import {
  loadAndValidateManifest,
  sha256OfBuffer,
} from "../server/release/manifest.mjs";

export const productionOrigin = "https://mountainrunners.cat";

export async function loadVerifiedArtifact(
  artifactDirectory,
  { expectedCommit, expectedOrigin = productionOrigin },
) {
  const manifestPath = join(artifactDirectory, "manifest.json");
  const manifest = await loadAndValidateManifest(manifestPath);
  if (manifest.commit !== expectedCommit) {
    throw new Error(
      `Manifest commit ${manifest.commit} does not match the candidate ${expectedCommit}.`,
    );
  }
  if (manifest.origin !== expectedOrigin) {
    throw new Error(
      `Manifest origin ${manifest.origin} is not the production origin ${expectedOrigin}.`,
    );
  }

  const archiveFileName = await findArchiveFileName(
    artifactDirectory,
    expectedCommit,
  );
  const archivePath = join(artifactDirectory, archiveFileName);
  const archiveBuffer = readFileBounded(
    archivePath,
    approvedLimits.maxArchiveBytes,
  );
  const archiveEntries = listArchiveEntries(archiveBuffer);
  const { filesByName } = validateArchiveEntries(archiveEntries);
  assertManifestMatchesArchive(manifest.files, filesByName);

  const manifestBuffer = readFileBounded(manifestPath, 1 * 1024 * 1024);
  return {
    archiveFileName,
    archiveBuffer,
    archiveSha256: sha256OfBuffer(archiveBuffer),
    manifestBuffer,
    manifestSha256: sha256OfBuffer(manifestBuffer),
    manifest,
  };
}

async function findArchiveFileName(artifactDirectory, expectedCommit) {
  const names = await readdir(artifactDirectory);
  const archiveNames = names.filter((name) => name.endsWith(".tar.gz"));
  if (archiveNames.length !== 1 || archiveNames[0] === undefined) {
    throw new Error(
      `Expected exactly one .tar.gz in ${artifactDirectory}; found ${archiveNames.length}.`,
    );
  }
  const archiveFileName = archiveNames[0];
  const expectedPrefix = `mountain-runners-${expectedCommit.slice(0, 12)}`;
  if (!archiveFileName.startsWith(expectedPrefix)) {
    throw new Error(
      `Archive name ${archiveFileName} does not match commit ${expectedCommit}.`,
    );
  }
  return archiveFileName;
}
