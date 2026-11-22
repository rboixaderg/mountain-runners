// Operator command: install a reviewed commit of the agent (T10).
//
// Usage, as root on the VPS, from an operator-controlled checkout:
//   node commands/update/cli.mjs --repository <path> --commit <sha>
//     [--installed <sha>] [--image-rebuilt]
//     [--install-root <path>] [--backups <path>] [--data-root <path>]
//
// The deployment boundary of ADR 0013 and PR #281 does not change: only a
// reviewed commit of `main` is installed, the explicit approval of the
// maintainer is a precondition of whoever runs the command, and the command
// never starts the service. Every installed file comes from a fresh
// `git archive` of a checkout the operator controls; the clone the service
// writes is refused as a source.
//
// The recorded revision lives at `<install root>/agent.REVISION`, outside the
// installed `agent/` tree: the tree comparison then sees exactly the files the
// archive installs, and the marker can never be mistaken for one of them nor
// survive a directory swap by accident.
//
// The command never reads `agent.env` and prints no credential: it needs no
// service configuration at all.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const defaultRoots = Object.freeze({
  installRoot: "/usr/local/lib/mountain-runners",
  backupsRoot: "/var/backups/mountain-runners-agent",
  dataRoot: "/var/lib/mountain-runners-agent",
});

// The agent writes this clone: it is never a source of an installation.
const serviceDataRoot = "/var/lib/mountain-runners-agent";

const agentDirectory = "agent";
const bridgeDirectory = "node_modules/telegram-pi-bridge";
const revisionFile = "agent.REVISION";
const previousRevisionFile = "agent-previous.REVISION";
const previousLink = "agent-previous";

// The release tarball of 22 November 2026 copied the agent directory in full,
// tests included, and only these bridge entries. The installed tree must hold
// exactly that set: an extra file, a missing file or a different content is a
// tree that is not the recorded commit.
const bridgeEntries = [
  "src",
  "examples",
  "package.json",
  "LICENSE",
  "README.md",
];

const testFilePattern = /\.test\.[^/]+$/u;
const revisionPattern = /^[0-9a-f]{7,40}$/u;
const fullRevisionPattern = /^[0-9a-f]{40}$/u;

// Inputs of the sandbox image. A change in one of them means the image of the
// new commit does not exist yet on the VPS.
const imageInputs = new Set([
  "pnpm-lock.yaml",
  ".node-version",
  "package.json",
  "apps/web/package.json",
  "packages/telegram-pi-bridge/package.json",
  "tools/server/agent/sandbox/Containerfile",
]);

const usage = `Usage: node commands/update/cli.mjs --repository <path> --commit <sha>
         [--installed <sha>] [--image-rebuilt]
         [--install-root <path>] [--backups <path>] [--data-root <path>]

Install a reviewed commit of the agent from a checkout the operator controls.
The command checks, stops, backs up, installs and verifies; it never starts the
service and never reads agent.env.

Options:
  --repository <path>    checkout with origin/main; the agent clone is refused
  --commit <sha>         commit to install; it must be reachable from origin/main
  --installed <sha>      commit the installed tree must match; required only
                         when <install root>/agent.REVISION does not exist
  --image-rebuilt        the sandbox image of --commit is already built and
                         configured
  --install-root <path>  install root (default ${defaultRoots.installRoot})
  --backups <path>       backup root (default ${defaultRoots.backupsRoot})
  --data-root <path>     service data root (default ${defaultRoots.dataRoot})

Exit codes: 0 success, 1 refusal or failure, 2 usage error.
`;

/** A refusal: the command stops and changes nothing it has not already done. */
class UpdateRefusal extends Error {}

/** Misuse of the command line, reported before anything is read. */
class UpdateUsageError extends Error {}

function refuse(message) {
  throw new UpdateRefusal(message);
}

function messageOf(error) {
  return error instanceof Error ? error.message : "unknown error";
}

/** Run one program and return its exit status and output. */
export function runProcess(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new UpdateRefusal(
      `${command} could not run: ${result.error.message}`,
    );
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runOrRefuse(run, command, args, description) {
  const result = run(command, args);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    refuse(
      `${description} failed: ${detail === "" ? `exit ${result.status}` : detail}`,
    );
  }
  return result;
}

