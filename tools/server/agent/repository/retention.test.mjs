import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  createBranch,
  ensureSessionWorktree,
  recordPublication,
  stripWorktreeDependencies,
} from "./worktrees.mjs";
import {
  pruneArchivedWorktrees,
  pruneFinishedTopicWorktrees,
} from "./retention.mjs";
import { createIdentifierNames } from "./identifiers.mjs";
import { registeredWorktree } from "./trusted-git.mjs";

const executeFile = promisify(execFile);
const topic = "topic-0123456789abcdef";
const identifiers = createIdentifierNames({ salt: "a".repeat(64) });

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
  writeFileSync(
    join(repository, ".gitignore"),
    "node_modules/\n.agent-runtime-tmp/\n",
  );
  await git(repository, ["add", "README.md", ".gitignore"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  return { repository, worktreeRoot };
}

function archivePath(paths, updateIdentifier) {
  return join(
    realpathSync(paths.worktreeRoot),
    identifiers.archiveName(topic, updateIdentifier),
  );
}

function newTask(paths, updateIdentifier) {
  return ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
    newTaskSuffix: identifiers.changeSuffix(updateIdentifier),
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

  assert.deepEqual(
    report.removed.map((entry) => entry.path).sort(),
    [archivePath(paths, 100), archivePath(paths, 200)].sort(),
  );
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

  assert.deepEqual(
    planned.removed.map((entry) => entry.path).sort(),
    [archivePath(paths, 100), archivePath(paths, 200)].sort(),
  );
  assert.equal(
    existsSync(archivePath(paths, 100)),
    true,
    "a dry run reports the plan without removing anything",
  );
  assert.equal(existsSync(archivePath(paths, 300)), true);
  assert.equal(existsSync(active.path), true);
});

test("keeps the most recently archived worktree of a topic, not the biggest suffix", async (context) => {
  const paths = await repositoryFixture(context);
  await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  // The suffixes are opaque HMAC values: creation order and suffix order do not
  // match, so the newest archive can only be recognised by the directory.
  await newTask(paths, 300);
  await newTask(paths, 200);
  const newest = await newTask(paths, 100);

  const report = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
  });

  assert.deepEqual(
    report.removed.map((entry) => entry.path).sort(),
    [archivePath(paths, 200), archivePath(paths, 300)].sort(),
  );
  assert.deepEqual(
    report.kept.map((entry) => entry.path),
    [archivePath(paths, 100)],
  );
  assert.equal(existsSync(archivePath(paths, 100)), true);
  assert.equal(existsSync(newest.path), true);
});

test("returns an empty report when the worktree root does not exist", async (context) => {
  const paths = await repositoryFixture(context);

  const report = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: join(paths.worktreeRoot, "missing"),
  });

  assert.deepEqual(report, { removed: [], kept: [], cleaned: [] });
});

test("keeps pruning after a damaged archive", async (context) => {
  const paths = await repositoryFixture(context);
  await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  await newTask(paths, 100);
  await newTask(paths, 200);
  await newTask(paths, 300);
  // The archive birth time, not the opaque suffix, decides which one is newest.
  const planned = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    dryRun: true,
  });
  const [damaged, prunable] = planned.removed.map((entry) => entry.path).sort();
  writeFileSync(join(damaged, ".git"), "damaged\n");

  const report = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    logger: () => {},
  });

  assert.deepEqual(
    report.removed.map((entry) => entry.path),
    [prunable],
  );
  assert.deepEqual(
    report.kept.filter((entry) => entry.reason === "inspection_failed"),
    [{ path: damaged, reason: "inspection_failed" }],
  );
  assert.equal(
    existsSync(damaged),
    true,
    "the damaged archive is kept for a person",
  );
  assert.equal(existsSync(prunable), false);
});

function populateGeneratedDependencies(worktreePath) {
  for (const relativePath of [
    "node_modules/.pnpm",
    "apps/web/node_modules",
    "packages/telegram-pi-bridge/node_modules",
    ".agent-runtime-tmp",
  ]) {
    mkdirSync(join(worktreePath, relativePath), { recursive: true });
    writeFileSync(
      join(worktreePath, relativePath, "marker.txt"),
      "generated\n",
    );
  }
}

