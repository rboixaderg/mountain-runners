import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createBranch,
  ensureSessionWorktree,
  recordPublication,
  stripWorktreeDependencies,
} from "./worktrees.mjs";
import { pruneFinishedTopicWorktrees } from "./retention.mjs";
import { createIdentifierNames } from "./identifiers.mjs";
import { registeredWorktree, runGit } from "./trusted-git.mjs";
import { createNestedRepository } from "./test-support/nested-repository.mjs";
import { createGitRepository, git } from "./test-support/git-repository.mjs";

const topic = "topic-0123456789abcdef";
const identifiers = createIdentifierNames({ salt: "a".repeat(64) });

async function repositoryFixture(context) {
  const { directory, repository } = await createGitRepository(
    context,
    "mr-agent-retention-",
    {
      "README.md": "synthetic\n",
      ".gitignore": "node_modules/\n.agent-runtime-tmp/\n",
    },
  );
  const worktreeRoot = join(directory, "worktrees");

  return { directory, repository, worktreeRoot };
}

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

/** The worktree of a topic whose merged pull request holds a published commit. */
async function mergedTopic(context) {
  const paths = await repositoryFixture(context);
  const sessionKey = "-100123:8";
  const branch = "fix/merged-topic-0008";
  const worktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName(sessionKey),
  });
  await createBranch({ worktree, branch });
  const prune = () =>
    pruneFinishedTopicWorktrees({
      repositoryPath: paths.repository,
      worktreeRoot: paths.worktreeRoot,
      bindings: [{ sessionKey, branch, pullRequestNumber: 301 }],
      worktreeNameForSession: (key) => identifiers.worktreeName(key),
      readPullRequest: async () => ({
        state: "closed",
        merged: true,
        headRef: branch,
      }),
    });
  return { ...paths, worktree, prune };
}

test("never enters a nested repository that a finished topic records", async (context) => {
  const { directory, worktree, prune } = await mergedTopic(context);
  const marker = join(directory, "filter-ran");
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

  const report = await prune();

  assert.deepEqual(report.kept, [
    { path: worktree.path, reason: "unpublished_commits" },
  ]);
  assert.equal(existsSync(marker), false);
  await runGit(worktree, ["status", "--porcelain"]);
  assert.equal(existsSync(marker), true);
});

test("keeps a damaged finished topic worktree for a person", async (context) => {
  const { worktree, prune } = await mergedTopic(context);
  writeFileSync(join(worktree.path, ".git"), "damaged\n");

  const report = await prune();

  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.kept, [
    { path: worktree.path, reason: "inspection_failed" },
  ]);
  assert.equal(existsSync(worktree.path), true);
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
