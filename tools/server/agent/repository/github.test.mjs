import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import {
  GitHubTrust,
  PublicationBaseChangedError,
  PublishRefusedError,
} from "./github.mjs";
import { GitInterruptedError, primaryRepository } from "./trusted-git.mjs";
import { createBranch, ensureSessionWorktree } from "./worktrees.mjs";

const executeFile = promisify(execFile);
const repository = "rboixaderg/mountain-runners";
const githubToken = "ghp_synthetic_token_for_tests";
const branch = "feat/phase-8-t8.3-telegram-bridge";

test("research approval pushes only its SHA with a lease and refuses changed HEAD", async (context) => {
  const { directory } = fakeGitFixture(context);
  const headPath = join(directory, "head");
  const pushPath = join(directory, "push-arguments");
  const remotePath = join(directory, "remote-head");
  const commit = "a".repeat(40);
  const base = "b".repeat(40);
  const expectedHead = "c".repeat(40);
  writeFileSync(headPath, commit);
  writeFileSync(remotePath, expectedHead);
  writeFileSync(
    join(directory, "git"),
    [
      "#!/bin/sh",
      'case " $* " in',
      `  *" config --get remote.origin.url "*) printf '%s\\n' "https://github.com/${repository}.git" ;;`,
      `  *" rev-parse HEAD "*) cat "${headPath}" ;;`,
      `  *" rev-parse origin/main "*) printf '%s\\n' "${base}" ;;`,
      '  *" merge-base --is-ancestor "*) exit 0 ;;',
      '  *" rev-list "*) exit 0 ;;',
      `  *" push "*) printf '%s\\n' "$*" > "${pushPath}"; test "$(cat "${remotePath}")" = "${expectedHead}" || exit 1 ;;`,
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const worktree = primaryRepository(directory);
  const approved = {
    repository,
    branch,
    worktreePath: worktree.path,
    gitDirectory: worktree.gitDirectory,
    commit,
    base,
    expectedHead,
  };
  const result = await trust().pushBranch({ worktree, branch, approved });
  assert.equal(result.commit, commit);
  const argumentsList = readFileSync(pushPath, "utf8");
  assert.match(
    argumentsList,
    new RegExp(`--force-with-lease=refs/heads/${branch}:${expectedHead}`, "u"),
  );
  assert.match(
    argumentsList,
    new RegExp(`${commit}:refs/heads/${branch}`, "u"),
  );
  rmSync(pushPath);
  writeFileSync(headPath, "d".repeat(40));
  await assert.rejects(
    trust().pushBranch({ worktree, branch, approved }),
    PublishRefusedError,
  );
  assert.equal(existsSync(pushPath), false);
  writeFileSync(headPath, commit);
  writeFileSync(remotePath, "e".repeat(40));
  await assert.rejects(trust().pushBranch({ worktree, branch, approved }));
  assert.equal(readFileSync(remotePath, "utf8"), "e".repeat(40));
});

test("research candidate pins the remote ref and does not turn remote errors into absence", async (context) => {
  const { directory } = fakeGitFixture(context);
  const commit = "a".repeat(40);
  const base = "b".repeat(40);
  const remote = "c".repeat(40);
  writeFileSync(
    join(directory, "git"),
    [
      "#!/bin/sh",
      'case " $* " in',
      `  *" config --get remote.origin.url "*) printf '%s\\n' "https://github.com/${repository}.git" ;;`,
      `  *" rev-parse HEAD "*) printf '%s\\n' "${commit}" ;;`,
      `  *" rev-parse origin/main "*) printf '%s\\n' "${base}" ;;`,
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const worktree = primaryRepository(directory);
  let status = 200;
  const calls = [];
  const github = trust({
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      return {
        ok: status === 200,
        status,
        json: async () => ({ object: { sha: remote } }),
      };
    },
  });
  const parameters = { worktree, branch, title: "title", body: "body" };
  const candidate = await github.researchCandidate(parameters);
  assert.equal(candidate.expectedHead, remote);
  assert.equal(candidate.commit, commit);
  assert.equal(candidate.base, base);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["GET"],
  );
  status = 404;
  assert.equal((await github.researchCandidate(parameters)).expectedHead, null);
  status = 500;
  await assert.rejects(github.researchCandidate(parameters), /HTTP 500/u);
});

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

/**
 * A fake `git` on a temporary PATH. It answers the pre-push checks of the
 * trusted component, marks the start of the push and then never answers, so the
 * only way the push ends is the instruction signal reaching the subprocess.
 */
function fakeGitFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-fake-git-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  mkdirSync(join(directory, ".git"));
  const pushStarted = join(directory, "push-started");
  writeFileSync(
    join(directory, "git"),
    [
      "#!/bin/sh",
      'case " $* " in',
      `  *" config --get remote.origin.url "*) printf '%s\\n' "https://github.com/${repository}.git"; exit 0 ;;`,
      `  *" rev-parse HEAD "*) printf '%s\\n' "${"a".repeat(40)}"; exit 0 ;;`,
      '  *" rev-list "*) exit 0 ;;',
      `  *" push "*) : > "${pushStarted}"; exec sleep 10 ;;`,
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}:${originalPath}`;
  context.after(() => {
    process.env.PATH = originalPath;
  });
  return { directory, pushStarted };
}

async function waitForFile(path, timeoutMilliseconds = 5000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!existsSync(path)) {
    if (Date.now() > deadline) {
      throw new Error("The fake Git push never started.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

test("a validated publication stops before pushing when main advanced", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-stale-base",
  });
  const base = (await git(clone, ["rev-parse", "origin/main"])).trim();
  writeFileSync(join(worktree.path, "change.txt"), "canvi\n");
  await git(worktree.path, ["add", "change.txt"]);
  await git(worktree.path, ["commit", "-m", "feat: synthetic change"]);
  const commit = (await git(worktree.path, ["rev-parse", "HEAD"])).trim();
  const component = trust({
    async fetchImpl(url, options) {
      assert.equal(options.method, "GET");
      assert.equal(
        url,
        `https://api.github.com/repos/${repository}/git/ref/heads/main`,
      );
      return {
        ok: true,
        json: async () => ({ object: { sha: "b".repeat(40) } }),
      };
    },
  });
  let pushStarted = false;
  await assert.rejects(
    component.pushBranch({
      worktree,
      branch,
      validated: { commit, base },
      onPublicationStarted: () => {
        pushStarted = true;
      },
    }),
    PublicationBaseChangedError,
  );
  assert.equal(pushStarted, false);
  await assert.rejects(
    git(origin, ["show-ref", "--verify", `refs/heads/${branch}`]),
  );
});