test("strips generated dependencies on archive creation and on kept archives", async (context) => {
  const paths = await repositoryFixture(context);
  const first = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  populateGeneratedDependencies(first.path);

  await newTask(paths, 100);
  const archived = archivePath(paths, 100);
  assert.equal(existsSync(join(archived, "node_modules")), false);
  assert.equal(existsSync(join(archived, "apps/web/node_modules")), false);
  assert.equal(
    existsSync(join(archived, "packages/telegram-pi-bridge/node_modules")),
    false,
  );
  assert.equal(existsSync(join(archived, ".agent-runtime-tmp")), false);
  assert.equal(existsSync(join(archived, "README.md")), true);

  // Re-populate dependencies on the kept newest archive to exercise retention.
  populateGeneratedDependencies(archived);
  const planned = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    dryRun: true,
  });
  assert.equal(planned.cleaned.length, 1);
  assert.equal(existsSync(join(archived, "node_modules")), true);

  const applied = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
  });
  assert.deepEqual(applied.cleaned, [
    {
      path: archived,
      directories: [
        "node_modules",
        "apps/web/node_modules",
        "packages/telegram-pi-bridge/node_modules",
        ".agent-runtime-tmp",
      ],
    },
  ]);
  assert.equal(existsSync(join(archived, "node_modules")), false);
  assert.equal(existsSync(join(archived, ".agent-runtime-tmp")), false);
  assert.equal(existsSync(join(archived, "README.md")), true);
});

test("never follows symlinks when stripping generated dependencies", async (context) => {
  const paths = await repositoryFixture(context);
  const worktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  const outside = mkdtempSync(join(tmpdir(), "mr-agent-symlink-target-"));
  context.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(outside, "node_modules"), { recursive: true });
  writeFileSync(join(outside, "node_modules", "secret.txt"), "untouched\n");
  writeFileSync(join(outside, "secret-root.txt"), "untouched\n");

  symlinkSync(outside, join(worktree.path, "node_modules"));
  mkdirSync(join(worktree.path, "apps"), { recursive: true });
  symlinkSync(outside, join(worktree.path, "apps", "web"));
  symlinkSync(outside, join(worktree.path, ".agent-runtime-tmp"));

  const cleaned = stripWorktreeDependencies(worktree.path);
  assert.deepEqual(cleaned, []);
  assert.equal(existsSync(join(outside, "secret-root.txt")), true);
  assert.equal(existsSync(join(outside, "node_modules", "secret.txt")), true);
});

test("keeps an older archived worktree ahead of origin/main even when published and strips its dependencies", async (context) => {
  const paths = await repositoryFixture(context);
  const first = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: topic,
  });
  await createBranch({
    worktree: first,
    branch: "fix/published-archive-0001",
  });
  await git(first.path, ["commit", "--allow-empty", "-m", "fix: published"]);
  const publishedHead = await git(first.path, ["rev-parse", "HEAD"]);
  recordPublication(first, publishedHead);

  await newTask(paths, 100);
  await newTask(paths, 200);
  populateGeneratedDependencies(archivePath(paths, 100));

  const report = await pruneArchivedWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
  });

  assert.deepEqual(report.removed, []);
  assert.equal(existsSync(archivePath(paths, 100)), true);
  assert.equal(
    existsSync(join(archivePath(paths, 100), "node_modules")),
    false,
  );
  assert.deepEqual(
    report.kept
      .map((entry) => entry.reason)
      .sort((firstReason, secondReason) =>
        firstReason.localeCompare(secondReason),
      ),
    ["newest_archive", "unpublished_commits"],
  );
});

