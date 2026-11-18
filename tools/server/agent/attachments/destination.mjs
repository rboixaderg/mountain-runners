// The ignored attachment directory inside a worktree (T8.4, T8.8).
//
// The durable store lives outside the worktree. Each turn copies the stored
// images here so the sandbox can read them, and the service removes the whole
// directory before the checks and the commit. A symbolic link is removed as a
// link and never followed.

import { lstatSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const attachmentDirectoryName = ".agent-attachments";

/**
 * Remove the worktree's attachment directory before the checks and the commit,
 * so a received image never reaches a commit, a pull request or a publication,
 * even on a branch whose .gitignore predates this rule.
 */
export function removeAttachmentDirectory({ worktreePath }) {
  const directory = join(worktreePath, attachmentDirectoryName);
  let stats;
  try {
    stats = lstatSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stats.isDirectory()) {
    rmSync(directory, { recursive: true, force: true });
    return;
  }
  unlinkSync(directory);
}