test("a validated publication rejects a changed remote head even if the push would fast-forward", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-raced-head",
  });
  const base = (await git(clone, ["rev-parse", "origin/main"])).trim();
  await git(worktree.path, [
    "commit",
    "--allow-empty",
    "-m",
    "feat: concurrent work",
  ]);
  const concurrent = (await git(worktree.path, ["rev-parse", "HEAD"])).trim();
  await git(worktree.path, [
    "push",
    "origin",
    `${concurrent}:refs/heads/${branch}`,
  ]);
  await git(worktree.path, [
    "commit",
    "--allow-empty",
    "-m",
    "feat: validated work",
  ]);
  const commit = (await git(worktree.path, ["rev-parse", "HEAD"])).trim();
  const component = trust({
    async fetchImpl() {
      return { ok: true, json: async () => ({ object: { sha: base } }) };
    },
  });

  const validated = { commit, base };
  await assert.rejects(
    component.pushBranch({ worktree, branch, validated, expectedHead: base }),
    /stale info/u,
  );
  assert.equal(
    (await git(origin, ["rev-parse", `refs/heads/${branch}`])).trim(),
    concurrent,
  );

  await component.pushBranch({
    worktree,
    branch,
    validated,
    expectedHead: concurrent,
  });
  assert.equal(
    (await git(origin, ["rev-parse", `refs/heads/${branch}`])).trim(),
    commit,
  );
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

test("publishes a branch that merged a newer main which changed a workflow", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-merged-main",
  });
  writeFileSync(join(worktree.path, "change.txt"), "canvi\n");
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, ["commit", "-m", "feat: synthetic change"]);

  writeFileSync(
    join(clone, ".github", "workflows", "updated.yml"),
    "synthetic workflow of main\n",
  );
  await git(clone, ["add", "--all"]);
  await git(clone, ["commit", "-m", "ci: synthetic workflow of main"]);
  await git(clone, ["push", "origin", "main"]);

  await git(worktree.path, ["fetch", "origin"]);
  await git(worktree.path, [
    "merge",
    "--no-ff",
    "-m",
    "Merge origin/main into the branch",
    "origin/main",
  ]);
  writeFileSync(join(worktree.path, "change.txt"), "canvi actualitzat\n");
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, ["commit", "-m", "feat: synthetic follow-up"]);

  const result = await trust().pushBranch({ worktree, branch });

  assert.equal(result.commit, await git(origin, ["rev-parse", branch]));
});

