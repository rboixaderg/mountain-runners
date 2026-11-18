// A Git command that never answers must not hold the single global execution.
// The fake `git` below is a shell script: the trusted runner finds it through
// the PATH of the restricted environment, so the test never waits for a real
// Git operation.

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GitInterruptedError, runGit } from "./trusted-git.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-git-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  // `git` sleeps far longer than any deadline of the test.
  writeFileSync(join(directory, "git"), "#!/bin/sh\nsleep 60\n", {
    mode: 0o755,
  });
  return {
    directory,
    worktree: { path: directory, gitDirectory: directory, primary: true },
  };
}

test("kills a Git command that passes its deadline", async (context) => {
  const { directory, worktree } = fixture(context);
  const startedAt = Date.now();

  await assert.rejects(
    runGit(worktree, ["status"], {
      environment: { PATH: `${directory}:${process.env.PATH}` },
      timeoutMilliseconds: 100,
    }),
    (error) => {
      assert.ok(error instanceof GitInterruptedError);
      assert.match(error.message, /git status did not finish: SIGKILL/u);
      return true;
    },
  );

  assert.ok(Date.now() - startedAt < 5000);
});

test("a killed Git command is never reported as a benign refusal", async (context) => {
  const { directory, worktree } = fixture(context);

  await assert.rejects(
    runGit(worktree, ["rev-parse"], {
      environment: { PATH: `${directory}:${process.env.PATH}` },
      allowFailure: true,
      timeoutMilliseconds: 100,
    }),
    { message: /git rev-parse did not finish/u },
  );
});

test("stops a Git command when the instruction signal aborts", async (context) => {
  const { directory, worktree } = fixture(context);
  const controller = new AbortController();
  const pending = runGit(worktree, ["fetch", "origin", "main"], {
    environment: { PATH: `${directory}:${process.env.PATH}` },
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(pending, {
    message: /git fetch did not finish: AbortError/u,
  });
});

test("refuses a worktree whose Git marker is a symbolic link", async (context) => {
  const { directory } = fixture(context);
  const worktreePath = join(directory, "worktree");
  mkdirSync(worktreePath);
  const linkedWorktree = {
    path: worktreePath,
    gitDirectory: join(directory, "administrative"),
    primary: false,
  };
  // The link target holds exactly the marker the ordinary path accepts, so only
  // the `lstat` check (a link is not a regular file) can refuse it.
  const markerContent = `gitdir: ${linkedWorktree.gitDirectory}\n`;
  const witness = join(directory, "private-state.sqlite");
  writeFileSync(witness, markerContent);
  symlinkSync(witness, join(worktreePath, ".git"));
  const executed = join(directory, "git-executed");
  writeFileSync(
    join(directory, "git"),
    '#!/bin/sh\ntouch "$GIT_WAS_EXECUTED"\n',
    { mode: 0o755 },
  );

  await assert.rejects(
    runGit(linkedWorktree, ["status"], {
      environment: {
        PATH: `${directory}:${process.env.PATH}`,
        GIT_WAS_EXECUTED: executed,
      },
    }),
    { message: /The worktree Git marker was modified; refusing host Git/u },
  );

  assert.equal(existsSync(executed), false, "no Git command ran");
  assert.equal(readFileSync(witness, "utf8"), markerContent);
});
