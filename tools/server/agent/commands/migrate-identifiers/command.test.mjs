import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import {
  listUncertainCases,
  resolveUncertainCase,
} from "../reconcile/uncertain-cases.mjs";
import { reconcileResolutions } from "../../policy/development.mjs";
import {
  createIdentifierNames,
  readIdentifierSalt,
} from "../../repository/identifiers.mjs";
import {
  commitAll,
  createBranch,
  ensureSessionWorktree,
  findSessionWorktree,
  publishedCommit,
  recordPublication,
} from "../../repository/worktrees.mjs";
import { runMigrateIdentifiersCommand } from "./command.mjs";

const executeFile = promisify(execFile);
const groupIdentifier = "-1001234567890";
const sessionKey = `${groupIdentifier}:7`;
const legacyWorktreeName = "topic_n1001234567890_7";
const legacyArchiveName = "topic_n1001234567890_8-before-1001";
const pullRequestNumber = 42;
const privateNames = /topic_n|1001234567890/u;

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
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-migrate-"));
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
  const worktrees = join(directory, "worktrees");
  const state = join(directory, "state");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  return {
    directory,
    repository,
    worktrees,
    state,
    environment: {
      MOUNTAIN_AGENT_REPOSITORY: "rboixaderg/mountain-runners",
      MOUNTAIN_AGENT_TELEGRAM_GROUP_ID: groupIdentifier,
      MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME: "mountain_agent_bot",
      MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN: "telegram-token",
      MOUNTAIN_AGENT_GITHUB_TOKEN: "github-token",
      MOUNTAIN_AGENT_REQUIRED_CHECKS: "Validate",
      MOUNTAIN_AGENT_SANDBOX_IMAGE: "mountain-agent-pi:1.5.0",
      MOUNTAIN_AGENT_REPOSITORY_PATH: repository,
      MOUNTAIN_AGENT_WORKTREE_PATH: worktrees,
      MOUNTAIN_AGENT_SESSION_PATH: join(directory, "sessions"),
      MOUNTAIN_AGENT_STATE_PATH: state,
    },
  };
}

/** A legacy worktree with a branch, a commit, pending work and a marker. */
async function legacyWorktree(paths, { published = true } = {}) {
  const worktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: legacyWorktreeName,
  });
  await createBranch({ worktree, branch: "feat/tools-legacy-change" });
  writeFileSync(join(worktree.path, "task.txt"), "published\n");
  const commit = await commitAll({ worktree, message: "feat: legacy change" });
  if (published) {
    recordPublication(worktree, commit);
  }
  writeFileSync(join(worktree.path, "pending.txt"), "pending\n");
  return { worktree, commit };
}

function markerContent(worktreeDirectory) {
  return readFileSync(join(worktreeDirectory, ".git"), "utf8");
}

function runCommand(environment) {
  const output = [];
  const errors = [];
  return runMigrateIdentifiersCommand({
    environment,
    write: (text) => output.push(text),
    warn: (message) => errors.push(message),
  }).then((status) => ({ status, output: output.join(""), errors }));
}

test("renames the worktree, its Git metadata and its archive", async (context) => {
  const paths = await fixture(context);
  const { worktree, commit } = await legacyWorktree(paths);
  const archive = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: legacyArchiveName,
  });
  assert.match(markerContent(worktree.path), /topic_n1001234567890_7/u);

  const result = await runCommand(paths.environment);

  assert.equal(result.status, 0, result.errors);
  const salt = readIdentifierSalt(paths.state);
  assert.match(salt, /^[0-9a-f]{64}$/u);
  const names = readdirSync(paths.worktrees);
  assert.equal(names.includes(legacyWorktreeName), false);
  assert.equal(names.includes(legacyArchiveName), false);
  const renamed = names.filter((entry) => entry.startsWith("topic-"));
  assert.equal(renamed.length, 2);
  for (const name of [
    ...renamed,
    ...readdirSync(join(paths.repository, ".git", "worktrees")),
  ]) {
    assert.doesNotMatch(name, privateNames);
  }
  for (const name of renamed) {
    assert.doesNotMatch(
      markerContent(join(paths.worktrees, name)),
      privateNames,
    );
  }

  const migrated = renamed.find((entry) => !entry.includes("-before-"));
  const migratedWorktree = await findSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: migrated,
  });
  assert.equal(
    await git(migratedWorktree.path, ["branch", "--show-current"]),
    "feat/tools-legacy-change",
  );
  assert.equal(await git(migratedWorktree.path, ["rev-parse", "HEAD"]), commit);
  assert.equal(
    await git(migratedWorktree.path, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]),
    "?? pending.txt",
  );
  assert.equal(publishedCommit(migratedWorktree), commit);
  assert.equal(existsSync(archive.path), false);
  assert.equal(
    markerContent(join(paths.worktrees, migrated)),
    `gitdir: ${migratedWorktree.gitDirectory}\n`,
  );
});

test("changes nothing on a second run and keeps Git working", async (context) => {
  const paths = await fixture(context);
  const { commit } = await legacyWorktree(paths);
  assert.equal((await runCommand(paths.environment)).status, 0);
  const after = readdirSync(paths.worktrees);

  const second = await runCommand(paths.environment);

  assert.equal(second.status, 0, second.errors);
  assert.match(second.output, /migrated 0 worktree\(s\)/u);
  assert.deepEqual(readdirSync(paths.worktrees), after);
  const migratedWorktree = await findSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: after[0],
  });
  assert.equal(await git(migratedWorktree.path, ["rev-parse", "HEAD"]), commit);
  assert.equal(
    await git(migratedWorktree.path, ["status", "--porcelain"]),
    "?? pending.txt",
  );
  assert.equal(
    (await git(paths.repository, ["worktree", "list", "--porcelain"])).includes(
      "topic_n",
    ),
    false,
  );
});

