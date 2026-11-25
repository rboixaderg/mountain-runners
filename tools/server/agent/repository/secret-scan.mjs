// Inspect the immutable Git history that would be published, not mutable files.
// Every new object is inspected, including earlier file versions and commit
// messages. An inspection error or exhausted budget refuses publication.

import { namedPaths } from "../policy/development.mjs";
import { gitlinkMode, runGit } from "./trusted-git.mjs";

const maximumObjectBytes = 2 * 1024 * 1024;
const maximumTotalBytes = 32 * 1024 * 1024;

/** A rule that refuses publication. The service writes its message, which names
 * no secret and is safe for the note of the topic. */
export class PublicationRuleError extends Error {}

function isProtectedPath(path) {
  const normalized = path.toLowerCase();
  return (
    normalized === ".github" ||
    normalized.startsWith(".github/") ||
    normalized.split("/").at(-1) === "codeowners"
  );
}

// A received attachment is never published, whatever the branch's .gitignore
// says: the directory is removed before the commit and its history is refused.
function isAttachmentPath(path) {
  const normalized = path.toLowerCase();
  return (
    normalized === ".agent-attachments" ||
    normalized.startsWith(".agent-attachments/")
  );
}

// A raw header starts with one colon per parent, then lists every mode.
function touchesGitlink(header) {
  return header.replace(/^:+/u, "").split(" ").includes(gitlinkMode);
}

export async function assertPublishableHistory({
  worktree,
  commit,
  secrets,
  signal,
}) {
  const range = `origin/main..${commit}`;
  const commits = await runGit(worktree, ["rev-list", range], { signal });
  if (commits === "") {
    return;
  }

  // Use the combined diff of a merge, so only paths whose merge result differs
  // from every parent are listed. A path taken unchanged from a parent is
  // already covered by that parent, which is either in origin/main or in this
  // range. Rename detection stays disabled: both the source and destination of
  // a move must be checked, even for transient changes. Each raw record is a
  // header with the modes, objects and status, followed by its path.
  const records = (
    await runGit(
      worktree,
      [
        "diff-tree",
        "--stdin",
        "--root",
        "-c",
        "-r",
        "--no-commit-id",
        "--raw",
        "--no-renames",
        "-z",
      ],
      { input: commits, signal },
    )
  ).split("\0");
  const headers = records.filter((record, index) => index % 2 === 0);
  const changed = records.filter((record, index) => index % 2 === 1);
  const gitlinkPaths = changed.filter((path, index) =>
    touchesGitlink(headers[index]),
  );
  if (gitlinkPaths.length > 0) {
    throw new PublicationRuleError(
      `Publication contains a nested repository or submodule: ${namedPaths(gitlinkPaths)}.`,
    );
  }
  const attachmentPaths = changed.filter(isAttachmentPath);
  if (attachmentPaths.length > 0) {
    throw new PublicationRuleError(
      `Publication contains an attachment directory path: ${namedPaths(attachmentPaths)}.`,
    );
  }
  const protectedPaths = changed.filter(isProtectedPath);
  if (protectedPaths.length > 0) {
    throw new PublicationRuleError(
      `Publication changes a protected GitHub or CODEOWNERS path: ${namedPaths(protectedPaths)}.`,
    );
  }

  const objects = await runGit(
    worktree,
    ["rev-list", "--objects", "--no-object-names", range],
    { signal },
  );
  const metadata = await runGit(
    worktree,
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { input: objects, signal },
  );
  const candidates = secrets
    .filter((secret) => typeof secret === "string" && secret.length > 0)
    .map((secret) => Buffer.from(secret));
  let inspectedBytes = 0;
  for (const line of metadata.trim().split("\n")) {
    const [identifier, type, rawSize] = line.split(" ");
    const size = Number(rawSize);
    if (
      !["blob", "tree", "commit"].includes(type) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > maximumObjectBytes ||
      inspectedBytes + size > maximumTotalBytes
    ) {
      throw new PublicationRuleError(
        "Publication history exceeds the inspection budget or cannot be inspected.",
      );
    }
    const content = await runGit(worktree, ["cat-file", type, identifier], {
      encoding: "buffer",
      maxBuffer: maximumObjectBytes + 1,
      signal,
    });
    inspectedBytes += size;
    if (candidates.some((secret) => content.includes(secret))) {
      throw new PublicationRuleError(
        "Publication history contains a live credential and cannot be published.",
      );
    }
  }
}