test("refuses a merge that changes a protected path with neither parent", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-evil-merge",
  });
  writeFileSync(join(worktree.path, "change.txt"), "canvi\n");
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, ["commit", "-m", "feat: synthetic change"]);

  writeFileSync(
    join(clone, ".github", "workflows", "trusted.yml"),
    "synthetic workflow of main\n",
  );
  await git(clone, ["add", "--all"]);
  await git(clone, ["commit", "-m", "ci: synthetic workflow of main"]);
  await git(clone, ["push", "origin", "main"]);

  await git(worktree.path, ["fetch", "origin"]);
  await git(worktree.path, ["merge", "--no-ff", "--no-commit", "origin/main"]);
  writeFileSync(
    join(worktree.path, ".github", "workflows", "trusted.yml"),
    "synthetic workflow of the merge\n",
  );
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, [
    "commit",
    "-m",
    "Merge origin/main into the branch",
  ]);

  await assert.rejects(
    trust().pushBranch({ worktree, branch }),
    PublishRefusedError,
  );
  await assert.rejects(git(origin, ["rev-parse", branch]));
});

test("refuses a branch commit that changes a protected path before merging main", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-merged-protected",
  });
  mkdirSync(join(worktree.path, ".github", "actions"), { recursive: true });
  writeFileSync(
    join(worktree.path, ".github", "actions", "injected.yml"),
    "synthetic\n",
  );
  await git(worktree.path, ["add", "--all"]);
  await git(worktree.path, ["commit", "-m", "test: introduce protected path"]);

  writeFileSync(join(clone, "main-change.txt"), "synthetic\n");
  await git(clone, ["add", "--all"]);
  await git(clone, ["commit", "-m", "test: synthetic main change"]);
  await git(clone, ["push", "origin", "main"]);

  await git(worktree.path, ["fetch", "origin"]);
  await git(worktree.path, [
    "merge",
    "--no-ff",
    "-m",
    "Merge origin/main into the branch",
    "origin/main",
  ]);

  await assert.rejects(
    trust().pushBranch({ worktree, branch }),
    PublishRefusedError,
  );
  await assert.rejects(git(origin, ["rev-parse", branch]));
});

test("refuses a published history that contains an attachment path", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-attachment",
  });
  mkdirSync(join(worktree.path, ".agent-attachments"), { recursive: true });
  writeFileSync(
    join(worktree.path, ".agent-attachments", "portada.png"),
    "synthetic-image",
  );
  await git(worktree.path, ["add", "--force", ".agent-attachments"]);
  await git(worktree.path, ["commit", "-m", "test: commit an attachment"]);
  await assert.rejects(trust().pushBranch({ worktree, branch }), {
    message: /attachment directory path/u,
  });
  await git(worktree.path, ["rm", "-r", ".agent-attachments"]);
  await git(worktree.path, ["commit", "-m", "test: remove the attachment"]);
  await assert.rejects(trust().pushBranch({ worktree, branch }), {
    message: /attachment directory path/u,
  });
  await assert.rejects(git(origin, ["rev-parse", branch]));
});