test("finishes a migration interrupted before the marker was rewritten", async (context) => {
  const paths = await fixture(context);
  const { commit } = await legacyWorktree(paths);
  assert.equal((await runCommand(paths.environment)).status, 0);
  const [migrated] = readdirSync(paths.worktrees);
  const migratedPath = join(paths.worktrees, migrated);
  const migratedWorktree = await findSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: migrated,
  });
  // The interruption: the administrative directory is already renamed and the
  // marker still names it with the private basename.
  writeFileSync(
    join(migratedPath, ".git"),
    `gitdir: ${join(paths.repository, ".git", "worktrees", legacyWorktreeName)}\n`,
  );
  assert.equal(lstatSync(join(migratedPath, ".git")).isFile(), true);

  const result = await runCommand(paths.environment);

  assert.equal(result.status, 0, result.errors);
  assert.equal(
    markerContent(migratedPath),
    `gitdir: ${migratedWorktree.gitDirectory}\n`,
  );
  assert.equal(await git(migratedPath, ["rev-parse", "HEAD"]), commit);
  assert.equal(
    await git(migratedPath, ["status", "--porcelain"]),
    "?? pending.txt",
  );
});

test("refuses a worktree whose Git marker is a symbolic link", async (context) => {
  const paths = await fixture(context);
  const { worktree } = await legacyWorktree(paths);
  const witness = join(paths.directory, "private-state.sqlite");
  writeFileSync(witness, "private\n");
  rmSync(join(worktree.path, ".git"));
  symlinkSync(witness, join(worktree.path, ".git"));

  const result = await runCommand(paths.environment);

  const names = createIdentifierNames({
    salt: readIdentifierSalt(paths.state),
  });
  const opaqueName = names.worktreeName(sessionKey);
  assert.equal(result.status, 1);
  assert.match(
    result.output,
    new RegExp(`worktree_marker_untrusted ${opaqueName}`, "u"),
  );
  assert.match(result.errors.join("\n"), /not a regular file/u);
  assert.match(result.errors.join("\n"), new RegExp(opaqueName, "u"));
  assert.equal(readFileSync(witness, "utf8"), "private\n");
  assert.equal(lstatSync(join(worktree.path, ".git")).isSymbolicLink(), true);
  assert.equal(
    existsSync(join(paths.worktrees, legacyWorktreeName)),
    true,
    "the legacy worktree is not moved",
  );
});

test("refuses an opaque worktree whose Git marker is a symbolic link", async (context) => {
  const paths = await fixture(context);
  const opaqueName = "topic-0123456789abcdef";
  const worktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: opaqueName,
  });
  const witness = join(paths.directory, "private-state.sqlite");
  writeFileSync(witness, "private\n");
  rmSync(join(worktree.path, ".git"));
  symlinkSync(witness, join(worktree.path, ".git"));

  const result = await runCommand(paths.environment);

  assert.equal(result.status, 1);
  assert.match(
    result.output,
    new RegExp(`worktree_marker_untrusted ${opaqueName}`, "u"),
  );
  assert.match(result.errors.join("\n"), /not a regular file/u);
  assert.equal(readFileSync(witness, "utf8"), "private\n");
  assert.equal(lstatSync(join(worktree.path, ".git")).isSymbolicLink(), true);
  assert.equal(existsSync(join(paths.worktrees, opaqueName)), true);
});

test("refuses an instruction case before the migration and resolves it after", async (context) => {
  const paths = await fixture(context);
  const { commit } = await legacyWorktree(paths, { published: false });
  mkdirSync(paths.state, { recursive: true });
  const store = new AdmissionQueue(join(paths.state, "admission.sqlite"), {
    maxPending: 10,
  });
  const watches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => {
    watches.close();
    store.close();
  });
  store.admit({
    updateIdentifier: 11,
    messageIdentifier: 1011,
    sessionKey,
    authorIdentifier: 42,
    instruction: "synthetic private instruction",
  });
  store.next();
  store.markUncertain(11, "uncertain");
  const config = {
    paths: {
      repository: paths.repository,
      worktrees: paths.worktrees,
      state: paths.state,
    },
  };
  const github = {
    async findOpenPullRequest() {
      return null;
    },
  };

  await assert.rejects(
    listUncertainCases({ config, stores: { instructions: store }, github }),
    { name: "ReconcileCaseError", message: /migrat/u },
  );
  assert.equal(
    existsSync(join(paths.state, "identifier-salt")),
    false,
    "reconciling never creates the salt",
  );

  assert.equal((await runCommand(paths.environment)).status, 0);

  const cases = await listUncertainCases({
    config,
    stores: { instructions: store },
    github,
  });
  assert.equal(cases.length, 1);
  assert.notEqual(cases[0].worktree, null);
  assert.equal(cases[0].worktree.head, commit);
  assert.equal(cases[0].worktree.published, false);

  await resolveUncertainCase({
    config,
    stores: { instructions: store, ciWatches: watches },
    telegram: { async sendMessage() {} },
    kind: "instruction",
    updateIdentifier: 11,
    resolution: reconcileResolutions.published,
    commit,
    pullRequestNumber,
  });

  assert.deepEqual(
    watches
      .pending()
      .map((row) => [row.update_identifier, row.pull_request_number]),
    [[11, pullRequestNumber]],
    "the confirmed publication gets the watch its registration lost",
  );

  const [migrated] = readdirSync(paths.worktrees);
  const migratedWorktree = await findSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: migrated,
  });
  assert.equal(publishedCommit(migratedWorktree), commit);
  assert.equal(store.uncertain().length, 0);
});
