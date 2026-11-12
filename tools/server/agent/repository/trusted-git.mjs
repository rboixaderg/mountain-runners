// Git metadata never enters the sandbox. Resolve it from the trusted clone's
// worktree registry, not from the .git file that repository code can replace.
// Every invocation pins that metadata, disables hooks/fsmonitor and drops the
// bridge's credentials and global Git configuration.

import { execFile } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export function primaryRepository(repositoryPath) {
  const path = realpathSync(repositoryPath);
  return {
    path,
    gitDirectory: realpathSync(join(path, ".git")),
    primary: true,
  };
}

export function registeredWorktree(repositoryPath, worktreePath) {
  const repository = primaryRepository(repositoryPath);
  const registry = join(repository.gitDirectory, "worktrees");
  const path = realpathSync(worktreePath);
  for (const entry of readdirSync(registry)) {
    const gitDirectory = join(registry, entry);
    const marker = readFileSync(join(gitDirectory, "gitdir"), "utf8").trim();
    if (dirname(marker) === path) {
      return { path, gitDirectory, primary: false };
    }
  }
  throw new Error("The worktree is not registered in the trusted repository.");
}

function assertWorktreeMarker(worktree) {
  if (worktree.primary) {
    return;
  }
  const marker = join(worktree.path, ".git");
  if (
    !lstatSync(marker).isFile() ||
    readFileSync(marker, "utf8").trim() !== `gitdir: ${worktree.gitDirectory}`
  ) {
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
      },
    );
    if (input !== undefined) {
      execution.child.stdin.end(input);
    }
    const { stdout } = await execution;
    // Callers parsing porcelain/-z need every byte, including leading spaces.
    return stdout;
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    throw new Error(
      `git ${argumentsList[0]} failed: ${error.stderr ?? "unknown error"}`,
      { cause: error },
    );
  }
}
