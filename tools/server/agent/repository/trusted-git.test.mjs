// A Git command that never answers must not hold the single global execution.
// The fake `git` below is a shell script: the trusted runner finds it through
// the PATH of the restricted environment, so the test never waits for a real
// Git operation.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  GitInterruptedError,
  registeredWorktree,
  runGit,
} from "./trusted-git.mjs";

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

/** A linked worktree whose fake Git only records that it ran. */
function markerFixture(context) {
  const { directory } = fixture(context);
  const worktreePath = join(directory, "worktree");
  mkdirSync(worktreePath);
  const gitDirectory = join(directory, "administrative");
  mkdirSync(gitDirectory);
  const executed = join(directory, "git-executed");
  writeFileSync(
    join(directory, "git"),
    '#!/bin/sh\ntouch "$GIT_WAS_EXECUTED"\n',
    { mode: 0o755 },
  );
  return {
    directory,
    worktree: { path: worktreePath, gitDirectory, primary: false },
    executed,
    environment: {
      PATH: `${directory}:${process.env.PATH}`,
      GIT_WAS_EXECUTED: executed,
    },
  };
}

test("runs Git when the marker names the registered administrative directory", async (context) => {
  const { worktree, executed, environment } = markerFixture(context);
  writeFileSync(
    join(worktree.path, ".git"),
    `gitdir: ${worktree.gitDirectory}\n`,
  );

  await runGit(worktree, ["status"], { environment });

  assert.equal(existsSync(executed), true);
});

test("refuses a missing Git marker instead of an ENOENT", async (context) => {
  const { worktree, executed, environment } = markerFixture(context);

  await assert.rejects(runGit(worktree, ["status"], { environment }), {
    message: /The worktree Git marker was modified; refusing host Git/u,
  });
  assert.equal(existsSync(executed), false, "no Git command ran");
});

test("refuses a Git marker that is a directory", async (context) => {
  const { worktree, executed, environment } = markerFixture(context);
  mkdirSync(join(worktree.path, ".git"));

  await assert.rejects(runGit(worktree, ["status"], { environment }), {
    message: /The worktree Git marker was modified; refusing host Git/u,
  });
  assert.equal(existsSync(executed), false, "no Git command ran");
});

test(
  "refuses a FIFO at the Git marker without blocking",
  { skip: process.platform === "win32" },
  async (context) => {
    const { worktree, executed, environment } = markerFixture(context);
    const created = spawnSync("mkfifo", [join(worktree.path, ".git")], {
      encoding: "utf8",
    });
    assert.equal(created.status, 0, created.stderr);
    const startedAt = Date.now();

    await assert.rejects(runGit(worktree, ["status"], { environment }), {
      message: /The worktree Git marker was modified; refusing host Git/u,
    });

    assert.ok(Date.now() - startedAt < 5000, "the open did not block");
    assert.equal(existsSync(executed), false, "no Git command ran");
  },
);

test("refuses a Git marker longer than a marker", async (context) => {
  const { worktree, executed, environment } = markerFixture(context);
  writeFileSync(join(worktree.path, ".git"), `${"x".repeat(5000)}\n`);

  await assert.rejects(runGit(worktree, ["status"], { environment }), {
    message: /The worktree Git marker was modified; refusing host Git/u,
  });
  assert.equal(existsSync(executed), false, "no Git command ran");
});

test("refuses a Git marker with another hard link", async (context) => {
  const { directory, worktree, executed, environment } = markerFixture(context);
  const markerPath = join(worktree.path, ".git");
  writeFileSync(markerPath, `gitdir: ${worktree.gitDirectory}\n`);
  linkSync(markerPath, join(directory, "marker-witness"));

  await assert.rejects(runGit(worktree, ["status"], { environment }), {
    message: /The worktree Git marker was modified; refusing host Git/u,
  });
  assert.equal(existsSync(executed), false, "no Git command ran");
});

function registryFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-registry-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const repositoryPath = join(directory, "repository");
  mkdirSync(join(repositoryPath, ".git"), { recursive: true });
  const worktreePath = join(directory, "worktree");
  mkdirSync(worktreePath);
  return { directory, repositoryPath, worktreePath };
}

test("reports an unregistered worktree when the registry is missing", (context) => {
  const { repositoryPath, worktreePath } = registryFixture(context);

  assert.throws(() => registeredWorktree(repositoryPath, worktreePath), {
    message: /not registered in the trusted repository/u,
  });
});

test("skips a registry entry without a gitdir file", (context) => {
  const { repositoryPath, worktreePath } = registryFixture(context);
  mkdirSync(join(repositoryPath, ".git", "worktrees", "unrelated"), {
    recursive: true,
  });

  assert.throws(() => registeredWorktree(repositoryPath, worktreePath), {
    message: /not registered in the trusted repository/u,
  });
});

test("finds a registered worktree through its gitdir file", (context) => {
  const { repositoryPath, worktreePath } = registryFixture(context);
  const gitDirectory = join(
    realpathSync(repositoryPath),
    ".git",
    "worktrees",
    "topic-synthetic",
  );
  mkdirSync(gitDirectory, { recursive: true });
  writeFileSync(
    join(gitDirectory, "gitdir"),
    `${join(realpathSync(worktreePath), ".git")}\n`,
  );

  assert.deepEqual(registeredWorktree(repositoryPath, worktreePath), {
    path: realpathSync(worktreePath),
    gitDirectory,
    primary: false,
  });
});
