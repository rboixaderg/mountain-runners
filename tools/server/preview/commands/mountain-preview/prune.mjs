import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { releasePaths } from "../../../release/config.mjs";
import {
  loadRegistry,
  saveRegistry,
  withRegistryLock,
} from "../../../release/registry.mjs";

export async function prunePreview() {
  return withRegistryLock(async () => {
    const registry = loadRegistry();
    const active = registry.releases.filter(
      (release) => release.status === "active",
    );
    if (active.length !== 1)
      throw new Error(
        "A preview must have exactly one active release to prune.",
      );
    const paths = releasePaths();
    for (const entry of registry.releases) {
      if (entry.status !== "active") {
        await rm(join(paths.releasesDirectory, entry.commit), {
          recursive: true,
          force: true,
        });
      }
    }
    registry.releases = active;
    saveRegistry(registry);
    for (const entry of await readdir(paths.incomingDirectory)) {
      await rm(join(paths.incomingDirectory, entry), {
        recursive: true,
        force: true,
      });
    }
    return "Pruned inactive preview releases and uploads.";
  });
}
