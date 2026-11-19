import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attachmentDirectoryName } from "./destination.mjs";
import {
  attachmentRetentionMilliseconds,
  createAttachmentStore,
} from "./store.mjs";

const topicName = "topic-0123456789abcdef";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-attachment-store-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return {
    stateDirectory: join(directory, "state"),
    worktreePath: join(directory, "worktree"),
  };
}

function image(name, overrides = {}) {
  return {
    type: "jpeg",
    mimeType: "image/jpeg",
    extension: ".jpg",
    width: 1200,
    height: 800,
    bytes: Buffer.from(name),
    origin: "message",
    ...overrides,
  };
}

test("stores images under short stable names and lists them", (context) => {
  const paths = fixture(context);
  const store = createAttachmentStore(paths);

  const first = store.add(topicName, image("first"));
  const second = store.add(
    topicName,
    image("second", { type: "png", mimeType: "image/png", extension: ".png" }),
  );

  assert.equal(first.name, "imatge-1.jpg");
  assert.equal(second.name, "imatge-2.png");
  assert.deepEqual(
    store.list(topicName).map((entry) => entry.name),
    ["imatge-1.jpg", "imatge-2.png"],
  );
});

test("skips an existing name when the counter points at it", (context) => {
  const paths = fixture(context);
  const store = createAttachmentStore(paths);
  const directory = join(store.root, topicName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "imatge-1.jpg"), "leftover");

  const entry = store.add(topicName, image("first"));

  assert.equal(entry.name, "imatge-2.jpg");
  assert.deepEqual(
    store.list(topicName).map((stored) => stored.name),
    ["imatge-2.jpg"],
  );
});

test("starts from an empty manifest when it is corrupt", (context) => {
  const paths = fixture(context);
  const store = createAttachmentStore(paths);
  const directory = join(store.root, topicName);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "manifest.json"), "not json");

  assert.deepEqual(store.list(topicName), []);
  const entry = store.add(topicName, image("first"));
  assert.equal(entry.name, "imatge-1.jpg");
});

test("stages the stored images in the worktree so the sandbox can read them", (context) => {
  const paths = fixture(context);
  mkdirSync(paths.worktreePath);
  const store = createAttachmentStore(paths);
  store.add(topicName, image("first"));

  const staged = store.stage(topicName, paths.worktreePath);
  const directory = join(paths.worktreePath, attachmentDirectoryName);

  assert.deepEqual(
    staged.map((entry) => entry.relativePath),
    [".agent-attachments/imatge-1.jpg"],
  );
  assert.deepEqual(
    readFileSync(join(directory, "imatge-1.jpg")),
    image("first").bytes,
  );

  // The model can add files there; the next turn recreates the directory from
  // the store, so only the stored images are listed.
  writeFileSync(join(directory, "model-created.jpg"), "x");
  const next = store.stage(topicName, paths.worktreePath);
  assert.equal(existsSync(join(directory, "model-created.jpg")), false);
  assert.equal(next.length, 1);
});

test("finds the images the model copied into a content path", (context) => {
  const paths = fixture(context);
  mkdirSync(join(paths.worktreePath, "apps/web/public/images"), {
    recursive: true,
  });
  const store = createAttachmentStore(paths);
  store.add(topicName, image("first"));
  store.add(topicName, image("second"));
  copyFileSync(
    join(store.root, topicName, "imatge-1.jpg"),
    join(paths.worktreePath, "apps/web/public/images/portada.jpg"),
  );

  const used = store.used(topicName, paths.worktreePath, [
    "apps/web/public/images/portada.jpg",
    `${attachmentDirectoryName}/imatge-2.jpg`,
  ]);

  assert.deepEqual(used, ["imatge-1.jpg"]);
});

test("removes a used image from the store", (context) => {
  const paths = fixture(context);
  const store = createAttachmentStore(paths);
  store.add(topicName, image("first"));
  store.add(topicName, image("second"));

  store.remove(topicName, ["imatge-1.jpg"]);

  assert.deepEqual(
    store.list(topicName).map((entry) => entry.name),
    ["imatge-2.jpg"],
  );
});

test("keeps an attachment for seven days and prunes it after", (context) => {
  const paths = fixture(context);
  let now = new Date("2026-01-01T00:00:00.000Z");
  const store = createAttachmentStore({ ...paths, now: () => now });
  store.add(topicName, image("first"));

  now = new Date(now.getTime() + attachmentRetentionMilliseconds - 1000);
  assert.deepEqual(store.prune(), []);
  assert.equal(store.list(topicName).length, 1);

  now = new Date(now.getTime() + 2000);
  assert.equal(store.prune().length, 1);
  assert.deepEqual(store.list(topicName), []);
  assert.equal(existsSync(join(store.root, topicName)), false);
});
