import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  attachmentDirectoryName,
  removeAttachmentDirectory,
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

test("removes the attachment directory before the commit", (context) => {
  const directory = worktree(context);
  writeFileSync(join(directory, "kept.txt"), "synthetic\n");
  const attachments = join(directory, attachmentDirectoryName);
  symlinkSync(join(directory, "kept.txt"), attachments);

  removeAttachmentDirectory({ worktreePath: directory });

  assert.equal(existsSync(attachments), false);
  assert.equal(existsSync(join(directory, "kept.txt")), true);
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
