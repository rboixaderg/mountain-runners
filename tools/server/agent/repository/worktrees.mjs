// Local Git lifecycle. The sandbox sees source files but never the clone's
// metadata. A worktree context carries its trusted registry entry explicitly.
// A clean worktree is reusable only after its publication was acknowledged.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  gitlinkMode,
  ignoreSubmodules,
  lstatOrNull,
  primaryRepository,
  registeredWorktree,
  remoteGitTimeoutMilliseconds,
  runGit,
} from "./trusted-git.mjs";

const agentIdentityArguments = [
  "-c",
  "user.name=Mountain Runners Agent",
  "-c",
  "user.email=agent@mountainrunners.cat",
];
const protectedBranches = new Set(["main", "master"]);
const branchPattern =
  /^(feat|fix|docs|refactor|test|build|ci|chore|security)\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const fullCommitPattern = /^[a-f0-9]{40}$/u;
const worktreeNamePattern = /^[a-z0-9][a-z0-9._-]*$/u;
const generatedDependencySegments = [
  ["node_modules"],
  ["apps", "web", "node_modules"],
  ["packages", "telegram-pi-bridge", "node_modules"],
  [".agent-runtime-tmp"],
];

function directSubdirectory(rootPath, segments) {
  const rootStats = lstatOrNull(rootPath);
  if (rootStats === null || !rootStats.isDirectory()) {
    return null;
  }
  let current = rootPath;
  for (const segment of segments) {
    current = join(current, segment);
    const stats = lstatOrNull(current);
    if (stats === null || !stats.isDirectory()) {
      return null;
    }
  }
  return current;
}

/**
 * Remove gitignored generated dependency and runtime cache directories from a
 * worktree without following any symbolic link in any parent or target segment.
 */
export function stripWorktreeDependencies(
  worktreePath,
  { dryRun = false, logger = () => {} } = {},
) {
  const cleaned = [];
  for (const segments of generatedDependencySegments) {
    const target = directSubdirectory(worktreePath, segments);
    if (target === null) {
      continue;
    }
    if (!dryRun) {
      try {
        rmSync(target, { recursive: true, force: true });
      } catch {
        logger("worktree_dependencies_cleanup_failed", target);
        continue;
      }
    }
    cleaned.push(segments.join("/"));
  }
  return cleaned;
}

function assertWorktreeName(name) {
  if (!worktreeNamePattern.test(name)) {
    throw new Error(`Invalid worktree name ${name}.`);
  }
  return name;
}

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