function readPath(value, name) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new UpdateUsageError(`${name} must be an absolute path.`);
  }
  return resolve(value);
}

function readRevision(value, name) {
  if (!revisionPattern.test(value ?? "")) {
    throw new UpdateUsageError(
      `${name} must be a lowercase hexadecimal commit SHA.`,
    );
  }
  return value;
}

/** Parse the command line without reading the filesystem or running anything. */
function parseArguments(argv, defaults) {
  let values;
  try {
    values = parseArgs({
      args: argv,
      options: {
        repository: { type: "string" },
        commit: { type: "string" },
        installed: { type: "string" },
        "image-rebuilt": { type: "boolean" },
        "install-root": { type: "string" },
        backups: { type: "string" },
        "data-root": { type: "string" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
      strict: true,
    }).values;
  } catch (error) {
    throw new UpdateUsageError(error.message);
  }
  if (values.help === true) {
    return { help: true };
  }
  if (values.repository === undefined) {
    throw new UpdateUsageError("--repository is required.");
  }
  if (values.commit === undefined) {
    throw new UpdateUsageError("--commit is required.");
  }
  return {
    repository: readPath(values.repository, "--repository"),
    commit: readRevision(values.commit, "--commit"),
    installed:
      values.installed === undefined
        ? undefined
        : readRevision(values.installed, "--installed"),
    imageRebuilt: values["image-rebuilt"] === true,
    installRoot:
      values["install-root"] === undefined
        ? defaults.installRoot
        : readPath(values["install-root"], "--install-root"),
    backupsRoot:
      values.backups === undefined
        ? defaults.backupsRoot
        : readPath(values.backups, "--backups"),
    dataRoot:
      values["data-root"] === undefined
        ? defaults.dataRoot
        : readPath(values["data-root"], "--data-root"),
  };
}

/** The service clone belongs to the agent: refuse it and anything below it. */
function checkedRepository(repository) {
  if (
    repository === serviceDataRoot ||
    repository.startsWith(`${serviceDataRoot}${sep}`)
  ) {
    refuse(
      `Refusing ${repository} as the repository: the agent writes that clone, so it is never a source of an installation.`,
    );
  }
  return repository;
}

function resolveCommit({ run, repository, revision, name }) {
  const result = run("git", [
    "-C",
    repository,
    "rev-parse",
    "--verify",
    "--quiet",
    `${revision}^{commit}`,
  ]);
  const resolved = result.stdout.trim();
  if (result.status !== 0 || !fullRevisionPattern.test(resolved)) {
    refuse(`${name} ${revision} is not a commit of ${repository}.`);
  }
  return resolved;
}

/** The revision recorded by the last install, or `null` when there is none. */
function readRecordedRevision(installRoot) {
  const path = join(installRoot, revisionFile);
  if (!existsSync(path)) {
    return null;
  }
  const recorded = readFileSync(path, "utf8").trim();
  if (!fullRevisionPattern.test(recorded)) {
    refuse(`${path} does not hold a full commit SHA.`);
  }
  return recorded;
}

/** Every directory and regular file below `root`, relative and `/`-joined. */
function treeEntries(root, relativePath = "") {
  const entries = [];
  for (const entry of readdirSync(join(root, relativePath), {
    withFileTypes: true,
  })) {
    const path =
      relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      entries.push({ path, directory: true }, ...treeEntries(root, path));
    } else {
      entries.push({ path, directory: false });
    }
  }
  return entries;
}

function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Whether a bridge path belongs to the release. */
function bridgeSelected(path) {
  return (
    bridgeEntries.includes(path.split("/")[0]) && !testFilePattern.test(path)
  );
}

/**
 * A fresh `git archive` of `commit`, extracted in the temporary work directory.
 * The command installs only from this tree.
 */
function archiveTree({ run, repository, commit, workRoot }) {
  // Each revision gets its own archive and directory: a later extraction must
  // never inherit a file the newer commit no longer has.
  const archive = join(workRoot, `${commit}.tar`);
  const extractRoot = join(workRoot, commit);
  runOrRefuse(
    run,
    "git",
    [
      "-C",
      repository,
      "archive",
      "--format=tar",
      "--output",
      archive,
      commit,
      "tools/server/agent",
      "packages/telegram-pi-bridge",
    ],
    `git archive ${commit}`,
  );
  mkdirSync(extractRoot, { recursive: true, mode: 0o700 });
  runOrRefuse(
    run,
    "tar",
    ["-x", "-f", archive, "-C", extractRoot],
    `extraction of the archive of ${commit}`,
  );
  return {
    agent: join(extractRoot, "tools/server/agent"),
    bridge: join(extractRoot, "packages/telegram-pi-bridge"),
  };
}

/** Install-relative path to sha256 of every file the archive installs. */
function archiveDigests({ agent, bridge }) {
  const digests = new Map();
  for (const entry of treeEntries(agent)) {
    if (!entry.directory) {
      digests.set(
        `${agentDirectory}/${entry.path}`,
        sha256OfFile(join(agent, entry.path)),
      );
    }
  }
  for (const entry of treeEntries(bridge)) {
    if (!entry.directory && bridgeSelected(entry.path)) {
      digests.set(
        `${bridgeDirectory}/${entry.path}`,
        sha256OfFile(join(bridge, entry.path)),
      );
    }
  }
  return digests;
}

/** Install-relative path to sha256 of every file of the installed tree. */
function installedDigests(installRoot) {
  const digests = new Map();
  const trees = [
    [agentDirectory, join(installRoot, agentDirectory)],
    [bridgeDirectory, join(installRoot, bridgeDirectory)],
  ];
  for (const [prefix, root] of trees) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of treeEntries(root)) {
      if (entry.directory) {
        continue;
      }
      const file = join(root, entry.path);
      digests.set(
        `${prefix}/${entry.path}`,
        lstatSync(file).isSymbolicLink() ? null : sha256OfFile(file),
      );
    }
  }
  return digests;
}

