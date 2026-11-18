// Archived worktree retention for the private agent.
//
// A new task archives the previous topic worktree as
// `<opaque name>-before-<opaque suffix>`, so the bounded volume keeps every
// dependency tree it ever installed. This module removes only archived
// worktrees that have nothing left to lose: no commit ahead of origin/main and
// no uncommitted change. The newest archived worktree of each topic is always
// preserved, and the active topic worktree is never a candidate.

import { realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import {
  primaryRepository,
  registeredWorktree,
  runGit,
} from "./trusted-git.mjs";

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

async function worktreePaths(repository) {
  const output = await runGit(repository, ["worktree", "list", "--porcelain"]);
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function archivedCandidates(paths, worktreeRoot) {
  const root = realpathSync(worktreeRoot);
  const candidates = [];
  for (const path of paths) {
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

export async function pruneArchivedWorktrees({
  repositoryPath,
  worktreeRoot,
  dryRun = false,
  logger = () => {},
}) {
  const repository = primaryRepository(repositoryPath);
  const candidates = archivedCandidates(
    await worktreePaths(repository),
    worktreeRoot,
  );
  const newest = newestByTopic(candidates);
  const removed = [];
  const kept = [];

  for (const candidate of candidates) {
    if (newest.get(candidate.topic) === candidate) {
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

    const ahead = Number(
      (
        await runGit(worktree, ["rev-list", "--count", "origin/main..HEAD"])
      ).trim(),
    );
    if (ahead > 0) {
      kept.push({ path: candidate.path, reason: "unpublished_commits" });
      continue;
    }

    if ((await runGit(worktree, ["status", "--porcelain"])).trim() !== "") {
      kept.push({ path: candidate.path, reason: "uncommitted_changes" });
      continue;
    }

    const branch = (
      await runGit(worktree, ["symbolic-ref", "--short", "-q", "HEAD"], {
        allowFailure: true,
      })
    ).trim();

    logger("worktree_pruned", candidate.path);
    if (!dryRun) {
      await runGit(repository, ["worktree", "remove", candidate.path]);
      if (branch !== "" && !protectedBranches.has(branch)) {
        await runGit(repository, ["branch", "-D", branch], {
          allowFailure: true,
        });
      }
    }
    removed.push({ path: candidate.path, branch });
  }

  return { removed, kept };
}
