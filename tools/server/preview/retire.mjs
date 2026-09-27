// Atomically unpublish one preview before deleting its releases. The renamed
// directory is no longer reachable at the origin's fixed Caddy document root.
import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { previewNamespacePaths, previewRoot } from "./config.mjs";
import { withPreviewCapacity } from "./capacity.mjs";

export async function retirePreview(pullRequestNumber) {
  return withPreviewCapacity(() => retireLocked(pullRequestNumber));
}

async function retireLocked(pullRequestNumber) {
  const namespace = previewNamespacePaths(pullRequestNumber).root;
  try {
    const metadata = await lstat(namespace);
    if (!metadata.isDirectory()) {
      throw new Error("The preview namespace is not a directory.");
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return `Preview ${pullRequestNumber} is already retired.`;
    }
    throw error;
  }

  const retired = join(
    previewRoot(),
    "namespaces",
    `.retired-pr-${pullRequestNumber}-${randomUUID()}`,
  );
  await rename(namespace, retired);
  await rm(retired, { recursive: true });
  return `Retired preview ${pullRequestNumber}.`;
}

export async function cleanRetiredPreviews() {
  const directory = join(previewRoot(), "namespaces");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      /^\.retired-pr-[1-9]\d*-[0-9a-f-]{36}$/u.test(entry.name)
    ) {
      try {
        await rm(join(directory, entry.name), { recursive: true });
      } catch (error) {
        console.error(`Could not clean ${entry.name}: ${error.message}`);
      }
    }
  }
}
