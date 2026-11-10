import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { promisify } from "node:util";
import { test } from "node:test";
import { runProjectPrompt } from "../runtime/pi-adapter.mjs";
import {
  commitAll,
  createBranch,
  currentBranch,
  ensureSessionWorktree,
  listChangedPaths,
} from "../repository/worktrees.mjs";
import { createProjectRunner } from "./project-runner.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";

const executeFile = promisify(execFile);
const limits = {
  executionTimeoutMs: 200,
  sandboxProcessLimit: 64,
  sandboxMemoryMegabytes: 256,
  sandboxCpuCount: 1,
};

function temporaryDirectory(context) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "mr-agent-regression-")),
  );
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return directory;
}

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
  const directory = temporaryDirectory(context);
  const origin = join(directory, "origin.git");
  const repository = join(directory, "repository");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "original\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: initialize"]);
  await git(repository, ["push", "origin", "main"]);
  const config = {
    paths: {
      repository,
      worktrees: join(directory, "worktrees"),
      state: join(directory, "state"),
      sessions: join(directory, "sessions"),
    },
    model: {
      identifier: "synthetic",
      sandboxImage: "node:24",
      providerEnvironmentVariables: [],
    },
    telegram: { botToken: "synthetic-telegram" },
    github: { token: "synthetic-github" },
    limits,
  };
  const worktree = await ensureSessionWorktree({
    repositoryPath: repository,
    worktreeRoot: config.paths.worktrees,
    name: "topic_n100_7",
  });
  return { directory, repository, config, worktree };
}

test("keeps the full path of an unstaged tracked modification", async (context) => {
  const { worktree } = await repositoryFixture(context);
  writeFileSync(join(worktree.path, "README.md"), "modified\n");
  assert.deepEqual(await listChangedPaths(worktree), ["README.md"]);
});

test("does not execute a repository hook in the trusted commit process", async (context) => {
  const { directory, repository, worktree } = await repositoryFixture(context);
  const marker = join(directory, "host-hook-ran");
  const hook = join(repository, ".git", "hooks", "pre-commit");
  writeFileSync(hook, `#!/bin/sh\nprintf synthetic > '${marker}'\n`);
  chmodSync(hook, 0o755);
  writeFileSync(join(worktree.path, "README.md"), "modified\n");
  await commitAll({ worktree, message: "fix(agent): synthetic change" });
  assert.equal(existsSync(marker), false);
});

test("preserves a clean branch with an unpublished commit", async (context) => {
  const { config, worktree } = await repositoryFixture(context);
  await createBranch({ worktree, branch: "fix/unpublished-change" });
  writeFileSync(join(worktree.path, "README.md"), "modified\n");
  await commitAll({ worktree, message: "fix(agent): preserve this commit" });
  await ensureSessionWorktree({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
    name: "topic_n100_7",
  });
  assert.equal(await currentBranch(worktree), "fix/unpublished-change");
});

test("answers a consultation without publishing a previous failed change", async (context) => {
  const { config, worktree } = await repositoryFixture(context);
  writeFileSync(join(worktree.path, "README.md"), "pending change\n");
  let checks = 0;
  let publications = 0;
  const runner = createProjectRunner({
    config,
    classifyRequest: async () => "consultation",
    runModel: async () => ({ text: "La feina anterior continua pendent." }),
    runChecks: async () => {
      checks += 1;
      return { exitCode: 0 };
    },
    github: {
      async pushBranch() {
        publications += 1;
        return { commit: "synthetic" };
      },
      async ensurePullRequest() {
        return {
          pullRequest: { htmlUrl: "https://example.test/pr/1" },
          created: true,
        };
      },
    },
  });
  const result = await runner({
    updateIdentifier: 12,
    sessionKey: "-100:7",
    instruction: "Per què ha fallat abans?",
  });
  assert.equal(result.outcome, "answered");
  assert.equal(checks, 0);
  assert.equal(publications, 0);
  assert.equal(
    readFileSync(join(worktree.path, "README.md"), "utf8"),
    "pending change\n",
  );
});

