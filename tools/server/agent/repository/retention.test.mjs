import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { ensureSessionWorktree } from "./worktrees.mjs";
import { pruneArchivedWorktrees } from "./retention.mjs";

const executeFile = promisify(execFile);
const topic = "topic_n1001234567890_7";

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
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-retention-"));
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

  return { repository, worktreeRoot };
}

function archivePath(paths, updateIdentifier) {
  return join(
    realpathSync(paths.worktreeRoot),
    `${topic}-before-${updateIdentifier}`,
  );
}

function newTask(paths, updateIdentifier) {
  return ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
    newTaskIdentifier: updateIdentifier,
  });
}

test("removes an older empty archive and keeps the newest one per topic", async (context) => {
  const paths = await repositoryFixture(context);
  await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  const active = await newTask(paths, 100);
  await newTask(paths, 200);
  await newTask(paths, 300);

  const report = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
  });

  assert.deepEqual(report.removed.map((entry) => entry.path).sort(), [
    archivePath(paths, 100),
    archivePath(paths, 200),
  ]);
  assert.equal(existsSync(archivePath(paths, 100)), false);
  assert.equal(existsSync(archivePath(paths, 200)), false);
  assert.equal(existsSync(archivePath(paths, 300)), true);
  assert.equal(existsSync(active.path), true);
  assert.deepEqual(
    report.kept.map((entry) => entry.reason),
    ["newest_archive"],
  );
});

test("keeps an archive with unpublished commits or uncommitted changes", async (context) => {
  const paths = await repositoryFixture(context);
  await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  await newTask(paths, 100);
  await newTask(paths, 200);
  const active = await newTask(paths, 300);

  await git(archivePath(paths, 100), [
    "commit",
    "--allow-empty",
    "-m",
    "feat: local",
  ]);
  writeFileSync(join(archivePath(paths, 200), "draft.txt"), "unpublished\n");

  const report = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
  });

  assert.deepEqual(report.removed, []);
  assert.equal(existsSync(archivePath(paths, 100)), true);
  assert.equal(existsSync(archivePath(paths, 200)), true);
  assert.deepEqual(
    report.kept
      .map((entry) => entry.reason)
      .sort((first, second) => first.localeCompare(second)),
    ["newest_archive", "uncommitted_changes", "unpublished_commits"],
  );
  assert.ok(existsSync(archivePath(paths, 300)));
  assert.ok(existsSync(active.path));
});

test("never removes the active worktree and honours a dry run", async (context) => {
  const paths = await repositoryFixture(context);
  await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  const active = await newTask(paths, 100);
  await newTask(paths, 200);
  await newTask(paths, 300);

  const planned = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    dryRun: true,
  });

  assert.deepEqual(planned.removed.map((entry) => entry.path).sort(), [
    archivePath(paths, 100),
    archivePath(paths, 200),
  ]);
  assert.equal(
    existsSync(archivePath(paths, 100)),
    true,
    "a dry run reports the plan without removing anything",
  );
  assert.equal(existsSync(archivePath(paths, 300)), true);
  assert.equal(existsSync(active.path), true);
});
