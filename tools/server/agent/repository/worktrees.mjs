// Local Git lifecycle. The sandbox sees source files but never the clone's
// metadata. A worktree context carries its trusted registry entry explicitly.
// A clean worktree is reusable only after its publication was acknowledged.

import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  GitInterruptedError,
  lstatOrNull,
  primaryRepository,
  registeredWorktree,
  remoteGitTimeoutMilliseconds,
  runGit,
} from "./trusted-git.mjs";
import { parseLegacyWorktreeName } from "./identifiers.mjs";

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
const archiveSuffixPattern = /^[0-9a-f]{8}$/u;
const worktreeNamePattern = /^[a-z0-9][a-z0-9._-]*$/u;
// The marker is replaced through one fixed temporary file next to it, so a
// leftover of an interrupted write is recognised by its name and its content.
const markerTemporaryName = ".git.agent-marker-tmp";

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
  newTaskSuffix,
  signal,
}) {
  if (baseBranch !== "main") {
    throw new Error("The agent only starts work from main.");
  }
  assertWorktreeName(name);
  if (
    newTaskSuffix !== undefined &&
    !archiveSuffixPattern.test(newTaskSuffix)
  ) {
    throw new Error("A new task requires a valid opaque archive suffix.");
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
  if (existing && newTaskSuffix !== undefined) {
    const previous = registeredWorktree(repositoryPath, worktreePath);
    // Check the untrusted Git marker before moving the registered worktree.
    // Even a clean tree may contain ignored artifacts from a previous task.
    await listChangedPaths(previous, { signal });
    const archivePath = join(
      realpathSync(worktreeRoot),
      `${name}-before-${newTaskSuffix}`,
    );
    if (lstatOrNull(archivePath) !== null) {
      throw new Error(`The archive ${basename(archivePath)} already exists.`);
    }
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

/**
 * The private key a worktree still carries in its directory name or in the
 * name of its Git administrative directory, or null when both are opaque.
 */
function legacyWorktreeKey({ name, gitDirectory, markerAdminPath }) {
  return (
    parseLegacyWorktreeName(name) ??
    parseLegacyWorktreeName(basename(gitDirectory)) ??
    (markerAdminPath === null
      ? null
      : parseLegacyWorktreeName(basename(markerAdminPath)))
  );
}

function opaqueWorktreeNameFor(identifiers, legacy) {
  const opaqueWorktreeName = identifiers.worktreeName(legacy.sessionKey);
  return legacy.updateIdentifier === null
    ? opaqueWorktreeName
    : identifiers.archiveName(opaqueWorktreeName, legacy.updateIdentifier);
}

/**
 * The opaque name of a worktree from the names the trusted registry already
 * holds, without reading the marker the sandbox can replace.
 */
function opaqueNameOf({ identifiers, name, gitDirectory }) {
  const legacy = legacyWorktreeKey({
    name,
    gitDirectory,
    markerAdminPath: null,
  });
  return legacy === null
    ? basename(gitDirectory)
    : opaqueWorktreeNameFor(identifiers, legacy);
}

/** The exact marker Git must see for one administrative directory. */
function markerContent(gitDirectory) {
  return `gitdir: ${gitDirectory}\n`;
}

/**
 * `git worktree move` rewrites the worktree `.git` file and the administrative
 * `gitdir` file in place, so a hard link to either one receives that write.
 * The migration therefore trusts neither entry unless it is a regular file with
 * a single link. A sandbox can only link a file it already sees inside `/work`.
 */
function isTrustedGitMetadataFile(stats) {
  return stats.isFile() && stats.nlink === 1;
}

/**
 * The Git marker of a linked worktree: the admin path it names (null when the
 * marker is missing) and whether the marker is a regular file with one link.
 * Only such a marker is read: the sandbox can replace it with a link to any
 * file the service may write.
 */
function readWorktreeMarker(worktreePath) {
  const markerPath = join(worktreePath, ".git");
  const markerStats = lstatOrNull(markerPath);
  if (markerStats === null) {
    return { adminPath: null, trusted: true };
  }
  if (!isTrustedGitMetadataFile(markerStats)) {
    return { adminPath: null, trusted: false };
  }
  const marker = readFileSync(markerPath, "utf8").trim();
  return {
    adminPath: marker.startsWith("gitdir: ")
      ? marker.slice("gitdir: ".length)
      : null,
    trusted: true,
  };
}

/**
 * Remove the fixed temporary file only when it is a leftover of an interrupted
 * write: a regular file with one link whose content is the marker or a prefix of
 * it. A crash can leave the file empty or half-written, and the next start must
 * still be able to replace it. Any other entry belongs to the task or to the
 * sandbox, so it is refused instead of deleted.
 */
function removeMarkerTemporaryIfLeftover(worktreePath, content) {
  const temporaryPath = join(worktreePath, markerTemporaryName);
  const temporaryStats = lstatOrNull(temporaryPath);
  if (temporaryStats === null) {
    return true;
  }
  if (
    !isTrustedGitMetadataFile(temporaryStats) ||
    temporaryStats.size > Buffer.byteLength(content)
  ) {
    return false;
  }
  const written = readFileSync(temporaryPath, "utf8");
  if (written !== "" && !content.startsWith(written)) {
    return false;
  }
  rmSync(temporaryPath);
  return true;
}

/**
 * Rewrite the marker from the trusted registry path, never through the entry
 * the sandbox may have left at `.git`: an exclusive temporary file in the same
 * directory replaces it with an atomic rename. An interrupted write leaves a
 * regular file the next start recognises and replaces the same way.
 */
function writeMarker(worktreePath, gitDirectory) {
  const temporaryPath = join(worktreePath, markerTemporaryName);
  const descriptor = openSync(temporaryPath, "wx", 0o644);
  let renamed = false;
  try {
    try {
      // The service runs with umask 0077; Git and the sandbox read mode 0644.
      fchmodSync(descriptor, 0o644);
      writeFileSync(descriptor, markerContent(gitDirectory));
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, join(worktreePath, ".git"));
    renamed = true;
  } finally {
    if (!renamed) {
      rmSync(temporaryPath, { force: true });
    }
  }
}

async function migrateWorktree({
  repository,
  repositoryPath,
  root,
  worktreePath,
  identifiers,
  logger,
  signal,
}) {
  let worktree = registeredWorktree(repositoryPath, worktreePath);
  const marker = readWorktreeMarker(worktreePath);
  const legacyOuter = parseLegacyWorktreeName(basename(worktreePath));
  const legacy = legacyWorktreeKey({
    name: basename(worktreePath),
    gitDirectory: worktree.gitDirectory,
    markerAdminPath: marker.adminPath,
  });
  // A marker the previous start left half-written has no legacy name left to
  // migrate: its own registry entry is the opaque name to restore.
  const opaqueName =
    legacy === null
      ? basename(worktree.gitDirectory)
      : opaqueWorktreeNameFor(identifiers, legacy);
  if (!marker.trusted) {
    // Rewriting it would follow a link or write through a hard link the sandbox
    // left behind. Nothing of this worktree is moved: a person inspects it.
    logger("worktree_marker_untrusted", opaqueName);
    throw new Error(
      `The .git marker of the worktree ${opaqueName} is not a regular file with one link; a person must inspect it.`,
    );
  }
  const targetGitDirectory = join(dirname(worktree.gitDirectory), opaqueName);
  if (
    !removeMarkerTemporaryIfLeftover(
      worktreePath,
      markerContent(targetGitDirectory),
    )
  ) {
    logger("worktree_marker_untrusted", opaqueName);
    throw new Error(
      `The marker temporary file of the worktree ${opaqueName} is not a leftover of an interrupted migration; a person must inspect it.`,
    );
  }
  if (legacy === null && marker.adminPath === worktree.gitDirectory) {
    return null;
  }
  const renamedFrom = basename(worktreePath);

  // The directory Git registers in `.git/worktrees/` keeps the basename it had
  // at creation, so moving the worktree renames only the mounted directory.
  if (legacyOuter !== null) {
    const targetPath = join(root, opaqueName);
    if (lstatOrNull(targetPath) !== null) {
      // Git would move the worktree inside an existing directory.
      throw new Error(`The worktree ${opaqueName} already exists.`);
    }
    await runGit(repository, ["worktree", "move", worktreePath, targetPath], {
      signal,
    });
    worktreePath = targetPath;
    worktree = registeredWorktree(repositoryPath, worktreePath);
  }

  if (worktree.gitDirectory !== targetGitDirectory) {
    const sourceDirectory = lstatOrNull(worktree.gitDirectory);
    if (sourceDirectory !== null && !sourceDirectory.isDirectory()) {
      throw new Error(
        `The Git metadata of ${opaqueName} is not a directory; a person must inspect it.`,
      );
    }
    if (sourceDirectory !== null) {
      if (lstatOrNull(targetGitDirectory) !== null) {
        throw new Error(
          `The Git metadata directory ${opaqueName} already exists.`,
        );
      }
      renameSync(worktree.gitDirectory, targetGitDirectory);
    } else if (lstatOrNull(targetGitDirectory) === null) {
      throw new Error(
        `The Git metadata directory of ${basename(worktreePath)} is missing.`,
      );
    }
  }
  writeMarker(worktreePath, targetGitDirectory);
  return { from: renamedFrom, to: opaqueName };
}

/**
 * Every registered worktree has one `gitdir` file in the trusted clone. The
 * migration never reads a registration Git did not write as a regular file,
 * and it stops before Git or the service follows it. Git itself skips a
 * worktree whose registration points elsewhere, so the check runs before
 * listing them.
 */
function assertTrustedWorktreeRegistry({ repository, identifiers, logger }) {
  const registry = join(repository.gitDirectory, "worktrees");
  const registryStats = lstatOrNull(registry);
  if (registryStats === null) {
    return;
  }
  if (!registryStats.isDirectory()) {
    throw new Error(
      "The Git worktree registry is not a directory; a person must inspect it.",
    );
  }
  for (const entry of readdirSync(registry)) {
    const gitdirStats = lstatOrNull(join(registry, entry, "gitdir"));
    if (gitdirStats !== null && isTrustedGitMetadataFile(gitdirStats)) {
      continue;
    }
    const opaqueName = opaqueNameOf({
      identifiers,
      name: entry,
      gitDirectory: join(registry, entry),
    });
    logger("worktree_marker_untrusted", opaqueName);
    throw new Error(
      `The Git registration of the worktree ${opaqueName} is not a regular file with one link; a person must inspect it.`,
    );
  }
}

/**
 * Rename the worktrees the previous naming scheme created.
 *
 * The old directory name encoded the chat and the topic, the old archive suffix
 * encoded the update, and `git worktree move` keeps the old name in
 * `.git/worktrees/` and in the `.git` file the sandbox mounts. The migration
 * renames the mounted directory, renames the Git administrative directory and
 * rewrites the marker, so no private name survives inside `/work`.
 *
 * It is restartable: every step is idempotent, and a start after an
 * interruption finishes whatever is left. A registered worktree is never
 * removed, its branch, changes and published marker stay, and a failure stops
 * the caller instead of leaving half of the volume under a private name.
 */
export async function renameLegacyWorktrees({
  repositoryPath,
  worktreeRoot,
  identifiers,
  signal,
  logger = () => {},
}) {
  if (!existsSync(worktreeRoot)) {
    return [];
  }
  const root = realpathSync(worktreeRoot);
  if (readdirSync(root).length === 0) {
    return [];
  }
  const repository = primaryRepository(repositoryPath);
  assertTrustedWorktreeRegistry({ repository, identifiers, logger });
  const renamed = [];
  for (const path of await worktreePaths(repository, { signal })) {
    if (!existsSync(path)) {
      continue;
    }
    const worktreePath = realpathSync(path);
    if (dirname(worktreePath) !== root) {
      continue;
    }
    const migrated = await migrateWorktree({
      repository,
      repositoryPath,
      root,
      worktreePath,
      identifiers,
      logger,
      signal,
    });
    if (migrated === null) {
      continue;
    }
    renamed.push(migrated);
    logger("worktree_migrated", migrated.to);
  }
  for (const name of readdirSync(root)) {
    // Git does not register this directory, so it is not a worktree: a plain
    // rename would break the metadata another registration owns.
    if (parseLegacyWorktreeName(name) !== null) {
      logger("worktree_migration_unregistered", name);
    }
  }
  return renamed;
}

/**
 * The private names still present in the worktree root or in the Git registry,
 * without running Git. The operator reconciliation uses it to refuse a case it
 * cannot attribute to the right worktree.
 */
export function listLegacyIdentifierNames({ repositoryPath, worktreeRoot }) {
  const names = [];
  for (const directory of [
    worktreeRoot,
    join(repositoryPath, ".git", "worktrees"),
  ]) {
    if (!existsSync(directory)) {
      continue;
    }
    for (const name of readdirSync(directory)) {
      if (parseLegacyWorktreeName(name) !== null) {
        names.push(name);
      }
    }
  }
  return [...new Set(names)];
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

export async function mergeMainIntoBranch({ worktree, signal }) {
  await runGit(worktree, ["fetch", "--prune", "origin", "main"], {
    signal,
    timeoutMilliseconds: remoteGitTimeoutMilliseconds,
  });
  const mainHead = (
    await runGit(worktree, ["rev-parse", "origin/main"], { signal })
  ).trim();
  return mergeCommitIntoBranch({ worktree, headSha: mainHead, signal });
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
  await runGit(worktree, ["add", "--all"], { signal });
  const unmerged = await runGit(
    worktree,
    ["diff", "--name-only", "--diff-filter=U", "-z"],
    { signal },
  );
  if (unmerged !== "") {
    return false;
  }
  await runGit(worktree, ["diff", "--cached", "--check"], { signal });
  await runGit(worktree, [...agentIdentityArguments, "commit", "--no-edit"], {
    signal,
  });
  return true;
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
