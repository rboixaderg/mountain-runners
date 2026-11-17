// Local Git lifecycle. The sandbox sees source files but never the clone's
// metadata. A worktree context carries its trusted registry entry explicitly.
// A clean worktree is reusable only after its publication was acknowledged.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  GitInterruptedError,
  primaryRepository,
  registeredWorktree,
  remoteGitTimeoutMilliseconds,
  runGit,
} from "./trusted-git.mjs";

const protectedBranches = new Set(["main", "master"]);
const branchPattern =
  /^(feat|fix|docs|refactor|test|build|ci|chore|security)\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const fullCommitPattern = /^[a-f0-9]{40}$/u;
// The session identifier of a topic, never an archived `<name>-before-<update>`.
const topicWorktreePattern = /^topic_[0-9n]+_\d+$/u;

// Why a branch that another topic published was not released. The caller turns
// each one into the report of the continued instruction: nothing is reset,
// removed or overwritten to resume a branch.
export const workBranchRefusals = {
  dirtyWorktree: "dirty_worktree",
  unpublishedCommits: "unpublished_commits",
  divergedBranch: "diverged_branch",
  movedHead: "moved_head",
};

export function assertWorkBranch(branch) {
  if (typeof branch !== "string" || branch === "") {
    throw new Error("A work branch is required.");
  }
  if (protectedBranches.has(branch)) {
    throw new Error(`The agent never writes to ${branch}.`);
  }
  if (
    !branchPattern.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock")
  ) {
    throw new Error(`Invalid work branch ${branch}.`);
  }
  return branch;
}

async function worktreePaths(repository, { signal } = {}) {
  const output = await runGit(repository, ["worktree", "list", "--porcelain"], {
    signal,
  });
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** Every registered worktree with the branch it holds, or null when detached. */
async function worktreesByBranch(repository, { signal } = {}) {
  const output = await runGit(repository, ["worktree", "list", "--porcelain"], {
    signal,
  });
  const entries = [];
  let entry = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      entry = { path: line.slice("worktree ".length), branch: null };
      entries.push(entry);
      continue;
    }
    if (entry !== null && line.startsWith("branch refs/heads/")) {
      entry.branch = line.slice("branch refs/heads/".length);
    }
  }
  return entries;
}

export async function ensureSessionWorktree({
  repositoryPath,
  worktreeRoot,
  name,
  baseBranch = "main",
  newTaskIdentifier,
  signal,
}) {
  if (baseBranch !== "main") {
    throw new Error("The agent only starts work from main.");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid worktree name ${name}.`);
  }
  if (
    newTaskIdentifier !== undefined &&
    (!Number.isSafeInteger(newTaskIdentifier) || newTaskIdentifier < 0)
  ) {
    throw new Error("A new task requires a valid update identifier.");
  }
  mkdirSync(worktreeRoot, { recursive: true });
  const worktreePath = join(realpathSync(worktreeRoot), name);
  const repository = primaryRepository(repositoryPath);
  let existing = (await worktreePaths(repository, { signal })).some(
    (path) => path === worktreePath,
  );

  await runGit(repository, ["fetch", "--prune", "origin", baseBranch], {
    signal,
    timeoutMilliseconds: remoteGitTimeoutMilliseconds,
  });
  if (existing && newTaskIdentifier !== undefined) {
    const previous = registeredWorktree(repositoryPath, worktreePath);
    // Check the untrusted Git marker before moving the registered worktree.
    // Even a clean tree may contain ignored artifacts from a previous task.
    await listChangedPaths(previous, { signal });
    const archivePath = join(
      realpathSync(worktreeRoot),
      `${name}-before-${newTaskIdentifier}`,
    );
    await runGit(repository, ["worktree", "move", worktreePath, archivePath], {
      signal,
    });
    existing = false;
  }
  if (!existing) {
    await runGit(
      repository,
      ["worktree", "add", "--detach", worktreePath, `origin/${baseBranch}`],
      { signal },
    );
  }
  const worktree = registeredWorktree(repositoryPath, worktreePath);
  if (
    existing &&
    (await listChangedPaths(worktree, { signal })).length === 0 &&
    !(await hasUnpublishedCommit(worktree, { signal }))
  ) {
    await runGit(worktree, ["checkout", "--detach", `origin/${baseBranch}`], {
      signal,
    });
  }
  return { ...worktree, reused: existing };
}

/**
 * Resolve the worktree of a session that must already exist. A repair continues
 * an existing branch and never creates, moves or resets a worktree; the caller
 * reports a missing one instead of starting a new task.
 */
export async function findSessionWorktree({
  repositoryPath,
  worktreeRoot,
  name,
  signal,
}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid worktree name ${name}.`);
  }
  if (!existsSync(worktreeRoot)) {
    return null;
  }
  const worktreePath = join(realpathSync(worktreeRoot), name);
  const repository = primaryRepository(repositoryPath);
  const registered = (await worktreePaths(repository, { signal })).some(
    (path) => path === worktreePath,
  );
  if (!registered || !existsSync(worktreePath)) {
    return null;
  }
  return registeredWorktree(repositoryPath, worktreePath);
}