test("kills the session containers as well as Pi on a model deadline", async (context) => {
  const directory = temporaryDirectory(context);
  const executable = join(directory, "fake-pi");
  writeFileSync(
    executable,
    "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
  );
  chmodSync(executable, 0o755);
  const stopped = [];
  const config = {
    paths: { sessions: directory, worktrees: directory },
    model: {
      identifier: "synthetic",
      piCommand: executable,
      providerEnvironmentVariables: [],
      sandboxImage: "node:24",
    },
    limits,
  };
  const result = await runProjectPrompt({
    config,
    profileDirectory: directory,
    sessionIdentifier: "topic_n100_7",
    message: "synthetic",
    worktreePath: directory,
    environment: { PATH: process.env.PATH, HOME: directory },
    stopCommands: async (identifier) => stopped.push(identifier),
  });
  assert.equal(result.timedOut, true);
  assert.deepEqual(stopped, ["topic_n100_7"]);
});

for (const cleanupFails of [false, true]) {
  test(`verifies sandbox cleanup after a settled model turn, with failure=${cleanupFails}`, async (context) => {
    const directory = temporaryDirectory(context);
    const executable = join(directory, "settled-pi");
    writeFileSync(
      executable,
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({type:'agent_settled',aborted:false})+'\\n');\n`,
    );
    chmodSync(executable, 0o755);
    let cleanups = 0;
    const running = runProjectPrompt({
      config: {
        paths: { sessions: directory, worktrees: directory },
        model: {
          identifier: "synthetic",
          piCommand: executable,
          providerEnvironmentVariables: [],
          sandboxImage: "synthetic:1",
        },
        limits: { ...limits, executionTimeoutMs: 5000 },
      },
      profileDirectory: directory,
      sessionIdentifier: "topic-cleanup",
      message: "synthetic",
      worktreePath: directory,
      stopCommands: async () => {
        cleanups += 1;
        if (cleanupFails) throw new SandboxCleanupError();
      },
    });
    if (cleanupFails) await assert.rejects(running, SandboxCleanupError);
    else await running;
    assert.equal(cleanups, 1);
  });
}

test("uses the default classifier, real profile and RPC wiring before publishing", async (context) => {
  const { directory, config } = await repositoryFixture(context);
  const executable = join(directory, "fake-pi");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const classification = process.argv.includes("--no-tools");
if (process.env.MOUNTAIN_AGENT_GITHUB_TOKEN || process.env.MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN) throw new Error("Credential exposed");
process.stdin.once("data", () => {
  let text;
  if (classification) {
    text = JSON.stringify({kind:"implementation"});
  } else {
    const profile = process.env.PI_CODING_AGENT_DIR;
    if (!fs.existsSync(path.join(profile, "extensions", "sandbox-bash.ts"))) throw new Error("Missing actual profile");
    fs.writeFileSync(path.join(process.cwd(), "README.md"), "wired change\\n");
    text = "SUMMARY: fix(agent): verify the real runtime wiring";
  }
  process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text}]}}) + "\\n");
  process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false}) + "\\n");
});
`,
  );
  chmodSync(executable, 0o755);
  config.model.piCommand = executable;
  config.limits.executionTimeoutMs = 5000;
  const calls = [];
  let cleaned = false;
  const runner = createProjectRunner({
    config,
    stopCommands: async () => {
      cleaned = true;
      return 0;
    },
    runChecks: async ({ worktreePath }) => {
      assert.equal(
        cleaned,
        true,
        "the model sandbox must be stopped before checks",
      );
      assert.equal(
        readFileSync(join(worktreePath, "README.md"), "utf8"),
        "wired change\n",
      );
      return { exitCode: 0 };
    },
    github: {
      async pushBranch({ worktree, branch }) {
        calls.push(branch);
        return { commit: await git(worktree.path, ["rev-parse", "HEAD"]) };
      },
      async ensurePullRequest() {
        return {
          pullRequest: { htmlUrl: "https://example.test/pr/1" },
          created: true,
        };
      },
    },
  });
  const result = await runner({
    updateIdentifier: 13,
    sessionKey: "-100:7",
    instruction: "Corregeix el README.",
  });
  assert.equal(result.outcome, "pull_request_created");
  assert.deepEqual(calls, ["fix/agent-verify-the-real-runtime-wiring-13"]);
});

test("rejects a forged Git marker before any host Git command", async (context) => {
  const { directory, worktree } = await repositoryFixture(context);
  const fakeMetadata = join(directory, "forged.git");
  mkdirSync(fakeMetadata);
  writeFileSync(join(worktree.path, ".git"), `gitdir: ${fakeMetadata}\n`);
  await assert.rejects(listChangedPaths(worktree), /Git marker was modified/u);
});
