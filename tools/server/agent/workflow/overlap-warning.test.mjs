import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  createBranch,
  ensureSessionWorktree,
  headCommit,
  recordPublication,
} from "../repository/worktrees.mjs";
import { createOverlapWarning } from "./overlap-warning.mjs";
import { createIdentifierNames } from "../repository/identifiers.mjs";

const executeFile = promisify(execFile);

const identifiers = createIdentifierNames({ salt: "a".repeat(64) });
const requestingSessionKey = "-1001234567890:7";
const requestingWorktreeName = identifiers.worktreeName(requestingSessionKey);
const otherSessionKey = "-1009999999999:3";
const otherWorktreeName = identifiers.worktreeName(otherSessionKey);

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

async function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-overlap-"));
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
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  writeFileSync(join(repository, "original.txt"), "synthetic\n");
  await git(repository, ["add", "README.md", "original.txt"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  return {
    directory: realpathSync(directory),
    repository: realpathSync(repository),
    worktreeRoot: join(realpathSync(directory), "worktrees"),
  };
}

async function topicWorktree({
  repository,
  worktreeRoot,
  name,
  branch,
  paths,
}) {
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name,
  });
  await createBranch({ worktree, branch });
  for (const path of paths) {
    writeFileSync(join(worktree.path, path), "synthetic\n");
  }
  return worktree;
}

function activePullRequest({ number = 321, result = "success" } = {}) {
  return {
    pull_request_number: number,
    session_key: otherSessionKey,
    delivered_result: result,
    is_owner_latest: 1,
  };
}

test("warns about the shared files of a published pull request of another topic", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: ["shared.txt", "other-only.txt"],
  });
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [activePullRequest()],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.match(report, /`shared\.txt`/u);
  assert.doesNotMatch(report, /other-only\.txt/u);
  assert.match(report, /PR #321/u);
  assert.match(report, /no garanteix que no hi hagi altres conflictes/u);
  assert.doesNotMatch(report, /n1009999999999|n1001234567890/u);
  assert.deepEqual(traces, [
    {
      updateIdentifier: 1001,
      sessionKey: requestingSessionKey,
      action: "overlap_warned",
      detail: "#321 0 local 1 paths",
    },
  ]);
  assert.doesNotMatch(traces[0].detail, /shared\.txt/u);
});

test("names a local work without naming its topic", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-unpublished-change",
    paths: ["shared.txt"],
  });
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.match(report, /una feina local d'un altre tema/u);
  assert.doesNotMatch(report, /PR #/u);
  assert.doesNotMatch(report, /n1009999999999/u);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].detail, "1 local 1 paths");
});

test("warns about nothing when no other work shares a path", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: ["other-only.txt"],
  });
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [activePullRequest()],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.equal(report, null);
  assert.deepEqual(traces, []);
});

test("never counts the worktree of the requesting topic", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [
      { ...activePullRequest(), session_key: requestingSessionKey },
    ],
    recordTrace: () => assert.fail("there is nothing to warn about"),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.equal(report, null);
});

test("never names the pull request the current change continues", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-continued-change",
    paths: ["shared.txt"],
  });
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [activePullRequest()],
    recordTrace: () => {},
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
    continuedPullRequestNumber: 321,
  });

  assert.doesNotMatch(report, /PR #321/u);
  // Its owner topic keeps the pending work it has not published yet.
  assert.match(report, /una feina local d'un altre tema/u);
});

test("never counts an archived worktree of another topic", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  const archivedPath = join(
    paths.worktreeRoot,
    `${otherWorktreeName}-before-1002`,
  );
  await executeFile("git", [
    "-C",
    paths.repository,
    "worktree",
    "add",
    "--detach",
    archivedPath,
    "origin/main",
  ]);
  writeFileSync(join(archivedPath, "shared.txt"), "archived\n");
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [],
    recordTrace: () => assert.fail("there is nothing to warn about"),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.equal(report, null);
});

test("keeps counting the new local work of a topic whose pull request is closed", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-new-change",
    paths: ["shared.txt"],
  });
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [
      activePullRequest({ result: "pull-request-closed" }),
    ],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.doesNotMatch(report, /PR #321/u);
  assert.match(report, /una feina local d'un altre tema/u);
  assert.equal(traces[0].detail, "1 local 1 paths");
});

test("warns about a pull request whose latest notice is not delivered yet", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: ["shared.txt"],
  });
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    // A notice still being delivered proves nothing, closed or not.
    listPullRequests: () => [activePullRequest({ result: null })],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.match(report, /PR #321/u);
  assert.equal(traces[0].detail, "#321 0 local 1 paths");
});

test("never counts twice a topic reported as its published pull request", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: ["shared.txt"],
  });
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [activePullRequest()],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.match(report, /PR #321/u);
  assert.doesNotMatch(report, /feina local/u);
  assert.equal(traces[0].detail, "#321 0 local 1 paths");
});

