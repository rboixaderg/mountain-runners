// Inspect the immutable Git history that would be published, not mutable files.
// Every new object is inspected, including earlier file versions and commit
// messages. An inspection error or exhausted budget refuses publication.

import { runGit } from "./trusted-git.mjs";

const maximumObjectBytes = 2 * 1024 * 1024;
const maximumTotalBytes = 32 * 1024 * 1024;

function isProtectedPath(path) {
  const normalized = path.toLowerCase();
  return (
    normalized === ".github" ||
    normalized.startsWith(".github/") ||
    normalized.split("/").at(-1) === "codeowners"
  );
}

export async function assertPublishableHistory({ worktree, commit, secrets }) {
  const range = `origin/main..${commit}`;
  const commits = await runGit(worktree, ["rev-list", range]);
  if (commits === "") {
    return;
  }

  // Separate merge-parent diffs and disable rename detection: both the source
  // and destination of a move must be checked, even for transient changes.
  const changedPaths = await runGit(
    worktree,
    [
      "diff-tree",
      "--stdin",
      "--root",
      "-m",
      "-r",
      "--no-commit-id",
      "--name-only",
      "--no-renames",
      "-z",
    ],
    { input: commits },
  );
  if (changedPaths.split("\0").some(isProtectedPath)) {
    throw new Error(
      "Publication changes a protected GitHub or CODEOWNERS path.",
    );
  }

  const objects = await runGit(worktree, [
    "rev-list",
    "--objects",
    "--no-object-names",
    range,
  ]);
  const metadata = await runGit(
    worktree,
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { input: objects },
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
      throw new Error(
        "Publication history exceeds the inspection budget or cannot be inspected.",
      );
    }
    const content = await runGit(worktree, ["cat-file", type, identifier], {
      encoding: "buffer",
      maxBuffer: maximumObjectBytes + 1,
    });
    inspectedBytes += size;
    if (candidates.some((secret) => content.includes(secret))) {
      throw new Error(
        "Publication history contains a live credential and cannot be published.",
      );
    }
  }
}
