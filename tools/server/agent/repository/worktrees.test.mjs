import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  assertWorkBranch,
  createBranch,
  currentBranch,
  ensureSessionWorktree,
  hasUnpublishedCommit,
} from "./worktrees.mjs";

const executeFile = promisify(execFile);

async function git(directory, argumentsList) {
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

async function repositoryFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-repository-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );

  const origin = join(directory, "origin.git");
  const repository = join(directory, "repository");
  const worktreeRoot = join(directory, "worktrees");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  return { directory, origin, repository, worktreeRoot };
}

test("creates a detached session worktree from the latest origin/main", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);

  const result = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic_n1001234567890_7",
  });

  assert.equal(
    result.path,
    realpathSync(join(worktreeRoot, "topic_n1001234567890_7")),
  );
  assert.equal(result.reused, false);
  assert.equal(await currentBranch(result), null);
  assert.equal(
    await git(result.path, ["rev-parse", "HEAD"]),
    await git(repository, ["rev-parse", "origin/main"]),
  );
});

test("reuses the same path and keeps unpublished work", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);
  const first = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic_n1001234567890_7",
  });
  await createBranch({
    worktree: first,
    branch: "feat/phase-8-t8.3-first",
  });
  writeFileSync(join(first.path, "work-in-progress.txt"), "keep\n");

  const second = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic_n1001234567890_7",
  });

  assert.equal(second.reused, true);
  assert.equal(second.path, first.path);
  assert.equal(await currentBranch(second), "feat/phase-8-t8.3-first");
  assert.equal(
    await git(second.path, ["status", "--porcelain", "--untracked-files=all"]),
    "?? work-in-progress.txt",
  );
});

test("returns a clean session worktree to the latest origin/main", async (context) => {
  const { origin, repository, worktreeRoot } = await repositoryFixture(context);
  await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic_n1001234567890_7",
  });

  const other = join(repository, "..", "other");
  await executeFile("git", ["clone", origin, other]);
  writeFileSync(join(other, "new-main.txt"), "new\n");
  await git(other, ["add", "new-main.txt"]);
  await git(other, ["commit", "-m", "feat: new main content"]);
  await git(other, ["push", "origin", "main"]);

  const second = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic_n1001234567890_7",
  });

  assert.equal(second.reused, true);
  assert.equal(
    await git(second.path, ["rev-parse", "HEAD"]),
    await git(origin, ["rev-parse", "main"]),
  );
  assert.equal(
    await git(second.path, ["rev-parse", "HEAD"]),
    await git(origin, ["rev-parse", "main"]),
  );
});

test("does not treat an old main commit as unpublished branch work", async (context) => {
  const { origin, repository, worktreeRoot } = await repositoryFixture(context);
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-old-main",
  });
  await createBranch({ worktree, branch: "fix/no-own-commits" });
  writeFileSync(join(repository, "new-main.txt"), "main advance\n");
  await git(repository, ["add", "--all"]);
  await git(repository, ["commit", "-m", "test: advance main"]);
  await git(repository, ["push", "origin", "main"]);
  await git(worktree.path, ["fetch", "origin", "main"]);
  assert.equal(await hasUnpublishedCommit(worktree), false);
  assert.notEqual(
    await git(origin, ["rev-parse", "main"]),
    await git(worktree.path, ["rev-parse", "HEAD"]),
  );
});

test("rejects main and unsafe branch names before touching Git", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);

  for (const branch of [
    "main",
    "master",
    "feat/phase-8-t8.3-..",
    "feat/phase-8-t8.3/",
    "--force",
    "feature/Has_Upper",
  ]) {
    assert.throws(() => assertWorkBranch(branch), Error, branch);
  }

  for (const name of ["../escape", "Uppercase", "-leading", ""]) {
    await assert.rejects(
      ensureSessionWorktree({
        repositoryPath: repository,
        worktreeRoot,
        name,
      }),
      { message: /Invalid worktree name/u },
      name,
    );
  }
});