/** Added, missing and modified files of the installed tree, sorted. */
function compareTrees(expected, installed) {
  const differences = [];
  for (const [path, digest] of expected) {
    if (!installed.has(path)) {
      differences.push(`missing ${path}`);
    } else if (installed.get(path) !== digest) {
      differences.push(`modified ${path}`);
    }
  }
  for (const path of installed.keys()) {
    if (!expected.has(path)) {
      differences.push(`added ${path}`);
    }
  }
  return differences.sort();
}

function describeDifferences(differences) {
  const shown = differences.slice(0, 20).map((difference) => `  ${difference}`);
  const remaining = differences.length - shown.length;
  if (remaining > 0) {
    shown.push(`  ... and ${remaining} more`);
  }
  return shown.join("\n");
}

// Every row the service is working on and every row whose external result is
// unknown. The queries mirror the schema constraints of `instructions` and of
// `repository/ci-watch-store.mjs`, and the cases that
// `commands/reconcile/uncertain-cases.mjs` lists through `uncertain()`,
// `uncertainRepairs()` and `uncertainNotices()`. The stores cannot be reused
// here: their constructors create and migrate the schema, and this check must
// not write, so the databases open read-only.
const busyQueries = [
  {
    database: "admission.sqlite",
    label: "pending or running instructions",
    sql: "SELECT COUNT(*) AS count FROM instructions WHERE status IN ('pending', 'running')",
  },
  {
    database: "ci-watch.sqlite",
    label: "reserved, queued or running CI repairs",
    sql: "SELECT COUNT(*) AS count FROM ci_repairs WHERE status IN ('reserved', 'queued', 'running')",
  },
  {
    database: "ci-watch.sqlite",
    label: "pending, sending or uncertain CI notices",
    sql: "SELECT COUNT(*) AS count FROM ci_watches WHERE state IN ('pending', 'sending', 'uncertain')",
  },
];

const uncertainQueries = [
  {
    kind: "instruction",
    database: "admission.sqlite",
    sql: "SELECT COUNT(*) AS count FROM instructions WHERE status = 'uncertain'",
  },
  {
    kind: "repair",
    database: "ci-watch.sqlite",
    sql: "SELECT COUNT(*) AS count FROM ci_repairs WHERE status = 'uncertain'",
  },
  {
    kind: "notice",
    database: "ci-watch.sqlite",
    sql: "SELECT COUNT(*) AS count FROM ci_watches WHERE state = 'uncertain'",
  },
];

// A missing database has no row of its kind and is never created.
function readCount(statePath, query) {
  const path = join(statePath, query.database);
  if (!existsSync(path)) {
    return 0;
  }
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database.prepare(query.sql).get().count;
  } catch (error) {
    refuse(`Cannot read ${path}: ${messageOf(error)}`);
  } finally {
    database.close();
  }
}

