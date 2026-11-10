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
import { PublishRefusedError } from "../repository/github.mjs";
import { createProjectRunner } from "./project-runner.mjs";
import { hasUnpublishedCommit } from "../repository/worktrees.mjs";

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

async function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-job-"));
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
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  return {
    directory: realpathSync(directory),
    repository: realpathSync(repository),
    worktrees: join(directory, "worktrees"),
    state: join(directory, "state"),
  };
}

function configFor(paths) {
  return {
    telegram: { botToken: "telegram-secret" },
    github: {
      token: "github-secret",
      repository: "rboixaderg/mountain-runners",
    },
    model: { sandboxImage: "mountain-agent-pi:1.5.0" },
    paths: {
      repository: paths.repository,
      worktrees: paths.worktrees,
      state: paths.state,
    },
    limits: {
      executionTimeoutMs: 60000,
      sandboxProcessLimit: 64,
      sandboxMemoryMegabytes: 256,
      sandboxCpuCount: 1,
    },
  };
}

function request(overrides = {}) {
  return {
    updateIdentifier: 1001,
    messageIdentifier: 2001,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 42,
    instruction: "afegeix una prova sintètica",
    ...overrides,
  };
}

function githubStub() {
  return {
    pushes: [],
    pulls: [],
    async pushBranch(argumentsObject) {
      this.pushes.push(argumentsObject);
      return {
        branch: argumentsObject.branch,
        commit: await git(argumentsObject.worktree.path, ["rev-parse", "HEAD"]),
      };
    },
    async ensurePullRequest(argumentsObject) {
      this.pulls.push(argumentsObject);
      return {
        pullRequest: {
          number: 200,
          htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
        },
        created: true,
      };
    },
  };
}

test("answers a consultation without creating a branch or a remote effect", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "consultation",
    github,

    runModel: async () => ({ text: "El fitxer diu synthetic." }),
    runChecks: async () =>
      assert.fail("checks must not run for a consultation"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "El fitxer diu synthetic.");
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
  assert.equal(existsSync(join(paths.worktrees, "scratch-1001")), false);
  assert.equal(await git(paths.repository, ["branch", "--list", "feat/*"]), "");
});

test("publishes a small change as a pull request after the checks pass", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const checks = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return {
        text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change",
      };
    },
    runChecks: async ({ worktreePath }) => {
      checks.push(worktreePath);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.match(result.report, /pull\/200/u);
  assert.equal(checks.length, 1);
  assert.equal(github.pushes.length, 1);
  assert.equal(github.pushes[0].branch, "feat/tools-add-synthetic-change-1001");
  assert.deepEqual(github.pushes[0].secrets, [
    "telegram-secret",
    "github-secret",
  ]);
  assert.equal(github.pulls.length, 1);
  assert.equal(github.pulls[0].title, "feat(tools): add synthetic change");
  assert.match(github.pulls[0].body, /change\.txt/u);
  assert.match(github.pulls[0].body, /pnpm check/u);

  const committed = await git(join(paths.worktrees, "topic_n1001234567890_7"), [
    "log",
    "-1",
    "--format=%s",
  ]);
  assert.equal(committed, "feat(tools): add synthetic change");
});

test("keeps the worktree and publishes nothing when the checks fail", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "SUMMARY: fix(tools): broken change" };
    },
    runChecks: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.match(result.report, /No s'ha fet cap push/u);
  assert.deepEqual(github.pushes, []);
  assert.equal(
    existsSync(join(paths.worktrees, "topic_n1001234567890_7")),
    true,
  );
});

test("marks a timed-out run as uncertain and keeps the work", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github,
    runModel: async () => ({ text: "", timedOut: true }),
    runChecks: async () => assert.fail("checks must not run"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "uncertain");
  assert.deepEqual(github.pushes, []);
  assert.equal(
    existsSync(join(paths.worktrees, "topic_n1001234567890_7")),
    true,
  );
});

test("uses a conventional fallback when the model omits the summary", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet." };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  await runner(request());

  assert.equal(
    github.pulls[0].title,
    "feat(agent): afegeix una prova sintetica",
  );
  assert.equal(
    github.pushes[0].branch,
    "feat/agent-afegeix-una-prova-sintetica-1001",
  );
});

test("keeps one worktree per topic so the Pi session continues", async (context) => {
  const paths = await fixture(context);
  const seen = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github: githubStub(),
    runModel: async ({ worktreePath }) => {
      seen.push(worktreePath);
      return { text: "Resposta." };
    },
    runChecks: async () => assert.fail("checks must not run"),
  });

  await runner(request({ updateIdentifier: 1001 }));
  await runner(request({ updateIdentifier: 1002 }));

  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
  assert.match(seen[0], /topic_n1001234567890_7$/u);
});

