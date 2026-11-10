// Refuse to publish a worktree that contains a live credential (T8.3).
//
// The sandbox never receives the Telegram or GitHub token, so a match means a
// leak through another path: a committed `.env`, a copied log or a generated
// artifact. Pushing it would publish the secret to GitHub, so the trusted
// component scans the files Git would publish and stops.

import { readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { runGit } from "./trusted-git.mjs";
const maximumFileBytes = 2 * 1024 * 1024;

export async function assertNoSecretsInWorktree({
  worktree,
  secrets,
  maximumBytes = 32 * 1024 * 1024,
}) {
  const candidates = secrets.filter(
    (secret) => typeof secret === "string" && secret.length >= 8,
  );
  if (candidates.length === 0) {
    return;
  }

  const stdout = await runGit(worktree, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);

  let inspectedBytes = 0;
  for (const relativePath of stdout.split("\0").filter(Boolean)) {
    const absolutePath = join(worktree.path, relativePath);
    let size;
    try {
      const metadata = lstatSync(absolutePath);
      if (!metadata.isFile()) {
        continue;
      }
      size = metadata.size;
    } catch {
      continue;
    }
    if (size > maximumFileBytes || inspectedBytes + size > maximumBytes) {
      continue;
    }
    inspectedBytes += size;

    const content = readFileSync(absolutePath, "utf8");
    for (const secret of candidates) {
      if (content.includes(secret)) {
        throw new Error(
          `The worktree file ${relativePath} contains a live credential and cannot be published.`,
        );
      }
    }
  }
}