/** One line per kind of work in flight or of unknown result. */
function busyLines(statePath) {
  const lines = [];
  for (const query of busyQueries) {
    const count = readCount(statePath, query);
    if (count > 0) {
      lines.push(`  ${query.label}: ${count}`);
    }
  }
  for (const query of uncertainQueries) {
    const count = readCount(statePath, query);
    if (count > 0) {
      lines.push(`  uncertain ${query.kind} case(s): ${count}`);
    }
  }
  return lines;
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o755 });
}

/** Root ownership and the exact modes of an installed tree. */
function normaliseTree({ run, root }) {
  runOrRefuse(run, "chown", ["-R", "root:root", root], `chown of ${root}`);
  for (const entry of treeEntries(root)) {
    chmodSync(join(root, entry.path), entry.directory ? 0o755 : 0o644);
  }
}

function swapDirectory({ live, staged }) {
  const previous = `${live}.old`;
  rmSync(previous, { recursive: true, force: true });
  renameSync(live, previous);
  renameSync(staged, live);
  rmSync(previous, { recursive: true, force: true });
}

/** Build both trees beside the live directories and replace them whole. */
function installTree({ run, tree, installRoot }) {
  const agentLive = join(installRoot, agentDirectory);
  const agentStaged = `${agentLive}.new`;
  const bridgeLive = join(installRoot, bridgeDirectory);
  const bridgeStaged = `${bridgeLive}.new`;
  ensureDirectory(join(installRoot, "node_modules"));
  rmSync(agentStaged, { recursive: true, force: true });
  rmSync(bridgeStaged, { recursive: true, force: true });

  cpSync(tree.agent, agentStaged, { recursive: true });
  cpSync(tree.bridge, bridgeStaged, {
    recursive: true,
    filter: (source) => {
      const path = relative(tree.bridge, source).split(sep).join("/");
      return path === "" || bridgeSelected(path);
    },
  });
  normaliseTree({ run, root: agentStaged });
  normaliseTree({ run, root: bridgeStaged });

  swapDirectory({ live: agentLive, staged: agentStaged });
  swapDirectory({ live: bridgeLive, staged: bridgeStaged });
}

function utcTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "Z");
}

function backupNames({ installed, target, timestamp }) {
  const identity = `${installed.slice(0, 7)}-to-${target.slice(0, 7)}`;
  return {
    agent: `agent-${identity}-${timestamp}`,
    bridge: `telegram-pi-bridge-${identity}-${timestamp}`,
    state: `state-${identity}-${timestamp}`,
  };
}

/** A private copy: only root reads it, whatever the source modes were. */
function restrictTree(root) {
  chmodSync(root, 0o700);
  for (const entry of treeEntries(root)) {
    chmodSync(join(root, entry.path), entry.directory ? 0o700 : 0o600);
  }
}

function copyBackup({ source, destination }) {
  cpSync(source, destination, { recursive: true });
  restrictTree(destination);
}

/**
 * The previous trees, the state and the previous revision, named with both
 * short commits and the UTC timestamp, and `agent-previous` pointing at the
 * agent backup. The state is copied only when it exists.
 */
function createBackups({ options, names, installed, write }) {
  // The backups hold the state and the trace of the topics: only root reads
  // them, whatever mode the directory had.
  mkdirSync(options.backupsRoot, { recursive: true, mode: 0o700 });
  chmodSync(options.backupsRoot, 0o700);
  const agentBackup = join(options.backupsRoot, names.agent);
  copyBackup({
    source: join(options.installRoot, agentDirectory),
    destination: agentBackup,
  });
  copyBackup({
    source: join(options.installRoot, bridgeDirectory),
    destination: join(options.backupsRoot, names.bridge),
  });
  const stateDirectory = join(options.dataRoot, "state");
  const stateBackedUp = existsSync(stateDirectory);
  if (stateBackedUp) {
    copyBackup({
      source: stateDirectory,
      destination: join(options.backupsRoot, names.state),
    });
  }
  const link = join(options.backupsRoot, previousLink);
  rmSync(link, { force: true });
  symlinkSync(names.agent, link);
  // The rollback restores this revision in the marker the install replaces.
  const previousRevision = join(options.backupsRoot, previousRevisionFile);
  writeFileSync(previousRevision, `${installed}\n`);
  chmodSync(previousRevision, 0o600);
  write(`Backups in ${options.backupsRoot}:\n`);
  write(`  agent: ${names.agent}\n`);
  write(`  bridge: ${names.bridge}\n`);
  write(
    stateBackedUp
      ? `  state: ${names.state}\n`
      : "  state: not present, nothing to copy\n",
  );
  return { stateBackedUp };
}

