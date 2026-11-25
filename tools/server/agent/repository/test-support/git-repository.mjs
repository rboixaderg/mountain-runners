// Temporary Git repositories for tests: a bare origin and a clone whose first
// commit is already pushed to `main`.

import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export async function git(directory, argumentsList) {
  const { stdout } = await executeFile("git", [
    "-C",
    directory,
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.test",
    ...argumentsList,
  ]);
  return stdout.trim();
}

/** A temporary directory, as a real path, removed when the test ends. */
export function temporaryDirectory(context, prefix) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return directory;
}

export async function createGitRepository(
  context,
  prefix,
  files = { "README.md": "synthetic\n" },
) {
  const directory = temporaryDirectory(context, prefix);
  const origin = join(directory, "origin.git");
  const repository = join(directory, "repository");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), content);
  }
  await git(repository, ["add", "--all"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);
  return { directory, origin, repository };
}

/** Name the GitHub repository as the remote and keep Git on the local origin. */
export async function useGitHubRemote({ repository, origin }, slug) {
  const url = `https://github.com/${slug}.git`;
  await git(repository, ["remote", "set-url", "origin", url]);
  await git(repository, ["config", `url.${origin}.insteadOf`, url]);
}
