import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readRegularFileNoFollow } from "./safe-read.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-safe-read-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("reads a regular file within the bound", (context) => {
  const directory = fixture(context);
  const path = join(directory, "image.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  writeFileSync(path, bytes);

  assert.deepEqual(readRegularFileNoFollow(path, bytes.length), bytes);
});

test("returns null for a file above the bound", (context) => {
  const directory = fixture(context);
  const path = join(directory, "image.png");
  writeFileSync(path, Buffer.alloc(64, 1));

  assert.equal(readRegularFileNoFollow(path, 63), null);
});

test("returns null for a symbolic link", (context) => {
  const directory = fixture(context);
  const target = join(directory, "outside.png");
  writeFileSync(target, Buffer.from([1, 2, 3]));
  const link = join(directory, "image.png");
  symlinkSync(target, link);

  assert.equal(readRegularFileNoFollow(link, 1024), null);
});

test(
  "returns null for a FIFO without waiting for a writer",
  { skip: process.platform === "win32", timeout: 5000 },
  (context) => {
    const directory = fixture(context);
    const path = join(directory, "pipe");
    execFileSync("mkfifo", [path]);

    assert.equal(readRegularFileNoFollow(path, 1024), null);
  },
);