function writeRevision(installRoot, revision) {
  const path = join(installRoot, revisionFile);
  writeFileSync(path, `${revision}\n`);
  chmodSync(path, 0o644);
  return path;
}

/** The image, the operator actions and the steps that follow the install. */
function report({
  options,
  names,
  target,
  imageChanges,
  operatorActions,
  stateBackedUp,
  revisionPath,
  write,
}) {
  const lines = [
    `Installed ${target}.`,
    `Revision recorded in ${revisionPath}.`,
  ];
  if (imageChanges.length > 0) {
    lines.push(
      `The sandbox image was declared rebuilt; its inputs changed: ${imageChanges.join(", ")}.`,
    );
  }
  if (operatorActions.length > 0) {
    lines.push("", "Operator actions before starting:");
    lines.push(...operatorActions.map((action) => `  - ${action}`));
  }
  lines.push("", "Next steps:");
  // Reconcile cases and a busy state refuse the update, so nothing is left to
  // reconcile here; only the migration can still apply.
  if (!existsSync(join(options.dataRoot, "state", "identifier-salt"))) {
    lines.push(
      "  The identifier migration has not run for this installation; run it as the",
      "  service identity before starting:",
      "    systemd-run --pipe --wait --uid=mountain-agent --gid=mountain-agent \\",
      "      -p EnvironmentFile=/etc/mountain-runners-agent/agent.env -p UMask=0077 \\",
      `      /usr/bin/node ${join(options.installRoot, agentDirectory, "commands/migrate-identifiers/cli.mjs")}`,
    );
  }
  lines.push(
    "  Start the service:",
    "    systemctl start mountain-agent",
    "  Then check it:",
    "    systemctl is-active mountain-agent",
    "    journalctl -u mountain-agent -n 100",
    "  and ask the topic a question that creates no branch.",
    `  Roll back with the backup ${names.agent} ("Tornar enrere" in docs/operations/agent.md).`,
  );
  if (!stateBackedUp) {
    lines.push(
      "  The state directory was not present: there is no state backup.",
    );
  }
  lines.push("", "The service was not started.");
  write(`${lines.join("\n")}\n`);
}

