import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  assertWorkBranch,
  changeDiff,
  commitAll,
  createBranch,
  currentBranch,
  ensureSessionWorktree,
  hasUnpublishedCommit,
  recordPublication,
  resumeWorkBranch,
  workBranchRefusals,
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
      name: "topic_n1001234567890_7",
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

test("clips a diff larger than the limit instead of dropping it", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic_n1001234567890_7",
  });
  await createBranch({ worktree, branch: "fix/large-diff" });
  writeFileSync(
    join(worktree.path, "large.txt"),
    "synthetic line\n".repeat(500),
  );
  await commitAll({ worktree, message: "feat: add a large file" });

  const diff = await changeDiff({ worktree, maximumBytes: 1000 });

  assert.equal(diff.length, 1000);
  assert.match(diff, /^diff --git a\/large\.txt/u);
  assert.match(await changeDiff({ worktree }), /synthetic line\n$/u);
});

const sharedBranch = "feat/phase-8-t8.4-shared";

/** Publish one commit of the shared branch in a worktree that holds it. */
async function publishedHolder({ repository, worktreeRoot, name }) {
  const holder = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name,
  });
  await createBranch({ worktree: holder, branch: sharedBranch });
  writeFileSync(join(holder.path, "change.txt"), "canvi\n");
  const commit = await commitAll({
    worktree: holder,
    message: "feat: shared change",
  });
  await git(holder.path, ["push", "origin", `HEAD:refs/heads/${sharedBranch}`]);
  recordPublication(holder, commit);
  return { holder, commit };
}

test("resumes a published branch at its head and preserves the session worktree", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);
  const { holder, commit } = await publishedHolder({
    repository,
    worktreeRoot,
    name: "topic-holder",
  });
  const previous = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-new",
  });
  writeFileSync(join(previous.path, "previous.txt"), "preserved\n");

  const resumed = await resumeWorkBranch({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-new",
    branch: sharedBranch,
    headSha: commit,
    newTaskIdentifier: 2001,
  });

  assert.equal(resumed.worktree.path, previous.path);
  assert.equal(await currentBranch(resumed.worktree), sharedBranch);
  assert.equal(await git(resumed.worktree.path, ["rev-parse", "HEAD"]), commit);
  assert.equal(
    await currentBranch(holder),
    null,
    "the holder releases the branch",
  );
  assert.equal(
    readFileSync(
      join(realpathSync(worktreeRoot), "topic-new-before-2001", "previous.txt"),
      "utf8",
    ),
    "preserved\n",
  );
  assert.equal(await hasUnpublishedCommit(resumed.worktree), false);
});

test("resumes a branch that an archived worktree still holds", async (context) => {
  const { repository, worktreeRoot } = await repositoryFixture(context);
  const { commit } = await publishedHolder({
    repository,
    worktreeRoot,
    name: "topic-old-before-7",
  });

  const resumed = await resumeWorkBranch({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-old",
    branch: sharedBranch,
    headSha: commit,
    newTaskIdentifier: 2002,
  });

  assert.equal(await currentBranch(resumed.worktree), sharedBranch);
  assert.equal(await git(resumed.worktree.path, ["rev-parse", "HEAD"]), commit);
});

for (const scenario of [
  {
    name: "uncommitted changes",
    refusal: workBranchRefusals.dirtyWorktree,
    prepare: (holder) =>
      writeFileSync(join(holder.path, "pending.txt"), "pending\n"),
  },
  {
    name: "unpublished commits",
    refusal: workBranchRefusals.unpublishedCommits,
    prepare: async (holder) => {
      writeFileSync(join(holder.path, "change.txt"), "canvi 2\n");
      await commitAll({ worktree: holder, message: "feat: unpublished" });
    },
  },
  {
    name: "a local branch outside the remote head",
    refusal: workBranchRefusals.divergedBranch,
    prepare: async (holder) => {
      await git(holder.path, ["commit", "--amend", "-m", "feat: rewritten"]);
      recordPublication(holder, await git(holder.path, ["rev-parse", "HEAD"]));
    },
  },
]) {
  test(`refuses to release the branch with ${scenario.name}`, async (context) => {
    const { repository, worktreeRoot } = await repositoryFixture(context);
    const { holder, commit } = await publishedHolder({
      repository,
      worktreeRoot,
      name: "topic-holder",
    });
    await scenario.prepare(holder);

    const resumed = await resumeWorkBranch({
      repositoryPath: repository,
      worktreeRoot,
      name: "topic-new",
      branch: sharedBranch,
      headSha: commit,
      newTaskIdentifier: 2003,
    });

    assert.equal(resumed.refusal, scenario.refusal);
    assert.equal(await currentBranch(holder), sharedBranch);
    assert.equal(
      existsSync(join(realpathSync(worktreeRoot), "topic-new")),
      false,
      "no worktree is created after a refusal",
    );
  });
}

test("refuses a resume when the remote head moved", async (context) => {
  const { origin, repository, worktreeRoot } = await repositoryFixture(context);
  const { commit } = await publishedHolder({
    repository,
    worktreeRoot,
    name: "topic-holder",
  });

  const resumed = await resumeWorkBranch({
    repositoryPath: repository,
    worktreeRoot,
    name: "topic-new",
    branch: sharedBranch,
    headSha: await git(origin, ["rev-parse", "main"]),
    newTaskIdentifier: 2004,
  });

  assert.equal(resumed.refusal, workBranchRefusals.movedHead);
  assert.notEqual(commit, await git(origin, ["rev-parse", "main"]));
  assert.equal(
    existsSync(join(realpathSync(worktreeRoot), "topic-new")),
    false,
  );
});
