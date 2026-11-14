import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { GitHubTrust, PublishRefusedError } from "./github.mjs";
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
  mkdirSync(join(clone, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(clone, ".github", "workflows", "trusted.yml"),
    "synthetic baseline workflow\n",
  );
  await git(clone, ["add", "--all"]);
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

test("does not publish uninspected tags even when followTags is configured", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-tags",
  });
  writeFileSync(join(worktree.path, "change.txt"), "safe change\n");
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, ["commit", "-m", "test: safe change"]);
  await git(worktree.path, ["tag", "-a", "private-tag", "-m", githubToken]);
  await git(clone, ["config", "push.followTags", "true"]);
  await trust().pushBranch({ worktree, branch, secrets: [githubToken] });
  assert.equal(await git(origin, ["tag", "--list"]), "");
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
  await git(worktree.path, ["add", "leaked.env"]);
  await git(worktree.path, ["commit", "-m", "test: synthetic credential"]);

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

test("refuses a credential in an earlier commit even after its file is deleted", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-history",
  });
  writeFileSync(join(worktree.path, "leaked.env"), githubToken);
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, ["commit", "-m", "test: synthetic credential"]);
  await assert.rejects(
    trust().pushBranch({ worktree, branch, secrets: [githubToken] }),
    PublishRefusedError,
  );
  await git(worktree.path, ["rm", "leaked.env"]);
  await git(worktree.path, [
    "commit",
    "-m",
    "test: delete synthetic credential",
  ]);
  await assert.rejects(
    trust().pushBranch({ worktree, branch, secrets: [githubToken] }),
    PublishRefusedError,
  );
  await assert.rejects(git(origin, ["rev-parse", branch]));
});

for (const scenario of ["large blob", "total blob budget"]) {
  test(`refuses publication when inspection exceeds the ${scenario}`, async (context) => {
    const { origin, clone, worktreeRoot } = await repositoryFixture(context);
    const worktree = await branchWorktree({
      repository: clone,
      worktreeRoot,
      branch,
      name: "topic-budget",
    });
    const count = scenario === "large blob" ? 1 : 17;
    const size =
      scenario === "large blob" ? 2 * 1024 * 1024 + 1 : 2 * 1024 * 1024;
    for (let index = 0; index < count; index += 1) {
      writeFileSync(
        join(worktree.path, `large-${index}.bin`),
        Buffer.alloc(size, index + 1),
      );
    }
    await git(worktree.path, ["add", "--all"]);
    await git(worktree.path, [
      "commit",
      "-m",
      "test: exceed inspection budget",
    ]);
    await assert.rejects(
      trust().pushBranch({ worktree, branch, secrets: [] }),
      PublishRefusedError,
    );
    await assert.rejects(git(origin, ["rev-parse", branch]));
  });
}

for (const protectedPath of [
  ".github/workflows/injected.yml",
  ".github/actions/injected/action.yml",
  "CODEOWNERS",
  "docs/CODEOWNERS",
]) {
  test(`refuses ${protectedPath} even if a later commit removes it`, async (context) => {
    const { origin, clone, worktreeRoot } = await repositoryFixture(context);
    const worktree = await branchWorktree({
      repository: clone,
      worktreeRoot,
      branch,
      name: "topic-path",
    });
    mkdirSync(join(worktree.path, protectedPath, ".."), { recursive: true });
    writeFileSync(join(worktree.path, protectedPath), "synthetic");
    await git(worktree.path, ["add", "--all"]);
    await git(worktree.path, [
      "commit",
      "-m",
      "test: introduce protected path",
    ]);
    await git(worktree.path, ["rm", protectedPath]);
    await git(worktree.path, ["commit", "-m", "test: remove protected path"]);
    await assert.rejects(
      trust().pushBranch({ worktree, branch }),
      PublishRefusedError,
    );
    await assert.rejects(git(origin, ["rev-parse", branch]));
  });
}

test("refuses moving an existing workflow out of its protected directory", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-rename",
  });
  await git(worktree.path, [
    "mv",
    ".github/workflows/trusted.yml",
    "ordinary.yml",
  ]);
  await git(worktree.path, ["commit", "-m", "test: move a protected workflow"]);
  await assert.rejects(
    trust().pushBranch({ worktree, branch }),
    PublishRefusedError,
  );
  await assert.rejects(git(origin, ["rev-parse", branch]));
});

test("refuses a history whose Git objects cannot be read", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-missing",
  });
  writeFileSync(
    join(worktree.path, "missing.txt"),
    "unique content to make unreadable\n",
  );
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, ["commit", "-m", "test: unavailable object"]);
  const identifier = await git(worktree.path, [
    "rev-parse",
    "HEAD:missing.txt",
  ]);
  rmSync(
    join(clone, ".git", "objects", identifier.slice(0, 2), identifier.slice(2)),
  );
  await assert.rejects(
    trust().pushBranch({ worktree, branch }),
    PublishRefusedError,
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

test("exposes only branch publication and read-only CI operations", () => {
  const publicOperations = Object.getOwnPropertyNames(GitHubTrust.prototype)
    .filter((name) => name !== "constructor")
    .sort();

  assert.deepEqual(publicOperations, [
    "ensurePullRequest",
    "findOpenPullRequest",
    "getCommitCheckRuns",
    "getCommitStatuses",
    "getPullRequest",
    "pushBranch",
  ]);
});