test("continues the unpublished branch when the previous checks failed", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  let checksPass = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "SUMMARY: fix(tools): repair the change" };
    },
    runChecks: async () =>
      checksPass
        ? { exitCode: 0, stdout: "", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "" },
  });

  const first = await runner(request({ updateIdentifier: 1001 }));
  checksPass = true;
  const second = await runner(request({ updateIdentifier: 1002 }));

  assert.equal(first.outcome, "failed");
  assert.equal(second.outcome, "pull_request_created");
  assert.equal(github.pushes.length, 1);
  assert.equal(
    github.pushes[0].branch,
    "fix/tools-repair-the-change-1001",
    "the retry continues the branch of the failed instruction",
  );
});

test("starts a new branch from the latest main after a published change", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  let attempt = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github,
    runModel: async ({ worktreePath }) => {
      attempt += 1;
      writeFileSync(join(worktreePath, `change-${attempt}.txt`), "canvi\n");
      return { text: "" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  await runner(request({ updateIdentifier: 1001 }));

  const other = join(paths.directory, "other");
  await executeFile("git", [
    "clone",
    join(paths.directory, "origin.git"),
    other,
  ]);
  writeFileSync(join(other, "main-change.txt"), "new main\n");
  await git(other, ["add", "main-change.txt"]);
  await git(other, ["commit", "-m", "feat: new main content"]);
  await git(other, ["push", "origin", "main"]);
  const mainCommit = await git(other, ["rev-parse", "HEAD"]);

  await runner(request({ updateIdentifier: 1002 }));

  const secondBranch = github.pushes[1].branch;
  assert.equal(secondBranch, "feat/agent-afegeix-una-prova-sintetica-1002");
  const ancestry = await executeFile("git", [
    "-C",
    paths.repository,
    "merge-base",
    "--is-ancestor",
    mainCommit,
    secondBranch,
  ]).then(
    () => true,
    () => false,
  );
  assert.equal(ancestry, true);
});

test("reports a local publication refusal as a failure, not an unknown result", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  github.pushBranch = async () => {
    throw new PublishRefusedError(
      "The worktree file leaked.env contains a live credential.",
    );
  };
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => "implementation",
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "leaked.env"), "TOKEN=secret\n");
      return { text: "" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.match(result.report, /regla local/u);
  assert.deepEqual(github.pulls, []);
});

test("retries a locally refused publication without losing or duplicating the commit", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const publish = github.pushBranch.bind(github);
  let refused = false;
  github.pushBranch = async (parameters) => {
    if (!refused) {
      refused = true;
      throw new PublishRefusedError("Synthetic local refusal.");
    }
    return publish(parameters);
  };
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => "implementation",
    runModel: async ({ worktreePath }) => {
      if (turns === 0)
        writeFileSync(
          join(worktreePath, "change.txt"),
          "preserve this change\n",
        );
      turns += 1;
      return { text: "SUMMARY: fix(agent): preserve the unpublished commit" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });
  const first = await runner(request({ updateIdentifier: 1001 }));
  const worktreePath = join(paths.worktrees, "topic_n1001234567890_7");
  const commit = await git(worktreePath, ["rev-parse", "HEAD"]);
  const second = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Torna a provar la publicació pendent.",
    }),
  );
  assert.equal(first.outcome, "failed");
  assert.equal(second.outcome, "pull_request_created");
  assert.equal(github.pushes.length, 1);
  assert.equal(
    github.pushes[0].branch,
    "fix/agent-preserve-the-unpublished-commit-1001",
  );
  assert.equal(await git(worktreePath, ["rev-parse", "HEAD"]), commit);
});

for (const operationName of ["pushBranch", "ensurePullRequest"]) {
  test(`keeps the commit unpublished when ${operationName} has an unknown remote result`, async (context) => {
    const paths = await fixture(context);
    const github = githubStub();
    const operation = github[operationName].bind(github);
    const failure = new Error(
      "Synthetic connection lost after the remote action.",
    );
    github[operationName] = async (parameters) => {
      await operation(parameters);
      throw failure;
    };
    const runner = createProjectRunner({
      config: configFor(paths),
      github,
      classifyRequest: async () => "implementation",
      runModel: async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, "change.txt"), "keep this commit\n");
        return {
          text: "SUMMARY: fix(agent): preserve an uncertain publication",
        };
      },
      runChecks: async () => ({ exitCode: 0 }),
    });
    await assert.rejects(runner(request()), (error) => error === failure);
    assert.equal(github.pushes.length, 1);
    assert.equal(github.pulls.length, operationName === "pushBranch" ? 0 : 1);
    assert.equal(await hasUnpublishedCommit(github.pushes[0].worktree), true);
  });
}
