// Durable per-topic attachment store (T8.8).
//
// A received image stays available to its topic until the model copies it into
// a content path (it is then published) or for seven days. It lives in the
// private state directory, outside the Git-tracked worktree, under the opaque
// name of the topic. Each stored image has a short stable name (`imatge-1.jpg`)
// that the prompt and the `view_attachment` tool use.
//
// The worktree still receives a copy while the model works, inside the ignored
// `.agent-attachments/` directory, because the sandbox only mounts the worktree.
// The service removes that copy before the checks and the commit, so it never
// reaches a branch or a publication. A stored file is opened as a regular file
// without following symbolic links; the model can change the worktree, not the
// state directory.

import {
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import {
  attachmentDirectoryName,
  removeAttachmentDirectory,
} from "./destination.mjs";
import { readRegularFileNoFollow } from "./safe-read.mjs";

export const attachmentRetentionMilliseconds = 7 * 24 * 60 * 60 * 1000;
export const attachmentStoreDirectoryName = "attachments";
export const attachmentNamePattern = /^imatge-\d+\.(jpg|png|webp)$/u;
const topicNamePattern = /^topic-[0-9a-f]{16}$/u;
const maximumStoredBytes = 20 * 1024 * 1024;

function assertTopicName(topicName) {
  if (typeof topicName !== "string" || !topicNamePattern.test(topicName)) {
    throw new Error("The topic attachment name is not an opaque topic name.");
  }
  return topicName;
}

function emptyManifest() {
  return { counter: 0, attachments: [] };
}

function readManifest(directory) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
    if (
      !Number.isSafeInteger(manifest?.counter) ||
      manifest.counter < 0 ||
      !Array.isArray(manifest.attachments)
    ) {
      return emptyManifest();
    }
    return manifest;
  } catch {
    return emptyManifest();
  }
}

