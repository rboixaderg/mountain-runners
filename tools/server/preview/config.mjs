// Preview namespace configuration (T6.3).
//
// The preview identity owns one namespace per pull request under
// /var/lib/mountain-runners-previews/namespaces, mirroring the release layout
// of /var/lib/mountain-runners inside each namespace:
//   pr-<n>/releases/<commit>/   extracted, digest-verified builds
//   pr-<n>/current              atomic symlink to the active build
//   pr-<n>/releases.json        per-namespace registry
//   pr-<n>/incoming/            uploads staged before installation
//
// The preview identity never reaches /var/lib/mountain-runners (production),
// /etc/caddy, the TLS keys or the ACME state: those stay root-owned and are
// written only by the release daemon of phase 5.
//
// The origin of every preview is derived from the pull request number and is
// validated again by the trusted publisher and by the install operation, so a
// manifest built for another PR (or for production) can never install into
// this namespace. This is the single validation shared by the CI publisher
// and the server gate: the manifest origin must be the PR's preview origin
// and the recorded PR number must match the namespace argument.
export function assertPreviewManifestConsistency(manifest, pullRequestNumber) {
  const expectedOrigin = previewOrigin(pullRequestNumber);
  if (manifest.origin !== expectedOrigin) {
    throw new Error(
      `Manifest origin ${manifest.origin} does not match the preview origin ${expectedOrigin}.`,
    );
  }
  if (manifest.pullRequestNumber !== Number(pullRequestNumber)) {
    throw new Error(
      `Manifest PR number ${manifest.pullRequestNumber} does not match namespace pr-${pullRequestNumber}.`,
    );
  }
  return manifest;
}
//
// Tests override MOUNTAIN_PREVIEW_ROOT to a temporary directory.

import { join } from "node:path";

export const prNumberPattern = /^\d+$/u;

export function previewRoot() {
  return (
    process.env.MOUNTAIN_PREVIEW_ROOT ?? "/var/lib/mountain-runners-previews"
  );
}

export function previewOrigin(pullRequestNumber) {
  return `https://pr-${pullRequestNumber}.preview.mountainrunners.cat`;
}

export function previewNamespacePaths(pullRequestNumber) {
  const namespaceRoot = join(
    previewRoot(),
    "namespaces",
    `pr-${pullRequestNumber}`,
  );
  return {
    root: namespaceRoot,
    releasesDirectory: join(namespaceRoot, "releases"),
    incomingDirectory: join(namespaceRoot, "incoming"),
    currentLink: join(namespaceRoot, "current"),
    registryFile: join(namespaceRoot, "releases.json"),
    lockFile: join(namespaceRoot, ".release.lock"),
  };
}
