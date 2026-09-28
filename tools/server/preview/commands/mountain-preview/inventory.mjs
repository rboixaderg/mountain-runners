import { readFile, readdir, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { previewNamespacePaths, previewRoot } from "../../config.mjs";

export async function previewInventory() {
  const directory = join(previewRoot(), "namespaces");
  const entries = await readdir(directory, { withFileTypes: true });
  const inventory = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^pr-[1-9]\d*$/u.test(entry.name)) continue;
    const pullNumber = Number(entry.name.slice(3));
    const paths = previewNamespacePaths(pullNumber);
    let target;
    try {
      target = await readlink(paths.currentLink);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (target === undefined) {
      const metadata = await stat(paths.root);
      inventory.push({ pullNumber, updatedAt: metadata.mtime.toISOString() });
      continue;
    }
    let active;
    try {
      const registry = JSON.parse(await readFile(paths.registryFile, "utf8"));
      active = registry.releases?.find(
        (release) => release.status === "active",
      );
    } catch {
      inventory.push({ pullNumber, inconsistent: true });
      continue;
    }
    if (!active || target !== join(paths.releasesDirectory, active.commit)) {
      inventory.push({ pullNumber, inconsistent: true });
      continue;
    }
    inventory.push({
      pullNumber,
      commit: active.commit,
      updatedAt: active.activatedAt,
      authorizedBy: active.authorizedBy,
      authorizedAt: active.authorizedAt,
      expiresAt: active.expiresAt,
    });
  }
  return inventory;
}
