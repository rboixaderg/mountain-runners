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
import { join } from "node:path";
import {
  primaryRepository,
  registeredWorktree,
  runGit,
} from "./trusted-git.mjs";

const protectedBranches = new Set(["main", "master"]);
const branchPattern =
  /^(feat|fix|docs|refactor|test|build|ci|chore|security)\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

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

async function worktreePaths(repository) {
  const output = await runGit(repository, ["worktree", "list", "--porcelain"]);
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
}) {
  if (baseBranch !== "main") {
    throw new Error("The agent only starts work from main.");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid worktree name ${name}.`);
  }
  mkdirSync(worktreeRoot, { recursive: true });
  const worktreePath = join(realpathSync(worktreeRoot), name);
  const repository = primaryRepository(repositoryPath);
  const existing = (await worktreePaths(repository)).some(
    (path) => path === worktreePath,
  );

  await runGit(repository, ["fetch", "--prune", "origin", baseBranch]);
  if (!existing) {
    await runGit(repository, [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      `origin/${baseBranch}`,
    ]);
  }
  const worktree = registeredWorktree(repositoryPath, worktreePath);
  if (
    existing &&
    (await listChangedPaths(worktree)).length === 0 &&
    !(await hasUnpublishedCommit(worktree))
  ) {
    await runGit(worktree, ["checkout", "--detach", `origin/${baseBranch}`]);
  }
  return { ...worktree, reused: existing };
}

export async function listChangedPaths(worktree) {
  const output = await runGit(worktree, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "-z",
  ]);
  const entries = output.split("\0");
  const changedPaths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === "") {
      continue;
    }
    changedPaths.push(entry.slice(3));
    if (entry.startsWith("R") || entry.startsWith("C")) {
      index += 1;
    }
  }
  return changedPaths;
}

export async function currentBranch(worktree) {
  const branch = await runGit(
    worktree,
    ["symbolic-ref", "--short", "-q", "HEAD"],
    { allowFailure: true },
  );
  return branch.trim() || null;
}

export async function createBranch({ worktree, branch }) {
  assertWorkBranch(branch);
  await runGit(worktree, ["checkout", "-b", branch]);
  return branch;
}

export async function commitAll({ worktree, message }) {
  await runGit(worktree, ["add", "--all"]);
  if (
    (await runGit(worktree, ["diff", "--cached", "--name-only", "-z"])) !== ""
  ) {
    await runGit(worktree, [
      "-c",
      "user.name=Mountain Runners Agent",
      "-c",
      "user.email=agent@mountainrunners.cat",
      "commit",
      "-m",
      message,
    ]);
  }
  return (await runGit(worktree, ["rev-parse", "HEAD"])).trim();
}

export async function hasUnpublishedCommit(worktree) {
  if (!(await currentBranch(worktree))) {
    return false;
  }
  const commit = (await runGit(worktree, ["rev-parse", "HEAD"])).trim();
  const publicationPath = join(worktree.gitDirectory, "agent-published-head");
  if (
    existsSync(publicationPath) &&
    readFileSync(publicationPath, "utf8").trim() === commit
  ) {
    return false;
  }
  const base = (await runGit(worktree, ["rev-parse", "origin/main"])).trim();
  return commit !== base;
}

export async function committedPaths(worktree) {
  const output = await runGit(worktree, [
    "diff",
    "--name-only",
    "-z",
    "origin/main...HEAD",
  ]);
  return output.split("\0").filter(Boolean);
}

export function recordPublication(worktree, commit) {
  writeFileSync(
    join(worktree.gitDirectory, "agent-published-head"),
    `${commit}\n`,
    { mode: 0o600 },
  );
}