test("prunes clean published worktrees of merged pull requests and strips closed-unmerged or dirty ones", async (context) => {
  const paths = await repositoryFixture(context);
  const mergedSession = "-100123:1";
  const closedUnmergedSession = "-100123:7";
  const dirtyClosedSession = "-100123:2";
  const openSession = "-100123:3";
  const missingSession = "-100123:4";

  const mergedWorktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName(mergedSession),
  });
  await createBranch({
    worktree: mergedWorktree,
    branch: "fix/squash-merged-0001",
  });
  await git(mergedWorktree.path, [
    "commit",
    "--allow-empty",
    "-m",
    "fix: merged",
  ]);
  recordPublication(
    mergedWorktree,
    await git(mergedWorktree.path, ["rev-parse", "HEAD"]),
  );
  populateGeneratedDependencies(mergedWorktree.path);

  const closedUnmergedWorktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName(closedUnmergedSession),
  });
  await createBranch({
    worktree: closedUnmergedWorktree,
    branch: "fix/closed-unmerged-0007",
  });
  await git(closedUnmergedWorktree.path, [
    "commit",
    "--allow-empty",
    "-m",
    "fix: unmerged",
  ]);
  recordPublication(
    closedUnmergedWorktree,
    await git(closedUnmergedWorktree.path, ["rev-parse", "HEAD"]),
  );
  populateGeneratedDependencies(closedUnmergedWorktree.path);

  const dirtyWorktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName(dirtyClosedSession),
  });
  await createBranch({
    worktree: dirtyWorktree,
    branch: "fix/closed-dirty-0002",
  });
  writeFileSync(join(dirtyWorktree.path, "local.txt"), "keep me\n");
  populateGeneratedDependencies(dirtyWorktree.path);

  const openWorktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName(openSession),
  });
  await createBranch({
    worktree: openWorktree,
    branch: "fix/still-open-0003",
  });
  populateGeneratedDependencies(openWorktree.path);

  const consultedPullRequests = [];
  const bindings = [
    {
      sessionKey: mergedSession,
      branch: "fix/squash-merged-0001",
      pullRequestNumber: 101,
    },
    {
      sessionKey: closedUnmergedSession,
      branch: "fix/closed-unmerged-0007",
      pullRequestNumber: 105,
    },
    {
      sessionKey: dirtyClosedSession,
      branch: "fix/closed-dirty-0002",
      pullRequestNumber: 102,
    },
    {
      sessionKey: openSession,
      branch: "fix/still-open-0003",
      pullRequestNumber: 103,
    },
    {
      sessionKey: missingSession,
      branch: "fix/already-removed-0004",
      pullRequestNumber: 104,
    },
  ];
  const pullRequests = new Map([
    [101, { state: "closed", merged: true, headRef: "fix/squash-merged-0001" }],
    [
      105,
      { state: "closed", merged: false, headRef: "fix/closed-unmerged-0007" },
    ],
    [102, { state: "closed", merged: true, headRef: "fix/closed-dirty-0002" }],
    [103, { state: "open", merged: false, headRef: "fix/still-open-0003" }],
  ]);
  const readPullRequest = async (number) => {
    consultedPullRequests.push(number);
    return pullRequests.get(number);
  };

  const dryRunEvents = [];
  const planned = await pruneFinishedTopicWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    bindings,
    worktreeNameForSession: (key) => identifiers.worktreeName(key),
    readPullRequest,
    dryRun: true,
    logger: (event) => dryRunEvents.push(event),
  });
  assert.deepEqual(consultedPullRequests, [101, 105, 102, 103]);
  assert.deepEqual(dryRunEvents, []);
  assert.deepEqual(
    planned.removed.map((entry) => entry.pullRequestNumber),
    [101],
  );
  assert.equal(existsSync(mergedWorktree.path), true);
  assert.equal(
    existsSync(join(closedUnmergedWorktree.path, "node_modules")),
    true,
  );
  assert.equal(existsSync(join(dirtyWorktree.path, "node_modules")), true);

  const applied = await pruneFinishedTopicWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    bindings,
    worktreeNameForSession: (key) => identifiers.worktreeName(key),
    readPullRequest,
  });
  assert.deepEqual(
    applied.removed.map((entry) => entry.pullRequestNumber),
    [101],
  );
  assert.equal(existsSync(mergedWorktree.path), false);
  const branches = await git(paths.repository, [
    "branch",
    "--list",
    "fix/squash-merged-0001",
  ]);
  assert.equal(branches, "");
  assert.deepEqual(applied.kept, [
    { path: closedUnmergedWorktree.path, reason: "unmerged_pull_request" },
    { path: dirtyWorktree.path, reason: "uncommitted_changes" },
  ]);
  assert.equal(existsSync(closedUnmergedWorktree.path), true);
  assert.equal(
    existsSync(join(closedUnmergedWorktree.path, "node_modules")),
    false,
  );
  assert.equal(existsSync(join(dirtyWorktree.path, "local.txt")), true);
  assert.equal(existsSync(join(dirtyWorktree.path, "node_modules")), false);
  assert.equal(existsSync(join(openWorktree.path, "node_modules")), true);
});

test("keeps a closed topic worktree on branch mismatch or GitHub read failure", async (context) => {
  const paths = await repositoryFixture(context);
  const mismatchSession = "-100123:5";
  const unreadableSession = "-100123:6";

  const mismatchWorktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName(mismatchSession),
  });
  await createBranch({
    worktree: mismatchWorktree,
    branch: "fix/different-branch-0005",
  });
  populateGeneratedDependencies(mismatchWorktree.path);

  const unreadableWorktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName(unreadableSession),
  });
  populateGeneratedDependencies(unreadableWorktree.path);

  // Confirm registeredWorktree is healthy before retention runs.
  assert.ok(registeredWorktree(paths.repository, mismatchWorktree.path));

  const report = await pruneFinishedTopicWorktrees({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    bindings: [
      {
        sessionKey: mismatchSession,
        branch: "fix/original-branch-0005",
        pullRequestNumber: 201,
      },
      {
        sessionKey: unreadableSession,
        branch: "fix/unreadable-0006",
        pullRequestNumber: 202,
      },
    ],
    worktreeNameForSession: (key) => identifiers.worktreeName(key),
    readPullRequest: async (number) => {
      if (number === 202) {
        throw new Error("GitHub unavailable");
      }
      return { state: "closed" };
    },
  });

  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.cleaned, []);
  assert.deepEqual(report.kept, [
    { path: mismatchWorktree.path, reason: "branch_mismatch" },
    { path: unreadableWorktree.path, reason: "pull_request_unreadable" },
  ]);
  assert.equal(existsSync(join(mismatchWorktree.path, "node_modules")), true);
  assert.equal(existsSync(join(unreadableWorktree.path, "node_modules")), true);
});