test("skips a pull request that is not the newest publication of its topic", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-newer-change",
    paths: ["shared.txt"],
  });
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [
      { ...activePullRequest(), is_owner_latest: 0 },
      { ...activePullRequest({ number: 322 }), is_owner_latest: 1 },
    ],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.match(report, /PR #322/u);
  assert.doesNotMatch(report, /PR #321/u);
  assert.equal(traces.length, 1);
});

test("never attributes a published pull request to a foreign branch", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  const foreign = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
  });
  await git(foreign.path, ["checkout", "-b", "feature/not-a-service-branch"]);
  writeFileSync(join(foreign.path, "shared.txt"), "synthetic\n");
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [activePullRequest()],
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.doesNotMatch(report, /PR #321/u);
  assert.match(report, /una feina local d'un altre tema/u);
});

test("counts local work only while it has something to publish", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  const other = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: [],
  });
  writeFileSync(join(other.path, "shared.txt"), "other topic\n");
  await git(other.path, ["add", "shared.txt"]);
  await git(other.path, ["commit", "-m", "feat(tools): add a shared file"]);
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [],
  });
  const warningRequest = {
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  };

  assert.match(
    await warnAboutOverlaps(warningRequest),
    /una feina local d'un altre tema/u,
    "an unpublished commit is pending work",
  );

  recordPublication(other, await headCommit(other));
  assert.equal(
    await warnAboutOverlaps(warningRequest),
    null,
    "a published commit of a clean worktree is not pending work",
  );
});

test("lists ten sorted paths from every work and the count of the rest", async (context) => {
  const paths = await fixture(context);
  const sharedPaths = Array.from(
    { length: 12 },
    (_, index) => `path-${String(index + 1).padStart(2, "0")}.txt`,
  );
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: sharedPaths,
  });
  // Unsorted on purpose, and split over two works.
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: ["path-07.txt", "path-01.txt", "path-11.txt", "path-04.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: identifiers.worktreeName("-1009999999998:5"),
    branch: "feat/tools-third-change",
    paths: [
      "path-09.txt",
      "path-02.txt",
      "path-12.txt",
      "path-05.txt",
      "path-03.txt",
      "path-06.txt",
      "path-08.txt",
      "path-10.txt",
    ],
  });
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [],
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  const shownPaths = sharedPaths.slice(0, 10).map((path) => `\`${path}\``);
  assert.equal(
    report.split("\n")[0],
    `Avís de solapament: aquests fitxers també apareixen en feines actives conegudes: ${shownPaths.join(", ")} i 2 més.`,
  );
});

test("counts both sides of a rename", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: [],
  });
  // A different content, or Git would see the tracked file as unchanged.
  writeFileSync(join(current.path, "original.txt"), "current change\n");
  writeFileSync(join(current.path, "renamed.txt"), "current change\n");
  const other = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-renamed-change",
    paths: [],
  });
  await git(other.path, ["mv", "original.txt", "renamed.txt"]);
  await git(other.path, ["commit", "-m", "refactor(tools): rename a file"]);
  const traces = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [],
    recordTrace: (entry) => traces.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.match(report, /`original\.txt`/u);
  assert.match(report, /`renamed\.txt`/u);
  assert.equal(traces[0].detail, "1 local 2 paths");
});

test("counts both sides of an uncommitted rename", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: [],
  });
  await git(current.path, ["mv", "original.txt", "renamed.txt"]);
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: [],
  });
  // Both sides of the rename are changed elsewhere; the tracked file needs a
  // different content, or Git would not see it modified.
  for (const path of ["original.txt", "renamed.txt"]) {
    writeFileSync(
      join(paths.worktreeRoot, otherWorktreeName, path),
      "other topic\n",
    );
  }
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [],
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  assert.match(report, /`original\.txt`/u);
  assert.match(report, /`renamed\.txt`/u);
});

test("never warns about the work of a merged pull request", async (context) => {
  const paths = await fixture(context);
  const current = await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: requestingWorktreeName,
    branch: "feat/tools-current-change",
    paths: ["shared.txt"],
  });
  await topicWorktree({
    repository: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    name: otherWorktreeName,
    branch: "feat/tools-other-change",
    paths: ["shared.txt"],
  });
  const traced = [];
  const warnAboutOverlaps = createOverlapWarning({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktreeRoot,
    identifiers,
    listPullRequests: () => [activePullRequest()],
    // The change is already in the project: its old branch is not active work.
    isMerged: () => true,
    recordTrace: (entry) => traced.push(entry),
  });

  const report = await warnAboutOverlaps({
    updateIdentifier: 1001,
    sessionKey: requestingSessionKey,
    worktree: current,
    branch: "feat/tools-current-change",
  });

  // The merged pull request is not named as active work. The other worktree is
  // reported as local work, because no active pull request explains it.
  assert.doesNotMatch(report, /PR #321/u);
  assert.match(report, /una feina local/u);
});
