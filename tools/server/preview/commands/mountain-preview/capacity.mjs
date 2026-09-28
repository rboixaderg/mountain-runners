import { lstat, open, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { previewRoot } from "../../config.mjs";

const capacity = 5;
const namespacesDirectory = () => join(previewRoot(), "namespaces");

export async function withPreviewCapacity(operation) {
  const lockPath = join(namespacesDirectory(), ".capacity.lock");
  const deadline = Date.now() + 20_000;
  let lock;
  while (lock === undefined) {
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age;
      try {
        age = Date.now() - (await stat(lockPath)).mtimeMs;
      } catch (statError) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      if (age > 10 * 60_000) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline)
        throw new Error("Preview capacity lock timed out.", { cause: error });
      await sleep(200);
    }
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export async function assertPreviewCapacity(pullRequestNumber) {
  let active = 0;
  for (const entry of await readdir(namespacesDirectory(), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || !/^pr-[1-9]\d*$/u.test(entry.name)) continue;
    try {
      await lstat(join(namespacesDirectory(), entry.name, "current"));
      if (entry.name === `pr-${pullRequestNumber}`) return;
      active += 1;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (active >= capacity)
    throw new Error(`Preview limit of ${capacity} active origins reached.`);
}

export async function assertNamespaceCapacity(pullRequestNumber) {
  const names = (await readdir(namespacesDirectory(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^pr-[1-9]\d*$/u.test(entry.name))
    .map((entry) => entry.name);
  if (!names.includes(`pr-${pullRequestNumber}`) && names.length >= capacity) {
    throw new Error(`Preview limit of ${capacity} namespaces reached.`);
  }
}
