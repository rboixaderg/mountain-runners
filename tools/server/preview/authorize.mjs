import {
  loadRegistry,
  saveRegistry,
  withRegistryLock,
} from "../release/registry.mjs";

export function authorizePreview(commit, actor, pullRequestNumber) {
  if (!/^[A-Za-z0-9-]{1,39}$/u.test(actor)) {
    throw new Error("Invalid GitHub actor for preview authorization.");
  }
  return withRegistryLock(() => {
    const registry = loadRegistry();
    const release = registry.releases.find((entry) => entry.commit === commit);
    if (!release || release.status === "revoked") {
      throw new Error("The preview release is not eligible for authorization.");
    }
    const authorizedAt = new Date();
    release.pullRequestNumber = Number(pullRequestNumber);
    release.authorizedBy = actor;
    release.authorizedAt = authorizedAt.toISOString();
    release.expiresAt = new Date(
      authorizedAt.getTime() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    if (release.status === "active") release.activatedAt = release.authorizedAt;
    saveRegistry(registry);
    return `Authorized preview ${pullRequestNumber} at ${commit}.`;
  });
}

if (process.argv[1]?.endsWith("/authorize.mjs")) {
  const [, , commit, actor, pullRequestNumber] = process.argv;
  authorizePreview(commit, actor, pullRequestNumber)
    .then(console.log)
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
