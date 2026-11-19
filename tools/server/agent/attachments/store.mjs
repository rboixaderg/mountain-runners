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
import { join, relative, resolve, sep } from "node:path";
import {
  attachmentDirectoryName,
  removeAttachmentDirectory,
} from "./destination.mjs";
import { readRegularFileNoFollow } from "./safe-read.mjs";

export const attachmentRetentionMilliseconds = 7 * 24 * 60 * 60 * 1000;
export const attachmentStoreDirectoryName = "attachments";
export const attachmentNamePattern = /^imatge-\d+\.(jpg|png|webp)$/u;
// The state volume is 1 GiB and also holds the SQLite stores, the sessions and
// the identifier salt. A topic keeps at most 20 images and 50 MiB; every topic
// together keeps at most 256 MiB. The oldest image is evicted before a new one
// is refused, so a burst of ordinary albums never fails a turn.
const defaultMaximumTopicAttachments = 20;
const defaultMaximumTopicBytes = 50 * 1024 * 1024;
const defaultMaximumTotalBytes = 256 * 1024 * 1024;
const topicNamePattern = /^topic-[0-9a-f]{16}$/u;
const manifestTemporaryPattern = /^\.manifest-[0-9a-f-]+\.tmp$/u;
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
  const entry = existingEntry(path);
  return entry !== null && entry.isFile() && entry.size <= maximumStoredBytes;
}