function update(options, { run, now, write }) {
  const repository = checkedRepository(options.repository);
  const statePath = join(options.dataRoot, "state");

  // 1. The target commit is a commit of the checkout and is on `main`.
  const target = resolveCommit({
    run,
    repository,
    revision: options.commit,
    name: "--commit",
  });
  runOrRefuse(
    run,
    "git",
    ["-C", repository, "rev-parse", "--verify", "--quiet", "origin/main"],
    `origin/main of ${repository}`,
  );
  const ancestry = run("git", [
    "-C",
    repository,
    "merge-base",
    "--is-ancestor",
    target,
    "origin/main",
  ]);
  if (ancestry.status !== 0) {
    refuse(`${target} is not reachable from origin/main of ${repository}.`);
  }
  write(`${target} is reachable from origin/main.\n`);

  // 2. The installed tree must be the recorded revision, or the declared one
  // on the first run of the command.
  const recorded = readRecordedRevision(options.installRoot);
  const declared =
    options.installed === undefined
      ? null
      : resolveCommit({
          run,
          repository,
          revision: options.installed,
          name: "--installed",
        });
  if (recorded === null && declared === null) {
    refuse(
      `There is no ${join(options.installRoot, revisionFile)} yet: pass --installed with the commit the installed tree must match.`,
    );
  }
  if (recorded !== null && declared !== null && declared !== recorded) {
    refuse(
      `${join(options.installRoot, revisionFile)} records ${recorded}, and --installed says ${declared}.`,
    );
  }
  const installed = recorded ?? declared;

  const workRoot = mkdtempSync(join(tmpdir(), "mr-agent-update-"));
  try {
    const installedTree = archiveTree({
      run,
      repository,
      commit: installed,
      workRoot,
    });
    const installedDifferences = compareTrees(
      archiveDigests(installedTree),
      installedDigests(options.installRoot),
    );
    if (installedDifferences.length > 0) {
      refuse(
        `The installed tree does not match ${installed}:\n${describeDifferences(installedDifferences)}`,
      );
    }
    write(`The installed tree matches ${installed}.\n`);

    // 3. Nothing is in flight and no external result is unknown. The databases
    // open read-only while the service still runs.
    const busy = busyLines(statePath);
    if (busy.length > 0) {
      refuse(
        `The service is busy; reconcile the cases and repeat:\n${busy.join("\n")}`,
      );
    }
    write("The service is idle.\n");

    // 4. The sandbox image is checked before anything is stopped.
    const changed = runOrRefuse(
      run,
      "git",
      ["-C", repository, "diff", "--name-only", `${installed}..${target}`],
      `git diff ${installed}..${target}`,
    )
      .stdout.split("\n")
      .filter((path) => path !== "");
    const imageChanges = changed.filter((path) => imageInputs.has(path));
    if (imageChanges.length > 0 && !options.imageRebuilt) {
      refuse(
        `The sandbox image inputs changed:\n${imageChanges.map((path) => `  ${path}`).join("\n")}\n` +
          'Rebuild the image ("Reconstruir la imatge del sandbox" in docs/operations/agent.md) ' +
          "and repeat with --image-rebuilt.",
      );
    }
    const operatorActions = changed
      .filter((path) => path.startsWith("tools/server/systemd/"))
      .map((path) => `${path} changed: reinstall it from ${target}.`);
    if (changed.includes(".env.example")) {
      operatorActions.push(
        ".env.example changed: compare it with agent.env and add the new variables.",
      );
    }

    // 5. Stop the service and confirm that it is not active.
    runOrRefuse(
      run,
      "systemctl",
      ["stop", "mountain-agent"],
      "systemctl stop mountain-agent",
    );
    const activeState = run("systemctl", [
      "is-active",
      "mountain-agent",
    ]).stdout.trim();
    if (activeState !== "inactive" && activeState !== "failed") {
      refuse(
        `systemctl is-active reports ${JSON.stringify(activeState)} after the stop: the service may still work.`,
      );
    }
    write("mountain-agent is stopped.\n");

    // 6. Back up the trees, the state and the previous revision.
    const names = backupNames({
      installed,
      target,
      timestamp: utcTimestamp(now()),
    });
    const { stateBackedUp } = createBackups({
      options,
      names,
      installed,
      write,
    });

    // 7. Install from a fresh archive of the target, replacing both trees whole.
    const targetTree = archiveTree({
      run,
      repository,
      commit: target,
      workRoot,
    });
    const expected = archiveDigests(targetTree);
    installTree({ run, tree: targetTree, installRoot: options.installRoot });

    // 8. Every installed file must be the archive file, and only then is the
    // revision recorded.
    const differences = compareTrees(
      expected,
      installedDigests(options.installRoot),
    );
    if (differences.length > 0) {
      refuse(
        `The installed tree does not match ${target} after the install:\n${describeDifferences(differences)}\n` +
          `Restore the backup in ${options.backupsRoot} if the mismatch is not resolved.`,
      );
    }
    const revisionPath = writeRevision(options.installRoot, target);

    report({
      options,
      names,
      target,
      imageChanges,
      operatorActions,
      stateBackedUp,
      revisionPath,
      write,
    });
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

/**
 * Run the command and return its exit code. The programs it calls and the roots
 * it works on are injectable, so a test runs it against temporary directories
 * with a fake `systemctl`, `chown` and `git`.
 */
export function runUpdateCommand({
  argv = process.argv.slice(2),
  run = runProcess,
  now = () => new Date(),
  roots = defaultRoots,
  write = (text) => process.stdout.write(text),
  warn = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  let options;
  try {
    options = parseArguments(argv, roots);
  } catch (error) {
    warn(`${messageOf(error)}\n\n${usage}`);
    return 2;
  }
  if (options.help) {
    write(usage);
    return 0;
  }
  try {
    update(options, { run, now, write });
    return 0;
  } catch (error) {
    warn(messageOf(error));
    return 1;
  }
}
