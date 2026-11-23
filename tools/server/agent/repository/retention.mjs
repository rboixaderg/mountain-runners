// Worktree retention for the private agent.
//
// Each worktree installs its own offline copy of `node_modules` inside the
// bounded volume. Archived worktrees (`<opaque name>-before-<opaque suffix>`)
// that have nothing left to lose are removed, while kept archives and finished
// topics (whose bound pull request is closed) have their generated dependency
// directories stripped or are removed once all changes are published.

import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createAttachmentStore } from "../attachments/store.mjs";
import {
  primaryRepository,
  registeredWorktree,
  runGit,
} from "./trusted-git.mjs";
import { publishedCommit, stripWorktreeDependencies } from "./worktrees.mjs";

// Both parts are opaque: the suffix is an HMAC of the update identifier, so it
// carries no order. Archives of one topic are ordered by their birth time
// instead: `git worktree move` renames the directory, which keeps it, while
// writing inside the archive does not change it.
const archivedPattern = /^(topic-[0-9a-f]{16})-before-[0-9a-f]{8}$/u;
const protectedBranches = new Set(["main", "master"]);

function archivedAt(path) {
  const status = statSync(path);
  // A filesystem without birth time reports zero; the inode change time still
  // moves with the rename and keeps the choice deterministic.
  return status.birthtimeMs > 0 ? status.birthtimeMs : status.ctimeMs;
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

function archivedCandidates(paths, worktreeRoot) {
  if (!existsSync(worktreeRoot)) {
    return [];
  }
  const root = realpathSync(worktreeRoot);
  const candidates = [];
  for (const path of paths) {
    // Git keeps a worktree registered after its directory disappeared. It is
    // not a candidate: there is nothing to measure or to remove.
    if (!existsSync(path)) {
      continue;
    }
    const resolvedPath = realpathSync(path);
    if (!resolvedPath.startsWith(`${root}/`)) {
      continue;
    }
    const match = archivedPattern.exec(basename(resolvedPath));
    if (!match) {
      continue;
    }
    candidates.push({
      topic: match[1],
      archivedAt: archivedAt(resolvedPath),
      path: resolvedPath,
    });
  }
  return candidates;
}

function isNewer(candidate, current) {
  if (candidate.archivedAt !== current.archivedAt) {
    return candidate.archivedAt > current.archivedAt;
  }
  // Equal timestamps keep the choice stable instead of depending on the order
  // Git listed the worktrees.
  return candidate.path > current.path;
}

function newestByTopic(candidates) {
  const newest = new Map();
  for (const candidate of candidates) {
    const current = newest.get(candidate.topic);
    if (current === undefined || isNewer(candidate, current)) {
      newest.set(candidate.topic, candidate);
    }
  }
  return newest;
}

async function inspectWorktreeState(worktree, { signal } = {}) {
  const head = (
    await runGit(worktree, ["rev-parse", "HEAD"], { signal })
  ).trim();
  const aheadText = (
    await runGit(worktree, ["rev-list", "--count", "origin/main..HEAD"], {
      signal,
    })
  ).trim();
  const ahead = /^\d+$/u.test(aheadText) ? Number(aheadText) : Number.NaN;
  const aheadOfMain = !Number.isSafeInteger(ahead) || ahead > 0;
  // A squash-merged branch stays ahead of origin/main in Git, even though its
  // HEAD was already pushed and recorded in the trusted metadata directory.
  const hasUnpublishedCommits =
    aheadOfMain && publishedCommit(worktree) !== head;
  const hasUncommittedChanges =
    (await runGit(worktree, ["status", "--porcelain"], { signal })).trim() !==
    "";
  const branch = (
    await runGit(worktree, ["symbolic-ref", "--short", "-q", "HEAD"], {
      allowFailure: true,
      signal,
    })
  ).trim();
  return {
    head,
    aheadOfMain,
    hasUnpublishedCommits,
    hasUncommittedChanges,
    branch,
  };
}

function cleanDependencies(path, cleaned, { dryRun, logger }) {
  const directories = stripWorktreeDependencies(path, { dryRun, logger });
  if (directories.length === 0) {
    return;
  }
  if (!dryRun) {
    logger("worktree_dependencies_cleaned", path);
  }
  cleaned.push({ path, directories });
}

async function removeWorktreeAndBranch(
  repository,
  path,
  branch,
  { signal } = {},
) {
  await runGit(repository, ["worktree", "remove", "--", path], { signal });
  if (
    branch !== "" &&
    !branch.startsWith("-") &&
    !protectedBranches.has(branch)
  ) {
    await runGit(repository, ["branch", "-D", "--", branch], {
      allowFailure: true,
      signal,
    });
  }
}

/**
 * Remove the topic attachments that stayed unused for seven days. The images
 * live outside the worktree, in the private state directory; the startup runs
 * this next to the worktree retention and never blocks the service.
 */
export function pruneStoredAttachments({ statePath, logger = () => {} }) {
  return createAttachmentStore({ stateDirectory: statePath }).prune({
    logger,
  });
}

export async function pruneArchivedWorktrees({
  repositoryPath,
  worktreeRoot,
  dryRun = false,
  signal,
  logger = () => {},
}) {
  const repository = primaryRepository(repositoryPath);
  const candidates = archivedCandidates(
    await worktreePaths(repository, { signal }),
    worktreeRoot,
  );
  const newest = newestByTopic(candidates);
  const removed = [];
  const kept = [];
  const cleaned = [];

  for (const candidate of candidates) {
    if (newest.get(candidate.topic) === candidate) {
      cleanDependencies(candidate.path, cleaned, { dryRun, logger });
      kept.push({ path: candidate.path, reason: "newest_archive" });
      continue;
    }

    let worktree;
    try {
      worktree = registeredWorktree(repositoryPath, candidate.path);
    } catch {
      kept.push({ path: candidate.path, reason: "unregistered_worktree" });
      continue;
    }

    let state;
    try {
      state = await inspectWorktreeState(worktree, { signal });
    } catch {
      signal?.throwIfAborted();
      // One damaged archive must not stop the retention of the rest.
      logger("worktree_inspection_failed", candidate.path);
      kept.push({ path: candidate.path, reason: "inspection_failed" });
      continue;
    }

    // ADR 0013: never automatically remove an archive whose commits are not in
    // origin/main; strip its generated dependencies instead.
    if (state.aheadOfMain) {
      cleanDependencies(candidate.path, cleaned, { dryRun, logger });
      kept.push({ path: candidate.path, reason: "unpublished_commits" });
      continue;
    }
    if (state.hasUncommittedChanges) {
      cleanDependencies(candidate.path, cleaned, { dryRun, logger });
      kept.push({ path: candidate.path, reason: "uncommitted_changes" });
      continue;
    }

    if (!dryRun) {
      try {
        await removeWorktreeAndBranch(
          repository,
          candidate.path,
          state.branch,
          {
            signal,
          },
        );
      } catch {
        signal?.throwIfAborted();
        logger("worktree_removal_failed", candidate.path);
        cleanDependencies(candidate.path, cleaned, { dryRun, logger });
        kept.push({ path: candidate.path, reason: "removal_failed" });
        continue;
      }
      logger("worktree_pruned", candidate.path);
    }
    removed.push({ path: candidate.path, branch: state.branch });
  }

  return { removed, kept, cleaned };
}

/**
 * Remove clean, published worktrees whose bound pull request is merged on
 * GitHub, and strip generated dependencies from closed-unmerged or dirty
 * closed-topic worktrees without deleting unmerged work (ADR 0013). Callers
 * must only invoke this inside the single-execution idle path or when the
 * service is stopped.
 */
export async function pruneFinishedTopicWorktrees({
  repositoryPath,
  worktreeRoot,
  bindings,
  worktreeNameForSession,
  readPullRequest,
  dryRun = false,
  signal,
  logger = () => {},
}) {
  if (!existsSync(worktreeRoot) || bindings.length === 0) {
    return { removed: [], kept: [], cleaned: [] };
  }
  const repository = primaryRepository(repositoryPath);
  const root = realpathSync(worktreeRoot);
  const registeredPaths = new Set();
  for (const path of await worktreePaths(repository, { signal })) {
    if (!existsSync(path)) {
      continue;
    }
    const resolvedPath = realpathSync(path);
    if (resolvedPath.startsWith(`${root}/`)) {
      registeredPaths.add(resolvedPath);
    }
  }

  const removed = [];
  const kept = [];
  const cleaned = [];

  for (const binding of bindings) {
    const candidatePath = join(
      root,
      worktreeNameForSession(binding.sessionKey),
    );
    if (!registeredPaths.has(candidatePath)) {
      continue;
    }

    let pullRequest;
    try {
      pullRequest = await readPullRequest(binding.pullRequestNumber, {
        signal,
      });
    } catch {
      signal?.throwIfAborted();
      logger("finished_worktree_pr_read_failed", candidatePath);
      kept.push({ path: candidatePath, reason: "pull_request_unreadable" });
      continue;
    }
    if (pullRequest?.state !== "closed") {
      continue;
    }

    let worktree;
    let state;
    try {
      worktree = registeredWorktree(repositoryPath, candidatePath);
      state = await inspectWorktreeState(worktree, { signal });
    } catch {
      signal?.throwIfAborted();
      logger("worktree_inspection_failed", candidatePath);
      kept.push({ path: candidatePath, reason: "inspection_failed" });
      continue;
    }

    if (
      state.branch !== binding.branch ||
      (pullRequest.headRef !== undefined &&
        pullRequest.headRef !== binding.branch)
    ) {
      kept.push({ path: candidatePath, reason: "branch_mismatch" });
      continue;
    }
    // ADR 0013: a closed PR that was not merged may be reopened or hold the
    // only copy of unmerged work. Strip dependencies only, never delete it.
    if (pullRequest.merged !== true) {
      cleanDependencies(candidatePath, cleaned, { dryRun, logger });
      kept.push({ path: candidatePath, reason: "unmerged_pull_request" });
      continue;
    }
    if (state.hasUnpublishedCommits) {
      cleanDependencies(candidatePath, cleaned, { dryRun, logger });
      kept.push({ path: candidatePath, reason: "unpublished_commits" });
      continue;
    }
    if (state.hasUncommittedChanges) {
      cleanDependencies(candidatePath, cleaned, { dryRun, logger });
      kept.push({ path: candidatePath, reason: "uncommitted_changes" });
      continue;
    }

    if (!dryRun) {
      try {
        await removeWorktreeAndBranch(repository, candidatePath, state.branch, {
          signal,
        });
      } catch {
        signal?.throwIfAborted();
        logger("worktree_removal_failed", candidatePath);
        cleanDependencies(candidatePath, cleaned, { dryRun, logger });
        kept.push({ path: candidatePath, reason: "removal_failed" });
        continue;
      }
      logger("finished_worktree_pruned", candidatePath);
    }
    removed.push({
      path: candidatePath,
      branch: state.branch,
      pullRequestNumber: binding.pullRequestNumber,
    });
  }

  return { removed, kept, cleaned };
}