/** The entry at `path` without following its final link, or null when missing. */
function existingEntry(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function entryBytes(entry) {
  return Number.isSafeInteger(entry.bytes) && entry.bytes > 0 ? entry.bytes : 0;
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
  maximumTopicAttachments = defaultMaximumTopicAttachments,
  maximumTopicBytes = defaultMaximumTopicBytes,
  maximumTotalBytes = defaultMaximumTotalBytes,
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

  /** Every other topic store with its manifest, for the total quota. */
  function otherTopicManifests(excludedDirectory) {
    const stores = [];
    for (const topic of readdirSync(root, { withFileTypes: true })) {
      if (!topic.isDirectory() || !topicNamePattern.test(topic.name)) {
        continue;
      }
      const directory = join(root, topic.name);
      if (directory === excludedDirectory) {
        continue;
      }
      stores.push({
        directory,
        manifest: readManifest(directory),
        changed: false,
      });
    }
    return stores;
  }

  /**
   * Evict the oldest stored images until the new one fits the topic and total
   * quotas. The topic quota is paid by the topic itself first: a busy topic
   * never removes the images of another one. Only a full total quota reaches
   * the other topics, oldest image first. A file removed here is gone for good:
   * every manifest entry is an image the model has not published yet.
   */
  function evictForQuota(directory, manifest, incomingBytes) {
    if (
      maximumTopicAttachments < 1 ||
      incomingBytes > maximumTopicBytes ||
      incomingBytes > maximumTotalBytes
    ) {
      return false;
    }
    const stores = [
      { directory, manifest, changed: false },
      ...otherTopicManifests(directory),
    ];
    const timeOf = (entry) => {
      const time = Date.parse(entry.addedAt);
      return Number.isNaN(time) ? 0 : time;
    };
    const byOldest = (first, second) =>
      timeOf(first.attachment) - timeOf(second.attachment);
    const evicted = [];
    function evict(record) {
      record.store.manifest.attachments =
        record.store.manifest.attachments.filter(
          (entry) => entry !== record.attachment,
        );
      record.store.changed = true;
      evicted.push({
        directory: record.store.directory,
        name: record.attachment.name,
      });
      return entryBytes(record.attachment);
    }

    let topicAttachments = manifest.attachments.length;
    let topicBytes = manifest.attachments.reduce(
      (sum, entry) => sum + entryBytes(entry),
      0,
    );
    const topicFits = () =>
      topicAttachments + 1 <= maximumTopicAttachments &&
      topicBytes + incomingBytes <= maximumTopicBytes;

    // The topic pays its own quota first.
    const topicRecords = manifest.attachments
      .map((attachment) => ({ store: stores[0], attachment }))
      .sort(byOldest);
    for (const record of topicRecords) {
      if (topicFits()) {
        break;
      }
      topicBytes -= evict(record);
      topicAttachments -= 1;
    }

    // Only a full total quota reaches the other topics.
    const remaining = [];
    for (const store of stores) {
      for (const attachment of store.manifest.attachments) {
        remaining.push({ store, attachment });
      }
    }
    remaining.sort(byOldest);
    let totalBytes = remaining.reduce(
      (sum, record) => sum + entryBytes(record.attachment),
      0,
    );
    for (const record of remaining) {
      if (totalBytes + incomingBytes <= maximumTotalBytes) {
        break;
      }
      totalBytes -= evict(record);
    }

    for (const entry of evicted) {
      removeFile(entry.directory, entry.name);
    }
    for (const store of stores) {
      if (!store.changed || store.directory === directory) {
        continue;
      }
      if (store.manifest.attachments.length === 0) {
        rmSync(store.directory, { recursive: true, force: true });
        continue;
      }
      writeManifest(store.directory, store.manifest);
    }
    const storedTopicBytes = manifest.attachments.reduce(
      (sum, entry) => sum + entryBytes(entry),
      0,
    );
    return (
      manifest.attachments.length + 1 <= maximumTopicAttachments &&
      storedTopicBytes + incomingBytes <= maximumTopicBytes &&
      totalBytes + incomingBytes <= maximumTotalBytes
    );
  }

  function add(topicName, image) {
    const directory = topicDirectory(topicName);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest = readManifest(directory);
    if (!evictForQuota(directory, manifest, image.bytes.length)) {
      throw new Error(
        `The attachment store of the topic is out of quota for ${image.bytes.length} bytes.`,
      );
    }
    let counter = manifest.counter;
    let name;
    do {
      counter += 1;
      name = `imatge-${counter}${image.extension}`;
    } while (existingEntry(join(directory, name)) !== null);
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
    const manifest =
      existingEntry(directory) === null
        ? emptyManifest()
        : readManifest(directory);
    const requested = new Set(names);
    if (requested.size === 0) {
      return [];
    }
    const removed = manifest.attachments
      .filter((entry) => requested.has(entry.name))
      .map((entry) => entry.name);
    if (removed.length === 0) {
      return [];
    }
    for (const name of removed) {
      removeFile(directory, name);
    }
    manifest.attachments = manifest.attachments.filter(
      (entry) => !requested.has(entry.name),
    );
    writeManifest(directory, manifest);
    return removed;
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
      if (bytes === null) {
        continue;
      }
      const key = digest(bytes);
      const names = digests.get(key) ?? [];
      names.push(entry.name);
      digests.set(key, names);
    }
    const worktree = resolve(worktreePath);
    const found = new Set();
    for (const path of changedPaths) {
      const target = resolve(worktree, path);
      if (!target.startsWith(`${worktree}${sep}`)) {
        continue;
      }
      // Normalise before comparing: `./.agent-attachments/x` names the ignored
      // directory as surely as `.agent-attachments/x` does.
      const relativePath = relative(worktree, target);
      if (
        relativePath === attachmentDirectoryName ||
        relativePath.startsWith(`${attachmentDirectoryName}${sep}`)
      ) {
        continue;
      }
      const bytes = readRegularFileNoFollow(target, maximumStoredBytes);
      if (bytes === null) {
        continue;
      }
      for (const name of digests.get(digest(bytes)) ?? []) {
        found.add(name);
      }
    }
    return [...found];
  }

  /**
   * Remove the images that stayed unused for the retention period, the files a
   * topic directory keeps without a manifest entry and the temporary manifests
   * an interrupted write left behind. Called at service start and periodically.
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
      if (kept.length === 0) {
        rmSync(directory, { recursive: true, force: true });
        continue;
      }
      manifest.attachments = kept;
      writeManifest(directory, manifest);
      removed.push(...removeOrphans(directory, kept, topic.name));
    }
    for (const entry of removed) {
      logger("attachment_pruned", entry.name);
    }
    return removed;
  }

  /** Files no manifest entry names, plus the temporary manifests of a crash. */
  function removeOrphans(directory, kept, topicName) {
    const names = new Set(kept.map((entry) => entry.name));
    const removed = [];
    for (const name of readdirSync(directory)) {
      if (name === "manifest.json" || names.has(name)) {
        continue;
      }
      const temporary = manifestTemporaryPattern.test(name);
      if (!temporary && !attachmentNamePattern.test(name)) {
        continue;
      }
      try {
        unlinkSync(join(directory, name));
      } catch {
        continue;
      }
      if (!temporary) {
        removed.push({ topic: topicName, name });
      }
    }
    return removed;
  }

  return { add, list, remove, stage, used, prune, root };
}
