import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { GitHubTrust } from "./github.mjs";
import { createBranch, ensureSessionWorktree } from "./worktrees.mjs";

const executeFile = promisify(execFile);
const repository = "rboixaderg/mountain-runners";
const githubToken = "ghp_synthetic_token_for_tests";
const branch = "feat/phase-8-t8.3-telegram-bridge";

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
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-github-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );

  const origin = join(directory, "origin.git");
  const clone = join(directory, "repository");
  const worktreeRoot = join(directory, "worktrees");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, clone]);
  writeFileSync(join(clone, "README.md"), "synthetic\n");
  await git(clone, ["add", "README.md"]);
  await git(clone, ["commit", "-m", "chore: initial"]);
  await git(clone, ["push", "origin", "main"]);
  await git(clone, [
    "remote",
    "set-url",
    "origin",
    `https://github.com/${repository}.git`,
  ]);
  await git(clone, [
    "config",
    `url.${origin}.insteadOf`,
    `https://github.com/${repository}.git`,
  ]);
  return { directory, origin, clone, worktreeRoot };
}

async function branchWorktree({ repository, worktreeRoot, branch, name }) {
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot,
    name,
  });
  await createBranch({ worktree, branch });
  return worktree;
}

function trust(overrides = {}) {
  return new GitHubTrust({
    token: githubToken,
    repository,
    ...overrides,
  });
}

test("pushes a work branch and returns its commit", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-first",
  });
  writeFileSync(join(worktree.path, "change.txt"), "canvi\n");
  await git(worktree.path, ["add", "change.txt"]);
  await git(worktree.path, ["commit", "-m", "feat: synthetic change"]);

  const result = await trust().pushBranch({
    worktree,
    branch,
    secrets: [githubToken],
  });

  assert.equal(result.branch, branch);
  assert.equal(result.commit, await git(origin, ["rev-parse", branch]));
});

test("refuses to publish a worktree that contains a live credential", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-leak",
  });
  writeFileSync(join(worktree.path, "leaked.env"), `TOKEN=${githubToken}\n`);

  await assert.rejects(
    trust().pushBranch({
      worktree,
      branch,
      secrets: [githubToken],
    }),
    { message: /contains a live credential/u },
  );
  await assert.rejects(git(origin, ["rev-parse", branch]));
});

test("rejects main and a worktree with another origin", async (context) => {
  const { directory, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-main",
  });

  await assert.rejects(trust().pushBranch({ worktree, branch: "main" }), {
    message: /never writes to main/u,
  });

  const otherRepository = join(directory, "other");
  await executeFile("git", [
    "clone",
    join(directory, "origin.git"),
    otherRepository,
  ]);
  const otherBranch = "fix/phase-8-t8.3-other-origin";
  const otherWorktree = await branchWorktree({
    repository: otherRepository,
    worktreeRoot,
    branch: otherBranch,
    name: "topic-other",
  });
  await git(otherRepository, [
    "remote",
    "set-url",
    "origin",
    "https://github.com/someone/else.git",
  ]);
  await assert.rejects(
    trust().pushBranch({
      worktree: otherWorktree,
      branch: otherBranch,
    }),
    { message: /not the configured repository/u },
  );
});

test("reuses an open pull request and creates one only when absent", async (context) => {
  const { clone, worktreeRoot } = await repositoryFixture(context);
  await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-api",
  });
  const calls = [];
  let pulls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return { ok: true, json: async () => pulls };
    }
    return {
      ok: true,
      json: async () => ({
        number: 200,
        html_url: "https://github.com/rboixaderg/mountain-runners/pull/200",
        head: { sha: "abc123" },
        draft: false,
        base: { ref: "main" },
      }),
    };
  };
  const component = trust({ fetchImpl });

  const created = await component.ensurePullRequest({
    branch,
    title: "feat(phase-8-t8.3): bridge",
    body: "Descripció",
  });

  assert.equal(created.created, true);
  assert.equal(created.pullRequest.number, 200);
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    `https://api.github.com/repos/${repository}/pulls?state=open&head=rboixaderg%3A${encodeURIComponent(branch)}`,
  );
  assert.equal(
    calls[1].url,
    `https://api.github.com/repos/${repository}/pulls`,
  );
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.authorization, `Bearer ${githubToken}`);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    title: "feat(phase-8-t8.3): bridge",
    body: "Descripció",
    head: branch,
    base: "main",
    draft: false,
  });

  pulls = [
    {
      number: 200,
      html_url: "https://github.com/rboixaderg/mountain-runners/pull/200",
      head: { sha: "abc123" },
      draft: false,
      base: { ref: "main" },
    },
  ];
  const reused = await trust({ fetchImpl }).ensurePullRequest({
    branch,
    title: "duplicate",
    body: "duplicate",
  });

  assert.equal(reused.created, false);
  assert.equal(reused.pullRequest.number, 200);
  assert.equal(
    calls.filter((call) => call.options.method === "POST").length,
    1,
  );
});

test("reports a pull request API failure without exposing the token", async () => {
  const component = trust({
    fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({}) }),
  });

  await assert.rejects(
    component.ensurePullRequest({ branch, title: "t", body: "b" }),
    (error) => {
      assert.match(error.message, /HTTP 422/u);
      assert.equal(error.message.includes(githubToken), false);
      return true;
    },
  );
});

test("rejects a base branch other than main at construction", () => {
  assert.throws(() => trust({ baseBranch: "develop" }), {
    message: /main base branch/u,
  });
});

test("rejects an invalid branch before calling the API", async () => {
  const calls = [];
  const component = trust({
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => [] };
    },
  });

  await assert.rejects(
    component.findOpenPullRequest({ branch: "feat/Invalid" }),
    {
      message: /Invalid work branch/u,
    },
  );
  assert.deepEqual(calls, []);
});

test("exposes only branch push and pull request operations", () => {
  const publicOperations = Object.getOwnPropertyNames(GitHubTrust.prototype)
    .filter((name) => name !== "constructor")
    .sort();

  assert.deepEqual(publicOperations, [
    "ensurePullRequest",
    "findOpenPullRequest",
    "pushBranch",
  ]);
});
