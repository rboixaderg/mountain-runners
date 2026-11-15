import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  attachmentDirectoryName,
  attachmentFileName,
  removeAttachmentDirectory,
  writeAttachmentFile,
} from "./destination.mjs";

function worktree(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-attachment-destination-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return directory;
}

test("normalises the name and appends the canonical extension", () => {
  const cases = [
    ["Portada.PNG", ".png", "portada.png"],
    ["Foto de la cursa 2026.jpeg", ".jpg", "foto-de-la-cursa-2026.jpg"],
    ["../../x.png", ".png", "x.png"],
    ["a/b.png", ".png", "b.png"],
    ["..\\..\\x.webp", ".webp", "x.webp"],
    ["Foto Ñandú.png", ".png", "foto-and.png"],
    ["", ".jpg", "adjunt.jpg"],
    ["..", ".jpg", "adjunt.jpg"],
    [".env", ".png", "adjunt.png"],
    ["---.png", ".png", "adjunt.png"],
  ];

  for (const [fileName, extension, expected] of cases) {
    assert.equal(attachmentFileName({ fileName, extension }), expected);
  }
});

test("keeps the base name within sixty characters", () => {
  const fileName = attachmentFileName({
    fileName: `${"a".repeat(120)}.jpg`,
    extension: ".jpg",
  });

  assert.equal(fileName, `${"a".repeat(60)}.jpg`);
});

test("writes the cleaned file inside the ignored directory", (context) => {
  const directory = worktree(context);
  const bytes = Buffer.from("synthetic-image");

  const written = writeAttachmentFile({
    worktreePath: directory,
    fileName: "portada.png",
    bytes,
  });

  assert.equal(written.relativePath, ".agent-attachments/portada.png");
  const destination = join(directory, ".agent-attachments", "portada.png");
  assert.deepEqual(readFileSync(destination), bytes);
  const mode = statSync(destination).mode & 0o777;
  assert.equal(mode & 0o600, 0o600);
  assert.equal(mode & 0o111, 0);
});

test("refuses to overwrite an existing attachment", (context) => {
  const directory = worktree(context);
  const first = writeAttachmentFile({
    worktreePath: directory,
    fileName: "portada.png",
    bytes: Buffer.from("first"),
  });
  assert.equal(first.relativePath, ".agent-attachments/portada.png");

  const second = writeAttachmentFile({
    worktreePath: directory,
    fileName: "portada.png",
    bytes: Buffer.from("second"),
  });

  assert.equal(second.refusal.reason, "destination_exists");
  assert.equal(second.refusal.path, ".agent-attachments/portada.png");
  assert.deepEqual(
    readFileSync(join(directory, ".agent-attachments", "portada.png")),
    Buffer.from("first"),
  );
});

test("refuses a symbolic link where the attachment directory belongs", (context) => {
  const directory = worktree(context);
  const target = worktree(context);
  symlinkSync(target, join(directory, attachmentDirectoryName));

  const written = writeAttachmentFile({
    worktreePath: directory,
    fileName: "portada.png",
    bytes: Buffer.from("synthetic-image"),
  });

  assert.equal(written.refusal.reason, "destination_unavailable");
  assert.equal(existsSync(join(target, "portada.png")), false);
});

test("refuses a file where the attachment directory belongs", (context) => {
  const directory = worktree(context);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, attachmentDirectoryName), "not a directory");

  const written = writeAttachmentFile({
    worktreePath: directory,
    fileName: "portada.png",
    bytes: Buffer.from("synthetic-image"),
  });

  assert.equal(written.refusal.reason, "destination_unavailable");
});

test("refuses a worktree that does not exist", (context) => {
  const directory = join(worktree(context), "missing");

  const written = writeAttachmentFile({
    worktreePath: directory,
    fileName: "portada.png",
    bytes: Buffer.from("synthetic-image"),
  });

  assert.equal(written.refusal.reason, "destination_unavailable");
});

test("writes the attachment with mode 0644 under a restrictive umask", (context) => {
  const directory = worktree(context);
  const moduleUrl = new URL("./destination.mjs", import.meta.url).href;
  const script = [
    `import { writeAttachmentFile } from ${JSON.stringify(moduleUrl)};`,
    'import { statSync } from "node:fs";',
    "process.umask(0o077);",
    "const written = writeAttachmentFile({",
    "  worktreePath: process.env.MR_TEST_WORKTREE,",
    '  fileName: "portada.png",',
    '  bytes: Buffer.from("synthetic-image"),',
    "});",
    "const destination = `${process.env.MR_TEST_WORKTREE}/${written.relativePath}`;",
    "process.stdout.write(`${statSync(destination).mode & 0o777} ${written.relativePath}`);",
  ].join("\n");
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
      env: { ...process.env, MR_TEST_WORKTREE: directory },
    },
  );

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, `${0o644} .agent-attachments/portada.png`);
});

test("removes the attachment directory before the commit", (context) => {
  const directory = worktree(context);
  writeAttachmentFile({
    worktreePath: directory,
    fileName: "portada.png",
    bytes: Buffer.from("synthetic-image"),
  });

  removeAttachmentDirectory({ worktreePath: directory });

  assert.equal(existsSync(join(directory, attachmentDirectoryName)), false);
  removeAttachmentDirectory({ worktreePath: directory });
});

test("removes a symbolic link as a link without touching its target", (context) => {
  const directory = worktree(context);
  const target = worktree(context);
  writeFileSync(join(target, "kept.png"), "synthetic-image");
  symlinkSync(target, join(directory, attachmentDirectoryName));

  removeAttachmentDirectory({ worktreePath: directory });

  assert.equal(existsSync(join(directory, attachmentDirectoryName)), false);
  assert.equal(existsSync(join(target, "kept.png")), true);
  assert.equal(existsSync(target), true);
});