export async function ensureSessionWorktree({
  repositoryPath,
  worktreeRoot,
  name,
  baseBranch = "main",
  signal,
}) {
  if (baseBranch !== "main") {
    throw new Error("The agent only starts work from main.");
  }
  assertWorktreeName(name);
  mkdirSync(worktreeRoot, { recursive: true });
  const worktreePath = join(realpathSync(worktreeRoot), name);
  const repository = primaryRepository(repositoryPath);
  const existing = (await worktreePaths(repository, { signal })).some(
    (path) => path === worktreePath,
  );

  await runGit(repository, ["fetch", "--prune", "origin", baseBranch], {
    signal,
    timeoutMilliseconds: remoteGitTimeoutMilliseconds,
  });
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
 * Resolve the worktree of a session that must already exist. It never creates
 * or resets a worktree; the caller handles a missing one.
 */
export async function findSessionWorktree({
  repositoryPath,
  worktreeRoot,
  name,
  signal,
}) {
  assertWorktreeName(name);
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

export async function listChangedPaths(worktree, { signal } = {}) {
  const output = await runGit(
    worktree,
    ["status", "--porcelain", "--untracked-files=all", "-z", ignoreSubmodules],
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
 * Every path the worktree would publish: committed since `origin/main` and not
 * committed yet. A rename counts on both sides, so an overlap with the old
 * name is visible too.
 */
export async function changedPathsAgainstMain(
  worktree,
  { base = "origin/main", signal } = {},
) {
  const committed = await runGit(
    worktree,
    ["diff", "--name-only", "-z", "--no-renames", `${base}...HEAD`],
    { signal },
  );
  const pending = await listChangedPaths(worktree, { signal });
  return [...new Set([...committed.split("\0").filter(Boolean), ...pending])];
}

/**
 * What a worktree holds outside the index: tracked paths whose content differs
 * from the index and untracked paths Git does not ignore. A merge in progress
 * stages every clean result, so after a conflict only the conflicted paths and
 * the edits of the model remain here.
 */
export async function listWorkingTreeChanges(worktree, { signal } = {}) {
  const split = (output) => output.split("\0").filter(Boolean);
  return {
    modified: split(
      await runGit(
        worktree,
        ["diff", "--name-only", "-z", "--no-renames", ignoreSubmodules],
        { signal },
      ),
    ),
    untracked: split(
      await runGit(
        worktree,
        ["ls-files", "--others", "--exclude-standard", "-z"],
        { signal },
      ),
    ),
  };
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

export async function createBranch({ worktree, branch, signal }) {
  assertWorkBranch(branch);
  await runGit(worktree, ["checkout", "-b", branch], { signal });
  return branch;
}

/**
 * The work holds a nested repository or a submodule. The service never commits
 * one: the worktree stays as it is for a person to inspect.
 */
export class NestedRepositoryError extends Error {
  constructor() {
    super("The worktree contains a nested Git repository.");
    this.name = "NestedRepositoryError";
  }
}

async function indexedGitlinkPaths(worktree, { signal }) {
  const output = await runGit(worktree, ["ls-files", "--stage", "-z"], {
    maxBuffer: 64 * 1024 * 1024,
    signal,
  });
  return output
    .split("\0")
    .filter((entry) => entry.startsWith(`${gitlinkMode} `))
    .map((entry) => entry.slice(entry.indexOf("\t") + 1));
}

/**
 * Stage every change without ever keeping a gitlink in the index. `git add`
 * enters a nested repository the index already records and stages a new one as
 * a gitlink, so the index is checked before the add and unstaged after it.
 */
async function stageAll(worktree, { signal }) {
  if ((await indexedGitlinkPaths(worktree, { signal })).length > 0) {
    throw new NestedRepositoryError();
  }
  await runGit(worktree, ["add", "--all"], { signal });
  // Without the caller's signal: an abort here must not leave a gitlink staged.
  const gitlinkPaths = await indexedGitlinkPaths(worktree, {});
  if (gitlinkPaths.length > 0) {
    await runGit(
      worktree,
      [
        "--literal-pathspecs",
        "reset",
        "--quiet",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
      ],
      { input: gitlinkPaths.join("\0") },
    );
    throw new NestedRepositoryError();
  }
}

export async function commitAll({ worktree, message, signal }) {
  await stageAll(worktree, { signal });
  const staged = await runGit(
    worktree,
    ["diff", "--cached", "--name-only", "-z"],
    { signal },
  );
  if (staged !== "") {
    await runGit(
      worktree,
      [...agentIdentityArguments, "commit", "-m", message],
      { signal },
    );
  }
  return (await runGit(worktree, ["rev-parse", "HEAD"], { signal })).trim();
}

export class MergeCleanupError extends Error {
  constructor(options) {
    super("Could not abort the interrupted merge.", options);
    this.name = "MergeCleanupError";
  }
}

export async function fetchPublishedBranch({
  worktree,
  branch,
  headSha,
  signal,
}) {
  assertWorkBranch(branch);
  if (!fullCommitPattern.test(headSha)) return false;
  await runGit(
    worktree,
    ["fetch", "--no-tags", "origin", `refs/heads/${branch}`],
    {
      signal,
      timeoutMilliseconds: remoteGitTimeoutMilliseconds,
    },
  );
  const fetchedHead = (
    await runGit(worktree, ["rev-parse", "FETCH_HEAD"], { signal })
  ).trim();
  return fetchedHead === headSha;
}

export async function fastForwardPublishedBranch({
  worktree,
  branch,
  headSha,
  signal,
}) {
  assertWorkBranch(branch);
  if (!fullCommitPattern.test(headSha)) return false;
  if (
    (await currentBranch(worktree, { signal })) !== branch ||
    (await listChangedPaths(worktree, { signal })).length > 0 ||
    (await hasUnpublishedCommit(worktree, { signal }))
  ) {
    return false;
  }
  const localHead = await headCommit(worktree, { signal });
  if (!(await fetchPublishedBranch({ worktree, branch, headSha, signal })))
    return false;
  const fetchedHead = headSha;
  const mergeBase = (
    await runGit(worktree, ["merge-base", localHead, fetchedHead], {
      signal,
      allowFailure: true,
    })
  ).trim();
  if (mergeBase !== localHead) return false;
  await runGit(
    worktree,
    ["merge", "--ff-only", "--no-overwrite-ignore", fetchedHead],
    { signal },
  );
  recordPublication(worktree, fetchedHead);
  return true;
}

export async function fetchMainHead({ worktree, signal }) {
  await runGit(worktree, ["fetch", "--prune", "origin", "main"], {
    signal,
    timeoutMilliseconds: remoteGitTimeoutMilliseconds,
  });
  return (
    await runGit(worktree, ["rev-parse", "origin/main"], { signal })
  ).trim();
}

/**
 * Integrate the freshly fetched `origin/main` into a branch that is behind it,
 * without rebase or force-push. A branch that already contains `main` is left
 * untouched: no commit, no merge. Work that is not committed yet is committed
 * first so a conflict or a later failure never loses it. The result carries the
 * verified `mainHead` the merge was made against.
 */
export async function synchronizeWithMain({
  worktree,
  pendingWorkMessage,
  signal,
}) {
  const mainHead = await fetchMainHead({ worktree, signal });
  const mergeBase = (
    await runGit(worktree, ["merge-base", "HEAD", mainHead], {
      allowFailure: true,
      signal,
    })
  ).trim();
  if (mergeBase === mainHead) {
    return { merged: false, mainHead };
  }
  await commitAll({ worktree, message: pendingWorkMessage, signal });
  const merge = await mergeCommitIntoBranch({
    worktree,
    headSha: mainHead,
    signal,
  });
  return { ...merge, mainHead };
}

export async function mergeCommitIntoBranch({ worktree, headSha, signal }) {
  if (!fullCommitPattern.test(headSha))
    throw new Error("A full commit SHA is required.");
  const mergeBase = (
    await runGit(worktree, ["merge-base", "HEAD", headSha], { signal })
  ).trim();
  if (mergeBase === headSha) {
    return { merged: false };
  }
  try {
    await runGit(
      worktree,
      [
        ...agentIdentityArguments,
        "merge",
        "--no-ff",
        "--no-edit",
        "--no-overwrite-ignore",
        headSha,
      ],
      { signal },
    );
    return { merged: true };
  } catch (error) {
    // Cleanup must still run after cancellation: the sandbox cannot safely
    // receive a worktree with an interrupted merge in progress.
    const mergeHead = await runGit(
      worktree,
      ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
      { allowFailure: true },
    );
    if (mergeHead.trim() === headSha) {
      const output = await runGit(worktree, [
        "diff",
        "--name-only",
        "--diff-filter=U",
        "-z",
        ignoreSubmodules,
      ]);
      const paths = output.split("\0").filter(Boolean);
      await abortConflictMerge(worktree);
      signal?.throwIfAborted();
      if (paths.length > 0) {
        return { conflict: true, paths };
      }
    }
    signal?.throwIfAborted();
    throw error;
  }
}

export async function restartConflictMerge({
  worktree,
  headSha,
  expectedPaths,
  signal,
}) {
  if (!fullCommitPattern.test(headSha))
    throw new Error("A full commit SHA is required.");
  try {
    await runGit(
      worktree,
      [
        ...agentIdentityArguments,
        "merge",
        "--no-ff",
        "--no-commit",
        "--no-overwrite-ignore",
        headSha,
      ],
      { signal },
    );
  } catch (error) {
    const mergeHead = await runGit(
      worktree,
      ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
      { allowFailure: true },
    );
    if (mergeHead.trim() !== headSha) {
      throw error;
    }
    const output = await runGit(worktree, [
      "diff",
      "--name-only",
      "--diff-filter=U",
      "-z",
      ignoreSubmodules,
    ]);
    const paths = output.split("\0").filter(Boolean);
    if (
      !signal?.aborted &&
      paths.length === expectedPaths.length &&
      paths.every((path, index) => path === expectedPaths[index])
    ) {
      return true;
    }
    await abortConflictMerge(worktree);
    signal?.throwIfAborted();
    return false;
  }
  // A changed target must not silently choose a different merge.
  await abortConflictMerge(worktree);
  return false;
}

export async function abortConflictMerge(worktree) {
  try {
    await runGit(worktree, ["merge", "--abort"]);
  } catch (error) {
    throw new MergeCleanupError({ cause: error });
  }
}

export async function commitConflictMerge({ worktree, signal }) {
  await stageAll(worktree, { signal });
  const unmerged = await runGit(
    worktree,
    ["diff", "--name-only", "--diff-filter=U", "-z", ignoreSubmodules],
    { signal },
  );
  if (unmerged !== "") {
    return false;
  }
  // Only what the branch adds on top of the incoming commit: what the incoming
  // side brings is not the work of this merge.
  await runGit(worktree, ["diff", "--cached", "--check", "MERGE_HEAD"], {
    signal,
  });
  await runGit(worktree, [...agentIdentityArguments, "commit", "--no-edit"], {
    signal,
  });
  return true;
}

export async function mergeInProgressHead(worktree, { signal } = {}) {
  const mergeHead = await runGit(
    worktree,
    ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
    { allowFailure: true, signal },
  );
  return mergeHead.trim() || null;
}

/**
 * Abort the merge of `main` a stopped process left on top of `commit`. Returns
 * true only when the worktree is then clean at `commit`. Git refuses the abort,
 * or keeps the files, when it holds anything the merge did not bring.
 */
export async function abortInterruptedMainMerge(
  worktree,
  { commit, mergeHead, signal },
) {
  const mainBase = await runGit(
    worktree,
    ["merge-base", mergeHead, "origin/main"],
    { allowFailure: true, signal },
  );
  if (
    mainBase.trim() !== mergeHead ||
    (await headCommit(worktree, { signal })) !== commit
  ) {
    return false;
  }
  try {
    await abortConflictMerge(worktree);
  } catch (error) {
    if (error instanceof MergeCleanupError) return false;
    throw error;
  }
  return (await listChangedPaths(worktree, { signal })).length === 0;
}

/**
 * Whether HEAD only adds merges of `main` on top of `commit`, with a clean
 * worktree: nothing in it is work of the topic, so it can be made again. This
 * assumes only the service creates merge commits on the branch (the sandbox
 * cannot commit) and commits pending edits as ordinary commits before it
 * merges: a conflict resolution is then the only content of a merge commit.
 */
export async function addsOnlyMainMerges(worktree, { commit, signal }) {
  if ((await listChangedPaths(worktree, { signal })).length > 0) {
    return false;
  }
  const mergeBase = await runGit(worktree, ["merge-base", commit, "HEAD"], {
    allowFailure: true,
    signal,
  });
  if (mergeBase.trim() !== commit) {
    return false;
  }
  const ownCommits = await runGit(
    worktree,
    [
      "rev-list",
      "--count",
      "--no-merges",
      "HEAD",
      `^${commit}`,
      "^origin/main",
    ],
    { signal },
  );
  return ownCommits.trim() === "0";
}

/** Drop everything after `commit`, including files Git does not ignore. */
export async function restoreCommit({ worktree, commit }) {
  await runGit(worktree, ["reset", "--hard", commit]);
  await runGit(worktree, ["clean", "-fd"]);
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
  const publicationPath = join(worktree.gitDirectory, "agent-published-head");
  const temporaryPath = `${publicationPath}.tmp`;
  writeFileSync(temporaryPath, `${commit}\n`, { mode: 0o600 });
  // A leftover temporary from a crash keeps the mode it had; the record is
  // private whatever the file was.
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, publicationPath);
}
