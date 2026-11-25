import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  abortConflictMerge,
  assertWorkBranch,
  commitAll,
  commitConflictMerge,
  createBranch,
  currentBranch,
  ensureSessionWorktree,
  hasUnpublishedCommit,
  listChangedPaths,
  listWorkingTreeChanges,
  NestedRepositoryError,
  recordPublication,
  synchronizeWithMain,
} from "./worktrees.mjs";
import { runGit } from "./trusted-git.mjs";
import { createNestedRepository } from "./test-support/nested-repository.mjs";
import { createGitRepository, git } from "./test-support/git-repository.mjs";

const executeFile = promisify(execFile);

async function repositoryFixture(context) {
  const { directory, origin, repository } = await createGitRepository(
    context,
    "mr-agent-repository-",
  );
  const worktreeRoot = join(directory, "worktrees");

  return { directory, origin, repository, worktreeRoot };
}

test("reports conflicted paths and aborts without changing the topic commit", async (context) => {
  const { origin, repository, worktreeRoot } = await repositoryFixture(context);
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-0123456789abcdef",
  });
  await createBranch({ worktree, branch: "feat/agent-synthetic" });
  const initialMain = await git(repository, ["rev-parse", "main"]);
  const synchronize = () =>
    synchronizeWithMain({ worktree, pendingWorkMessage: "chore: keep work" });
  assert.deepEqual(await synchronize(), {
    merged: false,
    mainHead: initialMain,
  });
  writeFileSync(join(worktree.path, "README.md"), "topic change\n");
  const topicHead = await commitAll({
    worktree,
    message: "feat(agent): change topic",
  });
  writeFileSync(join(repository, "README.md"), "main change\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: advance main"]);
  await git(origin, ["fetch", repository, "+refs/heads/main:refs/heads/main"]);

  assert.deepEqual(await synchronize(), {
    conflict: true,
    paths: ["README.md"],
    mainHead: await git(repository, ["rev-parse", "main"]),
  });
  assert.equal(await git(worktree.path, ["rev-parse", "HEAD"]), topicHead);
  assert.equal(
    readFileSync(join(worktree.path, "README.md"), "utf8"),
    "topic change\n",
  );
  await assert.rejects(
    git(worktree.path, ["rev-parse", "--verify", "MERGE_HEAD"]),
  );
});

async function topicBranchWorktree(context) {
  const fixture = await repositoryFixture(context);
  const worktree = await ensureSessionWorktree({
    repositoryPath: fixture.repository,
    worktreeRoot: fixture.worktreeRoot,
    name: "topic-0123456789abcdef",
  });
  await createBranch({ worktree, branch: "feat/agent-synthetic" });
  return {
    ...fixture,
    worktree,
    head: await git(worktree.path, ["rev-parse", "HEAD"]),
    marker: join(fixture.directory, "filter-ran"),
  };
}

test("refuses to commit a nested repository and never enters it", async (context) => {
  const { worktree, head, marker } = await topicBranchWorktree(context);
  writeFileSync(join(worktree.path, "change.txt"), "change\n");
  await createNestedRepository(worktree.path, marker);

  await assert.rejects(
    commitAll({ worktree, message: "feat(agent): change" }),
    NestedRepositoryError,
  );
  assert.equal(await git(worktree.path, ["rev-parse", "HEAD"]), head);
  assert.equal(await git(worktree.path, ["ls-files", "--stage", "nested"]), "");
  assert.deepEqual((await listChangedPaths(worktree)).sort(), [
    "change.txt",
    "nested/",
  ]);
  assert.equal(existsSync(marker), false);

  // The fixture is armed: a status enters a nested repository the index records.
  await runGit(worktree, ["add", "--all"]);
  await runGit(worktree, ["status", "--porcelain"]);
  assert.equal(existsSync(marker), true);
});

test("never enters a nested repository that an earlier commit recorded", async (context) => {
  const { worktree, marker } = await topicBranchWorktree(context);
  await createNestedRepository(worktree.path, marker);
  await runGit(worktree, ["add", "--all"]);
  await runGit(worktree, [
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.test",
    "commit",
    "--quiet",
    "-m",
    "test: record a gitlink",
  ]);

  assert.deepEqual(await listChangedPaths(worktree), []);
  assert.deepEqual(await listWorkingTreeChanges(worktree), {
    modified: [],
    untracked: [],
  });
  await assert.rejects(
    commitAll({ worktree, message: "feat(agent): change" }),
    NestedRepositoryError,
  );
  assert.equal(existsSync(marker), false);

  await runGit(worktree, ["status", "--porcelain"]);
  assert.equal(existsSync(marker), true);
});

test("refuses a nested repository when completing a merge and keeps the merge abortable", async (context) => {
  const { repository, worktree, head, marker } =
    await topicBranchWorktree(context);
  writeFileSync(join(repository, "main.txt"), "main\n");
  await git(repository, ["add", "main.txt"]);
  await git(repository, ["commit", "-m", "chore: advance main"]);
  await git(repository, ["push", "origin", "main"]);
  await git(worktree.path, ["fetch", "origin"]);
  await git(worktree.path, ["merge", "--no-ff", "--no-commit", "origin/main"]);
  await createNestedRepository(worktree.path, marker);

  await assert.rejects(
    commitConflictMerge({ worktree }),
    NestedRepositoryError,
  );
  assert.equal(await git(worktree.path, ["ls-files", "--stage", "nested"]), "");
  assert.equal(existsSync(marker), false);
  await abortConflictMerge(worktree);
  assert.equal(await git(worktree.path, ["rev-parse", "HEAD"]), head);
});

test("creates a detached session worktree from the latest origin/main", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);

  const result = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-0123456789abcdef",
  });

  assert.equal(
    result.path,
    realpathSync(join(worktreeRoot, "topic-0123456789abcdef")),
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
    name: "topic-0123456789abcdef",
  });
  await createBranch({
    worktree: first,
    branch: "feat/phase-8-t8.3-first",
  });
  writeFileSync(join(first.path, "work-in-progress.txt"), "keep\n");

  const second = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-0123456789abcdef",
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
    name: "topic-0123456789abcdef",
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
    name: "topic-0123456789abcdef",
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

test("keeps the executable mode recorded in the index under a restrictive umask", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);
  writeFileSync(join(repository, "script.sh"), "#!/bin/sh\necho synthetic\n");
  await git(repository, ["add", "script.sh"]);
  await git(repository, ["update-index", "--chmod=+x", "script.sh"]);
  await git(repository, ["commit", "-m", "chore: add a script"]);
  await git(repository, ["push", "origin", "main"]);

  const previousUmask = process.umask(0o077);
  let result;
  try {
    result = await ensureSessionWorktree({
      repositoryPath: repository,
      worktreeRoot,
      name: "topic-0123456789abcdef",
    });
  } finally {
    process.umask(previousUmask);
  }

  const { mode } = statSync(join(result.path, "script.sh"));
  assert.equal(
    mode & 0o111,
    0o111,
    "the checked-out script keeps every execute bit",
  );
});

test("records the published commit through an atomic rename", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-0123456789abcdef",
  });
  const publicationPath = join(worktree.gitDirectory, "agent-published-head");
  writeFileSync(`${publicationPath}.tmp`, "stale\n");
  const commit = "b".repeat(40);

  recordPublication(worktree, commit);

  assert.equal(readFileSync(publicationPath, "utf8"), `${commit}\n`);
  assert.equal(existsSync(`${publicationPath}.tmp`), false);
  assert.equal((statSync(publicationPath).mode & 0o777).toString(8), "600");
});