function writeManifest(directory, manifest) {
  const temporary = join(directory, `.manifest-${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, join(directory, "manifest.json"));
}

function removeFile(directory, name) {
  if (typeof name !== "string" || !attachmentNamePattern.test(name)) {
    return false;
  }
  try {
    unlinkSync(join(directory, name));
    return true;
  } catch {
    return false;
  }
}

function regularFile(path) {
  try {
    const stats = lstatSync(path);
    return stats.isFile() && stats.size <= maximumStoredBytes;
  } catch {
    return false;
  }
}

/** The image bytes of a stored attachment, or null when it cannot be read. */
export function readStoredAttachment({ directory, name }) {
  if (!attachmentNamePattern.test(name)) {
    return null;
  }
  return readRegularFileNoFollow(join(directory, name), maximumStoredBytes);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createAttachmentStore({
  stateDirectory,
  now = () => new Date(),
  retentionMilliseconds = attachmentRetentionMilliseconds,
}) {
  const root = join(stateDirectory, attachmentStoreDirectoryName);
  mkdirSync(root, { recursive: true, mode: 0o700 });

  function topicDirectory(topicName) {
    return join(root, assertTopicName(topicName));
  }

  function list(topicName) {
    const directory = topicDirectory(topicName);
    const manifest = readManifest(directory);
    return manifest.attachments.filter((entry) =>
      regularFile(join(directory, entry.name)),
    );
  }

  function add(topicName, image) {
    const directory = topicDirectory(topicName);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest = readManifest(directory);
    let counter = manifest.counter;
    let name;
    do {
      counter += 1;
      name = `imatge-${counter}${image.extension}`;
    } while (regularFile(join(directory, name)));
    const target = join(directory, name);
    const descriptor = openSync(target, "wx", 0o600);
    try {
      fchmodSync(descriptor, 0o600);
      writeFileSync(descriptor, image.bytes);
    } finally {
      closeSync(descriptor);
    }
    const entry = {
      name,
      type: image.type,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      bytes: image.bytes.length,
      origin: image.origin,
      addedAt: now().toISOString(),
    };
    manifest.counter = counter;
    manifest.attachments.push(entry);
    writeManifest(directory, manifest);
    return entry;
  }

  function remove(topicName, names) {
    const directory = topicDirectory(topicName);
    const manifest = readManifest(directory);
    const removed = new Set(names);
    if (removed.size === 0) {
      return [];
    }
    for (const name of removed) {
      removeFile(directory, name);
    }
    manifest.attachments = manifest.attachments.filter(
      (entry) => !removed.has(entry.name),
    );
    writeManifest(directory, manifest);
    return [...removed];
  }

  // Copy every stored image into the worktree for one turn. The directory is
  // recreated from the store, so a file the model added there never survives
  // into the next turn and the stable names always match the prompt.
  function stage(topicName, worktreePath) {
    const directory = topicDirectory(topicName);
    const manifest = readManifest(directory);
    removeAttachmentDirectory({ worktreePath });
    const target = join(worktreePath, attachmentDirectoryName);
    mkdirSync(target, { mode: 0o755 });
    const staged = [];
    for (const entry of manifest.attachments) {
      const bytes = readStoredAttachment({ directory, name: entry.name });
      if (bytes === null) {
        continue;
      }
      const descriptor = openSync(join(target, entry.name), "wx", 0o644);
      try {
        fchmodSync(descriptor, 0o644);
        writeFileSync(descriptor, bytes);
      } finally {
        closeSync(descriptor);
      }
      staged.push({
        ...entry,
        relativePath: `${attachmentDirectoryName}/${entry.name}`,
      });
    }
    return staged;
  }

  function bytesOf(topicName, name) {
    return readStoredAttachment({ directory: topicDirectory(topicName), name });
  }

  /**
   * Which stored images the model copied out of the attachment directory. The
   * worktree is untrusted: only a regular file inside it is read, never a
   * symbolic link, and only up to the attachment size.
   */
  function used(topicName, worktreePath, changedPaths) {
    const entries = list(topicName);
    if (entries.length === 0) {
      return [];
    }
    const digests = new Map();
    for (const entry of entries) {
      const bytes = bytesOf(topicName, entry.name);
      if (bytes !== null) {
        digests.set(digest(bytes), entry.name);
      }
    }
    const worktree = resolve(worktreePath);
    const found = new Set();
    for (const path of changedPaths) {
      const target = resolve(worktree, path);
      if (!target.startsWith(`${worktree}${sep}`)) {
        continue;
      }
      if (
        path === attachmentDirectoryName ||
        path.startsWith(`${attachmentDirectoryName}${sep}`)
      ) {
        continue;
      }
      const bytes = readRegularFileNoFollow(target, maximumStoredBytes);
      if (bytes === null) {
        continue;
      }
      const name = digests.get(digest(bytes));
      if (name !== undefined) {
        found.add(name);
      }
    }
    return [...found];
  }

  /**
   * Remove the images that stayed unused for the retention period. Missing
   * files are dropped from the manifest too. Called at service start.
   */
  function prune({ logger = () => {} } = {}) {
    const removed = [];
    const threshold = now().getTime() - retentionMilliseconds;
    let topics;
    try {
      topics = readdirSync(root, { withFileTypes: true });
    } catch {
      return removed;
    }
    for (const topic of topics) {
      if (!topic.isDirectory() || !topicNamePattern.test(topic.name)) {
        continue;
      }
      const directory = join(root, topic.name);
      const manifest = readManifest(directory);
      const kept = [];
      for (const entry of manifest.attachments) {
        const addedAt = Date.parse(entry.addedAt);
        const expired = Number.isNaN(addedAt) || addedAt < threshold;
        if (expired || !regularFile(join(directory, entry.name))) {
          removeFile(directory, entry.name);
          removed.push({ topic: topic.name, name: entry.name });
          continue;
        }
        kept.push(entry);
      }
      manifest.attachments = kept;
      writeManifest(directory, manifest);
      if (kept.length === 0) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
    for (const entry of removed) {
      logger("attachment_pruned", entry.name);
    }
    return removed;
  }

  return { add, list, remove, stage, used, prune, root };
}