/**
 * Resume a work branch another topic published. Git allows one worktree per
 * branch, so the branch is released from every worktree that holds it, the
 * session worktree is preserved like a new task and the branch is checked out
 * at the pull request head. A branch with unpublished work or with local
 * history outside the remote head is reported instead of reset.
 *
 * @returns {Promise<{worktree: object} | {refusal: string}>}
 */
export async function resumeWorkBranch({
  repositoryPath,
  worktreeRoot,
  name,
  branch,
  headSha,
  newTaskIdentifier,
  signal,
}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid worktree name ${name}.`);
  }
  assertWorkBranch(branch);
  if (typeof headSha !== "string" || !fullCommitPattern.test(headSha)) {
    throw new Error("A full commit SHA is required to resume a work branch.");
  }
  if (!Number.isSafeInteger(newTaskIdentifier) || newTaskIdentifier < 0) {
    throw new Error("A resumed branch requires a valid update identifier.");
  }
  mkdirSync(worktreeRoot, { recursive: true });
  const root = realpathSync(worktreeRoot);
  const worktreePath = join(root, name);
  const repository = primaryRepository(repositoryPath);

  // Every read and validation happens before the first local change.
  await runGit(repository, ["fetch", "--prune", "origin", "main"], {
    signal,
    timeoutMilliseconds: remoteGitTimeoutMilliseconds,
  });
  await runGit(
    repository,
    ["fetch", "--prune", "origin", `refs/heads/${branch}`],
    { signal, timeoutMilliseconds: remoteGitTimeoutMilliseconds },
  );
  const fetched = (
    await runGit(repository, ["rev-parse", "FETCH_HEAD"], { signal })
  ).trim();
  if (fetched !== headSha) {
    return { refusal: workBranchRefusals.movedHead };
  }
  const localBranch = (
    await runGit(
      repository,
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      { allowFailure: true, signal },
    )
  ).trim();
  const holders = [];
  for (const entry of await worktreesByBranch(repository, { signal })) {
    if (entry.branch !== branch || !existsSync(entry.path)) {
      continue;
    }
    const holder = registeredWorktree(repositoryPath, entry.path);
    if ((await listChangedPaths(holder, { signal })).length > 0) {
      return { refusal: workBranchRefusals.dirtyWorktree };
    }
    if (await hasUnpublishedCommit(holder, { signal })) {
      return { refusal: workBranchRefusals.unpublishedCommits };
    }
    holders.push(holder);
  }
  if (localBranch !== "") {
    const mergeBase = (
      await runGit(repository, ["merge-base", localBranch, headSha], {
        allowFailure: true,
        signal,
      })
    ).trim();
    if (mergeBase !== localBranch) {
      return { refusal: workBranchRefusals.divergedBranch };
    }
  }

  // Only the release moves local state: every refusal is already decided.
  for (const holder of holders) {
    await runGit(holder, ["checkout", "--detach"], { signal });
  }

  if ((await worktreePaths(repository, { signal })).includes(worktreePath)) {
    const previous = registeredWorktree(repositoryPath, worktreePath);
    // Check the untrusted Git marker before moving the registered worktree.
    await listChangedPaths(previous, { signal });
    await runGit(
      repository,
      [
        "worktree",
        "move",
        worktreePath,
        join(root, `${name}-before-${newTaskIdentifier}`),
      ],
      { signal },
    );
  }
  await runGit(repository, ["branch", "-f", branch, headSha], { signal });
  await runGit(repository, ["worktree", "add", worktreePath, branch], {
    signal,
  });
  const worktree = registeredWorktree(repositoryPath, worktreePath);
  // The head is published already: an unchanged resume never republishes it.
  recordPublication(worktree, headSha);
  return { worktree };
}

export async function listChangedPaths(worktree, { signal } = {}) {
  const output = await runGit(
    worktree,
    ["status", "--porcelain", "--untracked-files=all", "-z"],
    { signal },
  );
  const entries = output.split("\0");
  const changedPaths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === "") {
      continue;
    }
    changedPaths.push(entry.slice(3));
    // A rename or a copy names its original path next: both sides changed.
    if (entry.startsWith("R") || entry.startsWith("C")) {
      index += 1;
      changedPaths.push(entries[index]);
    }
  }
  return changedPaths;
}

/**
 * The current worktree of every other topic. Archived worktrees keep the name
 * of their topic but end in `-before-<update>`, so they never count as active
 * work.
 */
export async function listOtherTopicWorktrees({
  repositoryPath,
  worktreeRoot,
  excludeName,
  signal,
}) {
  const root = realpathSync(worktreeRoot);
  const worktrees = [];
  const registeredPaths = await worktreePaths(
    primaryRepository(repositoryPath),
    { signal },
  );
  for (const path of registeredPaths) {
    const resolvedPath = realpathSync(path);
    const name = basename(resolvedPath);
    if (
      dirname(resolvedPath) !== root ||
      name === excludeName ||
      !topicWorktreePattern.test(name)
    ) {
      continue;
    }
    worktrees.push({
      name,
      worktree: registeredWorktree(repositoryPath, resolvedPath),
    });
  }
  return worktrees;
}

/**
 * Every path the worktree would publish: committed since `origin/main` and not
 * committed yet. A rename counts on both sides, so an overlap with the old
 * name is visible too.
 */
export async function changedPathsAgainstMain(worktree, { signal } = {}) {
  const committed = await runGit(
    worktree,
    ["diff", "--name-only", "-z", "--no-renames", "origin/main...HEAD"],
    { signal },
  );
  const pending = await listChangedPaths(worktree, { signal });
  return [...new Set([...committed.split("\0").filter(Boolean), ...pending])];
}

export async function currentBranch(worktree, { signal } = {}) {
  const branch = await runGit(
    worktree,
    ["symbolic-ref", "--short", "-q", "HEAD"],
    { allowFailure: true, signal },
  );
  return branch.trim() || null;
}

export async function headCommit(worktree, { signal } = {}) {
  return (await runGit(worktree, ["rev-parse", "HEAD"], { signal })).trim();
}

export async function commitSubject(worktree, commit, { signal } = {}) {
  return (
    await runGit(worktree, ["log", "-1", "--format=%s", commit, "--"], {
      signal,
    })
  ).trim();
}

/**
 * The published change of the worktree against the base branch, for context.
 * A diff larger than the limit is clipped; a diff Git cannot produce at all is
 * reported as unavailable instead of failing the whole repair.
 */
export async function changeDiff({
  worktree,
  baseBranch = "main",
  maximumBytes = 256 * 1024,
  signal,
}) {
  if (baseBranch !== "main") {
    throw new Error("The agent only diffs against main.");
  }
  try {
    const diff = await runGit(
      worktree,
      ["diff", "--no-color", "--no-ext-diff", `origin/${baseBranch}...HEAD`],
      { maxBuffer: maximumBytes, signal },
    );
    return diff.slice(0, maximumBytes);
  } catch (error) {
    // A stopped or killed command is not a diff Git could not produce.
    if (error instanceof GitInterruptedError) {
      throw error;
    }
    // Node keeps the output read before the buffer overflowed.
    if (error.cause?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return error.cause.stdout.slice(0, maximumBytes);
    }
    return null;
  }
}

export async function createBranch({ worktree, branch, signal }) {
  assertWorkBranch(branch);
  await runGit(worktree, ["checkout", "-b", branch], { signal });
  return branch;
}

export async function commitAll({ worktree, message, signal }) {
  await runGit(worktree, ["add", "--all"], { signal });
  const staged = await runGit(
    worktree,
    ["diff", "--cached", "--name-only", "-z"],
    { signal },
  );
  if (staged !== "") {
    await runGit(
      worktree,
      [
        "-c",
        "user.name=Mountain Runners Agent",
        "-c",
        "user.email=agent@mountainrunners.cat",
        "commit",
        "-m",
        message,
      ],
      { signal },
    );
  }
  return (await runGit(worktree, ["rev-parse", "HEAD"], { signal })).trim();
}

export async function hasUnpublishedCommit(worktree, { signal } = {}) {
  if (!(await currentBranch(worktree, { signal }))) {
    return false;
  }
  const commit = (
    await runGit(worktree, ["rev-parse", "HEAD"], { signal })
  ).trim();
  if (publishedCommit(worktree) === commit) {
    return false;
  }
  const count = await runGit(
    worktree,
    ["rev-list", "--count", "origin/main..HEAD"],
    { signal },
  );
  return count.trim() !== "0";
}

/** The commit recorded as published outside the mount, or null. */
export function publishedCommit(worktree) {
  const publicationPath = join(worktree.gitDirectory, "agent-published-head");
  if (!existsSync(publicationPath)) {
    return null;
  }
  return readFileSync(publicationPath, "utf8").trim();
}

export async function committedPaths(worktree, { signal } = {}) {
  const output = await runGit(
    worktree,
    ["diff", "--name-only", "-z", "origin/main...HEAD"],
    { signal },
  );
  return output.split("\0").filter(Boolean);
}

export function recordPublication(worktree, commit) {
  writeFileSync(
    join(worktree.gitDirectory, "agent-published-head"),
    `${commit}\n`,
    { mode: 0o600 },
  );
}
