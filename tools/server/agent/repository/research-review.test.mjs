import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createResearchReview,
  readResearchSnapshot,
} from "./research-review.mjs";
import { gitEnvironment, registeredWorktree } from "./trusted-git.mjs";

const executeFile = promisify(execFile);

async function git(directory, argumentsList) {
  const { stdout } = await executeFile(
    "git",
    [
      "-C",
      directory,
      "-c",
      "user.name=Synthetic Reviewer",
      "-c",
      "user.email=synthetic@example.test",
      "-c",
      "core.hooksPath=/dev/null",
      ...argumentsList,
    ],
    { env: gitEnvironment() },
  );
  return stdout.trim();
}

test("unknown legacy jobs are conservatively tainted and remain so after restart", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-research-state-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = createResearchReview({ directory });
  first.ensure("opaque-legacy-job");
  first.ensure("opaque-legacy-job");
  assert.equal(first.isTainted("opaque-legacy-job"), true);
  const restarted = createResearchReview({ directory });
  restarted.ensure("opaque-legacy-job");
  assert.equal(restarted.isTainted("opaque-legacy-job"), true);
  restarted.ensure("opaque-legacy-job", { newJob: true });
  assert.equal(restarted.isTainted("opaque-legacy-job"), true);
});

test("a new clean job becomes durably tainted and damaged records never become clean", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-research-state-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createResearchReview({ directory });
  store.ensure("new-job", { newJob: true });
  store.ensure("new-job");
  assert.equal(store.isTainted("new-job"), false);
  store.markResearch("new-job");
  assert.equal(createResearchReview({ directory }).isTainted("new-job"), true);
  const initialized = createHash("sha256").update("new-job").digest("hex");
  rmSync(join(directory, initialized, "state"));
  assert.throws(() => store.ensure("new-job"));
  assert.throws(() => store.isTainted("new-job"));
  const damaged = createHash("sha256").update("damaged").digest("hex");
  mkdirSync(join(directory, damaged));
  writeFileSync(join(directory, damaged, "state"), "tainted\n");
  assert.throws(() => store.ensure("damaged"));
  assert.throws(() => store.isTainted("damaged"));
});

test("approval is scoped to the exact candidate and stable job", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-research-state-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = createResearchReview({ directory });
  store.ensure("job-a");
  store.ensure("job-b");
  const first = store.prepare("job-a", { commit: "one", body: "first" });
  store.approve("job-a", first);
  assert.equal(store.isApproved("job-a", first), true);
  const changed = store.prepare("job-a", { commit: "one", body: "second" });
  assert.equal(store.isApproved("job-a", first), false);
  assert.equal(store.isApproved("job-a", changed), false);
  const restored = store.prepare("job-a", { commit: "one", body: "first" });
  assert.notEqual(restored, first);
  assert.equal(store.isApproved("job-a", restored), false);
  assert.throws(() => store.approve("job-a", first));
  assert.throws(() => store.isApproved("job-b", first));
  assert.throws(() => store.approve("job-a", "../invalid"));
});

test("the private snapshot reads complete pinned Git history and refuses a changed head", async (context) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "mr-research-git-")),
  );
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, "repo");
  const worktreePath = join(directory, "work");
  const gitDirectory = join(repo, ".git", "worktrees", "work");
  const headPath = join(directory, "head");
  const patchPath = join(directory, "patch");
  const callsPath = join(directory, "calls");
  const commit = "a".repeat(40);
  const base = "b".repeat(40);
  mkdirSync(gitDirectory, { recursive: true });
  mkdirSync(worktreePath);
  writeFileSync(join(gitDirectory, "gitdir"), `${worktreePath}/.git\n`);
  writeFileSync(join(worktreePath, ".git"), `gitdir: ${gitDirectory}\n`);
  writeFileSync(headPath, commit);
  writeFileSync(patchPath, "Synthetic full patch\n");
  writeFileSync(
    join(directory, "git"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${callsPath}"`,
      'case " $* " in',
      '  *" config --get remote.origin.url "*) printf "https://github.com/example/project.git\\n" ;;',
      `  *" rev-parse HEAD "*) cat "${headPath}" ;;`,
      `  *" rev-parse origin/main "*) printf '%s\\n' '${base}' ;;`,
      `  *" rev-list "*) printf '%s\\n' '${commit}' ;;`,
      '  *" cat-file commit "*) printf "tree abc\\n\\nSynthetic commit message\\n" ;;',
      `  *" log "*) cat "${patchPath}" ;;`,
      "  *) exit 1 ;;",
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
  const candidate = {
    repository: "example/project",
    worktreePath,
    gitDirectory,
    commit,
    base,
    title: "title",
    body: "body",
  };
  const snapshot = await readResearchSnapshot({
    repositoryPath: repo,
    candidate,
  });
  assert.match(snapshot.commitObjects, /Synthetic commit message/u);
  assert.match(snapshot.history, /Synthetic full patch/u);
  assert.doesNotMatch(readFileSync(callsPath, "utf8"), / push /u);
  writeFileSync(patchPath, "GIT binary patch\n");
  await assert.rejects(
    readResearchSnapshot({ repositoryPath: repo, candidate }),
    /Binary history/u,
  );
  writeFileSync(headPath, "c".repeat(40));
  await assert.rejects(
    readResearchSnapshot({ repositoryPath: repo, candidate }),
    /snapshot changed/u,
  );
});

