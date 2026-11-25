// Worktree retention for the private agent.
//
// Each worktree installs its own offline copy of `node_modules` inside the
// bounded volume. Finished topics (whose bound pull request is closed) have
// their generated dependency directories stripped, or their worktree removed
// once the pull request is merged and all changes are published.

import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createAttachmentStore } from "../attachments/store.mjs";
import {
  ignoreSubmodules,
  primaryRepository,
  registeredWorktree,
  runGit,
} from "./trusted-git.mjs";
import { publishedCommit, stripWorktreeDependencies } from "./worktrees.mjs";

const protectedBranches = new Set(["main", "master"]);

async function worktreePaths(repository, { signal } = {}) {
  const output = await runGit(repository, ["worktree", "list", "--porcelain"], {
    signal,
  });
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
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
    (
      await runGit(worktree, ["status", "--porcelain", ignoreSubmodules], {
        signal,
      })
    ).trim() !== "";
  const branch = (
    await runGit(worktree, ["symbolic-ref", "--short", "-q", "HEAD"], {
      allowFailure: true,
      signal,
    })
  ).trim();
  return {
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