test("refuses a published history that records a nested repository", async (context) => {
  const { origin, clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-gitlink",
  });
  const head = await git(worktree.path, ["rev-parse", "HEAD"]);
  await git(worktree.path, [
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${head},nested`,
  ]);
  await git(worktree.path, ["commit", "-m", "test: record a gitlink"]);
  await git(worktree.path, ["rm", "--cached", "--quiet", "nested"]);
  await git(worktree.path, ["commit", "-m", "test: drop the gitlink"]);

  await assert.rejects(trust().pushBranch({ worktree, branch }), (error) => {
    assert.ok(error instanceof PublishRefusedError);
    assert.match(error.message, /nested repository or submodule/u);
    return true;
  });
  await assert.rejects(git(origin, ["rev-parse", branch]));
});

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
    `https://api.github.com/repos/${repository}/pulls?state=open&base=main&head=rboixaderg%3A${encodeURIComponent(branch)}`,
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

test("stops a running push when the instruction signal aborts", async (context) => {
  const { directory, pushStarted } = fakeGitFixture(context);
  const worktree = primaryRepository(directory);
  const requests = [];
  const component = trust({
    fetchImpl: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => [] };
    },
  });
  const controller = new AbortController();

  const pending = component.pushBranch({
    worktree,
    branch,
    secrets: [githubToken],
    signal: controller.signal,
  });
  await waitForFile(pushStarted);
  const stoppedAt = Date.now();
  controller.abort();

  await assert.rejects(pending, GitInterruptedError);
  assert.ok(Date.now() - stoppedAt < 5000);
  assert.equal(existsSync(pushStarted), true);
  assert.deepEqual(requests, []);
});

test("bounds an API request that the caller did not bound", async () => {
  const signals = [];
  const component = trust({
    requestTimeoutMilliseconds: 20,
    fetchImpl: (url, options) => {
      signals.push(options.signal);
      return new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          {
            once: true,
          },
        );
      });
    },
  });

  await assert.rejects(component.findOpenPullRequest({ branch }), {
    name: "TimeoutError",
  });
  assert.equal(signals.length, 1);
});

test("stops an API request when the caller signal aborts", async () => {
  const component = trust({
    fetchImpl: (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          {
            once: true,
          },
        );
      }),
  });
  const controller = new AbortController();
  const pending = component.ensurePullRequest({
    branch,
    title: "feat(phase-8-t8.6): deadlines",
    body: "Descripció",
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
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

test("exposes only the approved GitHub operations", () => {
  const publicOperations = Object.getOwnPropertyNames(GitHubTrust.prototype)
    .filter((name) => name !== "constructor")
    .sort();

  assert.deepEqual(publicOperations, [
    "addPreviewLabel",
    "ensurePullRequest",
    "findOpenPullRequest",
    "getCheckRunJob",
    "getCommitCheckRuns",
    "getCommitStatuses",
    "getPullRequest",
    "getWorkflowJob",
    "getWorkflowJobLog",
    "getWorkflowRun",
    "listIssueComments",
    "mergePullRequest",
    "pushBranch",
    "rerunFailedJobs",
    "researchCandidate",
  ]);
});

test("propagates an interrupted local check instead of a refusal", async (context) => {
  const { clone, worktreeRoot } = await repositoryFixture(context);
  const worktree = await branchWorktree({
    repository: clone,
    worktreeRoot,
    branch,
    name: "topic-interrupted-check",
  });

  // The stop reaches the history check before the push: nothing was published,
  // and the caller must see the interruption, not a local refusal.
  await assert.rejects(
    trust().pushBranch({
      worktree,
      branch,
      signal: AbortSignal.abort(),
    }),
    GitInterruptedError,
  );
});

test("redacts the token from the message and the stack of a failed Git read", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-token-git-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  mkdirSync(join(directory, ".git"));
  writeFileSync(
    join(directory, "git"),
    [
      "#!/bin/sh",
      'case " $* " in',
      `  *" config --get remote.origin.url "*) printf '%s\\n' "https://github.com/${repository}.git"; exit 0 ;;`,
      `  *" rev-parse HEAD "*) printf '%s\\n' "https://x-access-token:${githubToken}@github.com/${repository}.git" >&2; exit 1 ;;`,
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}:${originalPath}`;
  context.after(() => {
    process.env.PATH = originalPath;
  });
  const worktree = primaryRepository(directory);

  const failure = await trust()
    .pushBranch({ worktree, branch })
    .catch((error) => error);

  assert.equal(failure.message.includes(githubToken), false);
  assert.equal(String(failure.stack).includes(githubToken), false);
});

test("never reduces an invalid pull request list to a real pull request", async () => {
  const responses = [
    { not: "a list" },
    [{ number: "200" }],
    [{ number: 200, html_url: "x", head: {}, draft: false, base: {} }],
  ];
  for (const response of responses) {
    const component = trust({
      fetchImpl: async () => ({ ok: true, json: async () => response }),
    });
    await assert.rejects(component.findOpenPullRequest({ branch }), /invalid/u);
  }
});