test("real history and CLI show an added and removed marker even when the net diff is empty", async (context) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "mr-research-real-git-")),
  );
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const repositoryPath = join(directory, "repository");
  const worktreePath = join(directory, "worktree");
  const storePath = join(directory, "state");
  mkdirSync(repositoryPath);
  await git(repositoryPath, ["init", "--initial-branch=main"]);
  await git(repositoryPath, [
    "config",
    "remote.origin.url",
    "https://github.com/example/project.git",
  ]);
  writeFileSync(join(repositoryPath, "example.txt"), "public baseline\n");
  await git(repositoryPath, ["add", "example.txt"]);
  await git(repositoryPath, ["commit", "-m", "initial synthetic baseline"]);
  const base = await git(repositoryPath, ["rev-parse", "HEAD"]);
  await git(repositoryPath, ["update-ref", "refs/remotes/origin/main", base]);
  await git(repositoryPath, ["worktree", "add", "-b", "review", worktreePath]);

  const marker = "SYNTHETIC_PRIVATE_RESEARCH_MARKER";
  writeFileSync(
    join(worktreePath, "example.txt"),
    `public baseline\n${marker}\n`,
  );
  await git(worktreePath, ["add", "example.txt"]);
  await git(worktreePath, ["commit", "-m", "add synthetic private material"]);
  const addedCommit = await git(worktreePath, ["rev-parse", "HEAD"]);
  writeFileSync(join(worktreePath, "example.txt"), "public baseline\n");
  await git(worktreePath, ["add", "example.txt"]);
  await git(worktreePath, [
    "commit",
    "-m",
    "remove synthetic private material",
  ]);
  const commit = await git(worktreePath, ["rev-parse", "HEAD"]);

  assert.equal(await git(worktreePath, ["diff", base, commit, "--"]), "");
  const candidate = {
    repository: "example/project",
    worktreePath,
    gitDirectory: registeredWorktree(repositoryPath, worktreePath).gitDirectory,
    commit,
    base,
    title: "Synthetic candidate title",
    body: "Synthetic candidate body",
  };
  const snapshot = await readResearchSnapshot({ repositoryPath, candidate });
  assert.deepEqual(snapshot.candidate, candidate);
  assert.match(snapshot.history, new RegExp(`\\+${marker}`, "u"));
  assert.match(snapshot.history, new RegExp(`-${marker}`, "u"));
  for (const value of [
    addedCommit,
    commit,
    "Synthetic Reviewer <synthetic@example.test>",
    "add synthetic private material",
    "remove synthetic private material",
  ]) {
    assert.ok(snapshot.commitObjects.includes(value), value);
  }

  const review = createResearchReview({ directory: storePath });
  review.ensure("synthetic-job");
  const id = review.prepare("synthetic-job", candidate);
  const cliPath = fileURLToPath(
    new URL("../commands/research-review/cli.mjs", import.meta.url),
  );
  const argumentsList = [storePath, repositoryPath, "synthetic-job", id];
  const shown = spawnSync(
    process.execPath,
    [cliPath, "show", ...argumentsList],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    },
  );
  assert.equal(shown.status, 0, shown.stderr);
  for (const value of [
    candidate.title,
    candidate.body,
    addedCommit,
    commit,
    "+" + marker,
    "-" + marker,
    "Synthetic Reviewer <synthetic@example.test>",
  ]) {
    assert.ok(shown.stdout.includes(value), value);
  }

  const refused = spawnSync(
    process.execPath,
    [cliPath, "approve", ...argumentsList],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
      input: `${id}\n`,
    },
  );
  assert.notEqual(refused.status, 0);
  assert.match(
    refused.stderr,
    /Approval requires an interactive private terminal/u,
  );
  assert.equal(review.isApproved("synthetic-job", id), false);
});
