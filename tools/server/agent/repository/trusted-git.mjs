// Git metadata never enters the sandbox. Resolve it from the trusted clone's
// worktree registry, not from the .git file that repository code can replace.
// Every invocation pins that metadata, disables hooks/fsmonitor and drops the
// bridge's credentials and global Git configuration.

import { execFile } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

// A local Git command that never answers would hold the single global
// execution of the service. Every invocation therefore has a deadline and
// honours the stop signal of the instruction that started it. A remote
// operation may legitimately take longer than a local one.
export const localGitTimeoutMilliseconds = 120 * 1000;
export const remoteGitTimeoutMilliseconds = 300 * 1000;

// The index mode of a nested repository or a submodule (a gitlink).
export const gitlinkMode = "160000";
// Every Git read of the working tree passes this option: Git would otherwise
// enter a nested repository and run commands there with its own configuration.
export const ignoreSubmodules = "--ignore-submodules=all";

// Node reports a timeout with `killed` and the signal that ended the child, and
// an aborted request with `AbortError`. A killed command never answers, so it is
// not the benign refusal `allowFailure` describes.
function gitWasInterrupted(error) {
  return error?.name === "AbortError" || error?.killed === true;
}

/**
 * A Git command that its deadline or the stop signal killed. It is not an
 * answer Git gave, so callers must not read it as an ordinary result.
 */
export class GitInterruptedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "GitInterruptedError";
  }
}

export function primaryRepository(repositoryPath) {
  const path = realpathSync(repositoryPath);
  return {
    path,
    gitDirectory: realpathSync(join(path, ".git")),
    primary: true,
  };
}

/** A path inspected without following its final symbolic link, or null. */
export function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function registeredWorktree(repositoryPath, worktreePath) {
  const repository = primaryRepository(repositoryPath);
  const registry = join(repository.gitDirectory, "worktrees");
  const path = realpathSync(worktreePath);
  let entries;
  try {
    entries = readdirSync(registry);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "The worktree is not registered in the trusted repository.",
        { cause: error },
      );
    }
    throw error;
  }
  for (const entry of entries) {
    const gitDirectory = join(registry, entry);
    const gitdirPath = join(gitDirectory, "gitdir");
    // The registration is read only as the regular file Git writes: a link
    // would point the trusted path at metadata the service never chose, and a
    // hard link receives the in-place write of `git worktree move`.
    const gitdirStats = lstatOrNull(gitdirPath);
    if (gitdirStats === null) {
      continue;
    }
    if (!gitdirStats.isFile() || gitdirStats.nlink > 1) {
      throw new Error(
        "The Git metadata of a worktree is not a trusted file; refusing host Git.",
      );
    }
    const marker = readFileSync(gitdirPath, "utf8").trim();
    if (dirname(marker) === path) {
      return { path, gitDirectory, primary: false };
    }
  }
  throw new Error("The worktree is not registered in the trusted repository.");
}

// A `.git` marker is one `gitdir:` line; anything longer is not a marker this
// service wrote.
const maximumMarkerBytes = 4096;

function assertWorktreeMarker(worktree) {
  if (worktree.primary) {
    return;
  }
  const expected = `gitdir: ${worktree.gitDirectory}`;
  // Open without following a link and without blocking on a FIFO the sandbox
  // may have left at `.git`, then inspect the descriptor, so the file that is
  // checked is the file that is read: a symbolic link at `.git` fails here and
  // a hard link never reports its single-link name.
  let descriptor;
  try {
    descriptor = openSync(
      join(worktree.path, ".git"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    throw new Error(
      "The worktree Git marker was modified; refusing host Git.",
      {
        cause: error,
      },
    );
  }
  let marker;
  try {
    const stats = fstatSync(descriptor);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.size > maximumMarkerBytes
    ) {
      throw new Error(
        "The worktree Git marker was modified; refusing host Git.",
      );
    }
    const buffer = Buffer.alloc(stats.size);
    const bytesRead = readSync(descriptor, buffer, 0, stats.size, 0);
    marker = buffer.toString("utf8", 0, bytesRead).trim();
  } finally {
    closeSync(descriptor);
  }
  if (marker !== expected) {
    throw new Error("The worktree Git marker was modified; refusing host Git.");
  }
}

export function gitEnvironment(environment = {}) {
  return {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...environment,
  };
}

export async function runGit(
  worktree,
  argumentsList,
  {
    environment,
    allowFailure = false,
    input,
    encoding = "utf8",
    maxBuffer = 1024 * 1024,
    signal,
    timeoutMilliseconds = localGitTimeoutMilliseconds,
  } = {},
) {
  assertWorktreeMarker(worktree);
  try {
    // The service runs with umask 0077 so private state stays private. Git must
    // still write the modes recorded in the index, or a checked-out script
    // loses its execute bits and the repository checks fail inside the agent.
    const execution = executeFile(
      "/bin/sh",
      [
        "-c",
        'umask 022; exec "$@"',
        "sh",
        "git",
        `--git-dir=${worktree.gitDirectory}`,
        `--work-tree=${worktree.path}`,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.attributesFile=/dev/null",
        ...argumentsList,
      ],
      {
        cwd: worktree.path,
        env: gitEnvironment(environment),
        encoding,
        maxBuffer,
        signal,
        timeout: timeoutMilliseconds,
        killSignal: "SIGKILL",
      },
    );
    if (input !== undefined) {
      execution.child.stdin.end(input);
    }
    const { stdout } = await execution;
    // Callers parsing porcelain/-z need every byte, including leading spaces.
    return stdout;
  } catch (error) {
    if (gitWasInterrupted(error)) {
      throw new GitInterruptedError(
        `git ${argumentsList[0]} did not finish: ${error.signal ?? error.name}.`,
        { cause: error },
      );
    }
    if (allowFailure) {
      return "";
    }
    throw new Error(
      `git ${argumentsList[0]} failed: ${error.stderr ?? "unknown error"}`,
      { cause: error },
    );
  }
}
