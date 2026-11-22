// Operator command: install a reviewed commit of the agent (T10).
//
// Usage, as root on the VPS, from an operator-controlled checkout:
//   node commands/update/cli.mjs --repository <path> --commit <full sha>
//     [--installed <full sha>] [--image-rebuilt]
//     [--install-root <path>] [--backups <path>] [--data-root <path>]
//
// The deployment boundary of ADR 0013 and PR #281 does not change: only a
// reviewed commit of `main` is installed, the explicit approval of the
// maintainer is a precondition of whoever runs the command, and the command
// never starts the service. Every installed file comes from a fresh
// `git archive` of a checkout the operator controls; the clone the service
// writes is refused as a source.
//
// The command runs as root while `mountain-agent` writes the data root, so root
// never follows a path the agent controls. The installed trees and the checkout
// are root-owned; the state is read as the service user, which stores a link or
// a FIFO without following it, and the state directory itself must be a
// directory rather than a link.
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
  closeSync,
  constants,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
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

// The agent writes this clone and the whole data root: neither is a source of
// an installation and neither is a checkout root reads as an operator.
const serviceDataRoot = "/var/lib/mountain-runners-agent";
const serviceUser = "mountain-agent";

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
const fullRevisionPattern = /^[0-9a-f]{40}$/u;

// The checkout decides nothing about how Git runs: it is reviewed, but the
// command runs as root and a commit must not be able to point Git at a hook or
// a filesystem monitor of its own.
const gitConfiguration = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
];

// Every repository path the sandbox image copies or derives from. A change in
// one of them means the image of the new commit does not exist yet on the VPS.
// `commands/update/command.test.mjs` checks the list against the `COPY` lines of
// `tools/server/agent/sandbox/Containerfile`.
export const imageInputs = Object.freeze([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".node-version",
  "package.json",
  "apps/web/package.json",
  "packages/telegram-pi-bridge/package.json",
  "tools/server/agent/sandbox/Containerfile",
]);

const imageInputSet = new Set(imageInputs);

const usage = `Usage: node commands/update/cli.mjs --repository <path> --commit <sha>
         [--installed <sha>] [--image-rebuilt]
         [--install-root <path>] [--backups <path>] [--data-root <path>]

Install a reviewed commit of the agent from a checkout the operator controls.
The command checks, stops, backs up, installs and verifies; it never starts the
service and never reads agent.env.

Options:
  --repository <path>    checkout with origin/main, owned by root; the agent
                         clone and the data root are refused
  --commit <sha>         full 40-character commit to install; it must be
                         reachable from refs/remotes/origin/main
  --installed <sha>      full commit the installed tree must match; required
                         only when <install root>/agent.REVISION does not exist
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

/**
 * Run one program and send its output into a new private file. The file never
 * exists before the call and never has a public mode, so no other entry can be
 * raced through it.
 */
export function runProcessToFile(command, args, path) {
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    const result = spawnSync(command, args, {
      stdio: ["ignore", descriptor, "pipe"],
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
      stdout: "",
      stderr: result.stderr ?? "",
    };
  } finally {
    closeSync(descriptor);
  }
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
  if (!fullRevisionPattern.test(value ?? "")) {
    throw new UpdateUsageError(
      `${name} must be a full 40-character lowercase commit SHA; \`git rev-parse <short>\` prints it.`,
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

function resolvePath(realpath, path, description) {
  try {
    return realpath(path);
  } catch (error) {
    refuse(
      `The ${description} ${path} cannot be resolved: ${messageOf(error)}`,
    );
  }
}

/**
 * The checkout root is a reviewed, root-owned directory outside the data root.
 * The static check refuses the agent clone before anything is resolved; the
 * resolved paths then catch a checkout reached through a link.
 */
function checkedRepository({
  repository,
  dataRoot,
  realpath,
  getuid,
  statFile,
}) {
  if (
    repository === serviceDataRoot ||
    repository.startsWith(`${serviceDataRoot}${sep}`)
  ) {
    refuse(
      `Refusing ${repository} as the repository: the agent writes that clone, so it is never a source of an installation.`,
    );
  }
  if (getuid() !== 0) {
    refuse("The update installs root-owned code: run it as root (uid 0).");
  }
  const root = resolvePath(realpath, repository, "repository");
  const dataRootPath = resolvePath(realpath, dataRoot, "data root");
  if (root === dataRootPath || root.startsWith(`${dataRootPath}${sep}`)) {
    refuse(
      `Refusing ${root}: it is inside the data root ${dataRootPath}, which the agent writes.`,
    );
  }
  if (statFile(root).uid !== 0) {
    refuse(
      `Refusing ${root}: the checkout is not owned by root (uid 0), so the agent could rewrite it.`,
    );
  }
  return root;
}

function resolveCommit({ run, repository, revision, name }) {
  const result = run("git", [
    ...gitConfiguration,
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
  const stats = lstatOrNull(path);
  if (stats === null) {
    return null;
  }
  if (!stats.isFile()) {
    refuse(`${path} is not a regular file.`);
  }
  const recorded = readFileSync(path, "utf8").trim();
  if (!fullRevisionPattern.test(recorded)) {
    refuse(`${path} does not hold a full commit SHA.`);
  }
  return recorded;
}

/** `lstat` that answers `null` for a path that does not exist. */
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

// A tree entry is a directory, a regular file or something the command never
// follows: a symbolic link, a FIFO, a device or a socket.
const entryKinds = Object.freeze({
  directory: "directory",
  file: "file",
  other: "other",
});

/**
 * Every entry below `root`, relative and `/`-joined, classified from the
 * directory entry itself. Nothing below a link is ever read.
 */
function treeEntries(root, relativePath = "") {
  const entries = [];
  for (const entry of readdirSync(join(root, relativePath), {
    withFileTypes: true,
  })) {
    const path =
      relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      entries.push(
        { path, kind: entryKinds.directory },
        ...treeEntries(root, path),
      );
    } else if (entry.isFile()) {
      entries.push({ path, kind: entryKinds.file });
    } else {
      entries.push({ path, kind: entryKinds.other });
    }
  }
  return entries;
}

/** Refuse anything below `root` that is not a regular file or a directory. */
function assertPlainTree({ root, description }) {
  for (const entry of treeEntries(root)) {
    if (entry.kind === entryKinds.other) {
      refuse(
        `${description} contains ${entry.path}, which is not a regular file or a directory.`,
      );
    }
  }
}

/**
 * The service state is a directory or nothing. A link here would send the idle
 * check and the backup wherever the agent points them.
 */
function checkedStateDirectory(dataRoot) {
  const path = join(dataRoot, "state");
  const stats = lstatOrNull(path);
  if (stats === null) {
    return null;
  }
  if (!stats.isDirectory()) {
    refuse(
      `Refusing ${path}: the service state must be a directory, not a link or a file.`,
    );
  }
  return path;
}

/** Bytes of the regular files below `root`; links and special files count zero. */
function treeSize(root, relativePath = "") {
  let total = 0;
  for (const entry of readdirSync(join(root, relativePath), {
    withFileTypes: true,
  })) {
    const path =
      relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      total += treeSize(root, path);
    } else if (entry.isFile()) {
      total += lstatSync(join(root, path)).size;
    }
  }
  return total;
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
 * The command installs only from this tree, after checking that the archive
 * holds nothing but files and directories.
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
      ...gitConfiguration,
      // The global attributes file is not the operator's: a checkout cannot
      // add export-subst or export-ignore rules from outside the review.
      "-c",
      "core.attributesFile=/dev/null",
      "-C",
      repository,
      "archive",
      "--format=tar",
      "--output",
      archive,
      commit,
      "--",
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
  // Before any copy, hash or chmod: a link in the archive would be followed by
  // the copy and the digest would never describe what the review approved.
  assertPlainTree({
    root: extractRoot,
    description: `The archive of ${commit}`,
  });
  assertNoExportSubstitution({ root: extractRoot, commit });
  return {
    agent: join(extractRoot, "tools/server/agent"),
    bridge: join(extractRoot, "packages/telegram-pi-bridge"),
  };
}

/**
 * `export-subst` makes `git archive` rewrite the placeholders of a file, so the
 * archive no longer holds the reviewed bytes. The attributes of the archived
 * paths are refused; a `.gitattributes` outside them is a documented limitation
 * of this check, and it can only touch the content the author already reviewed.
 */
function assertNoExportSubstitution({ root, commit }) {
  for (const entry of treeEntries(root)) {
    if (
      entry.kind !== entryKinds.file ||
      entry.path.split("/").at(-1) !== ".gitattributes"
    ) {
      continue;
    }
    const content = readFileSync(join(root, entry.path), "utf8");
    if (/export-subst/u.test(content)) {
      refuse(
        `The archive of ${commit} carries export-subst (${entry.path}), so its bytes are not the reviewed ones; install it without archive attributes.`,
      );
    }
  }
}

/** Install-relative path to sha256 of every file the archive installs. */
function archiveDigests({ agent, bridge }) {
  const digests = new Map();
  for (const entry of treeEntries(agent)) {
    if (entry.kind === entryKinds.file) {
      digests.set(
        `${agentDirectory}/${entry.path}`,
        sha256OfFile(join(agent, entry.path)),
      );
    }
  }
  for (const entry of treeEntries(bridge)) {
    if (entry.kind === entryKinds.file && bridgeSelected(entry.path)) {
      digests.set(
        `${bridgeDirectory}/${entry.path}`,
        sha256OfFile(join(bridge, entry.path)),
      );
    }
  }
  return digests;
}

/**
 * Install-relative path to sha256 of every file of the installed tree. A path
 * that is not a regular file has no digest, so it never matches the archive.
 */
function installedDigests(installRoot) {
  const digests = new Map();
  const trees = [
    [agentDirectory, join(installRoot, agentDirectory)],
    [bridgeDirectory, join(installRoot, bridgeDirectory)],
  ];
  for (const [prefix, root] of trees) {
    if (lstatOrNull(root)?.isDirectory() !== true) {
      continue;
    }
    for (const entry of treeEntries(root)) {
      if (entry.kind === entryKinds.directory) {
        continue;
      }
      digests.set(
        `${prefix}/${entry.path}`,
        entry.kind === entryKinds.file
          ? sha256OfFile(join(root, entry.path))
          : null,
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
// unknown. The queries mirror the state constraints of the store modules:
// `instructions`, `repository/ci-watch-store.mjs`, the open merge states of
// `repository/merge-request-store.mjs` and the one open preview state of
// `repository/preview-request-store.mjs`, plus the cases that
// `commands/reconcile/uncertain-cases.mjs` lists through `uncertain()`,
// `uncertainRepairs()` and `uncertainNotices()`. The stores cannot be reused
// here: their constructors create and migrate the schema, and this check must
// not write, so the databases open read-only.
//
// `preview_requests` still accepts `commenting` and `uncertain` in its schema,
// but the service writes neither after the `/preview` retirement: only
// `awaiting` is a state a running turn can be in.
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
  {
    database: "merge-request.sqlite",
    label: "merging or uncertain merge requests",
    sql: "SELECT COUNT(*) AS count FROM merge_requests WHERE state IN ('merging', 'uncertain')",
  },
  {
    database: "preview-request.sqlite",
    label: "preview requests awaiting the publisher",
    sql: "SELECT COUNT(*) AS count FROM preview_requests WHERE state = 'awaiting'",
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

// A missing database has no row of its kind and is never created. A database
// that is a link is refused: SQLite would open the file the agent points at.
function readCount(statePath, query) {
  const path = join(statePath, query.database);
  const stats = lstatOrNull(path);
  if (stats === null) {
    return 0;
  }
  if (!stats.isFile()) {
    refuse(`Refusing ${path}: a state database must be a regular file.`);
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
  // The caller's umask must not decide the mode of the installed layout.
  chmodSync(path, 0o755);
}

/** Root ownership and the exact modes of an installed tree. */
function normaliseTree({ run, root }) {
  // The tree is checked before anything follows it: `chown -R` and the walk
  // below must never reach through a link.
  assertPlainTree({ root, description: `${root} before installation` });
  runOrRefuse(run, "chown", ["-R", "root:root", root], `chown of ${root}`);
  chmodSync(root, 0o755);
  for (const entry of treeEntries(root)) {
    if (entry.kind === entryKinds.other) {
      refuse(`${root} contains ${entry.path}, which is not a regular file.`);
    }
    chmodSync(
      join(root, entry.path),
      entry.kind === entryKinds.directory ? 0o755 : 0o644,
    );
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
    state: `state-${identity}-${timestamp}.tar`,
  };
}

/** A private copy: only root reads it, whatever the source modes were. */
function restrictTree(root) {
  chmodSync(root, 0o700);
  for (const entry of treeEntries(root)) {
    if (entry.kind === entryKinds.other) {
      refuse(`${root} contains ${entry.path}, which is not a regular file.`);
    }
    chmodSync(
      join(root, entry.path),
      entry.kind === entryKinds.directory ? 0o700 : 0o600,
    );
  }
}

/**
 * A root-owned tree is copied after checking that it holds only files and
 * directories, so the copy never follows a link and the chmod never reaches
 * through one.
 */
function copyPlainTree({ source, destination, description }) {
  assertPlainTree({ root: source, description });
  cpSync(source, destination, { recursive: true });
  restrictTree(destination);
}

/** The state size, measured as the service user so root never walks it. */
function serviceTreeSize({ run, stateDirectory }) {
  const result = run("runuser", [
    "-u",
    serviceUser,
    "--",
    "du",
    "--summarize",
    "--bytes",
    stateDirectory,
  ]);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    refuse(
      `Measuring ${stateDirectory} failed: ${detail === "" ? `exit ${result.status}` : detail}`,
    );
  }
  const bytes = Number(result.stdout.trim().split(/\s+/u)[0]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    refuse(`Measuring ${stateDirectory} printed an unexpected size.`);
  }
  return bytes;
}

/**
 * The backup needs its own room: twice the bytes of the trees and the state,
 * before anything is copied. The state is measured as the service user, because
 * root never walks the data root.
 */
function assertBackupSpace({ run, statfs, options, stateDirectory }) {
  const trees =
    treeSize(join(options.installRoot, agentDirectory)) +
    treeSize(join(options.installRoot, bridgeDirectory));
  const state =
    stateDirectory === null ? 0 : serviceTreeSize({ run, stateDirectory });
  const needed = 2 * (trees + state);
  const { bsize, bavail } = statfs(options.backupsRoot);
  const available = bsize * bavail;
  if (available < needed) {
    refuse(
      `The backup needs ${needed} bytes and ${available} are available in ${options.backupsRoot}; free space first ("Retenció" in docs/operations/agent.md).`,
    );
  }
}

/**
 * The state the service wrote, written as the service user into one private
 * regular file. A link or a FIFO the agent planted is stored by `tar`, never
 * followed, and root never walks or changes anything below the data root.
 */
function backupState({ stream, stateDirectory, path }) {
  const result = stream(
    "runuser",
    ["-u", serviceUser, "--", "tar", "-C", stateDirectory, "-cf", "-", "."],
    path,
  );
  if (result.status !== 0) {
    rmSync(path, { force: true });
    const detail = (result.stderr || result.stdout).trim();
    refuse(
      `The state backup failed: ${detail === "" ? `exit ${result.status}` : detail}`,
    );
  }
}

/**
 * The previous trees, the state and the previous revision, named with both
 * short commits and the UTC timestamp, and `agent-previous` pointing at the
 * agent backup. The state is copied only when it exists.
 */
function createBackups({
  run,
  stream,
  statfs,
  options,
  names,
  installed,
  stateDirectory,
  write,
}) {
  // The backups hold the state and the trace of the topics: only root reads
  // them, whatever mode the directory had.
  mkdirSync(options.backupsRoot, { recursive: true, mode: 0o700 });
  chmodSync(options.backupsRoot, 0o700);
  assertBackupSpace({ run, statfs, options, stateDirectory });

  const agentBackup = join(options.backupsRoot, names.agent);
  copyPlainTree({
    source: join(options.installRoot, agentDirectory),
    destination: agentBackup,
    description: "The installed agent tree",
  });
  copyPlainTree({
    source: join(options.installRoot, bridgeDirectory),
    destination: join(options.backupsRoot, names.bridge),
    description: "The installed bridge package",
  });
  if (stateDirectory !== null) {
    backupState({
      stream,
      stateDirectory,
      path: join(options.backupsRoot, names.state),
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
    stateDirectory === null
      ? "  state: not present, nothing to copy\n"
      : `  state: ${names.state}\n`,
  );
  return { stateBackedUp: stateDirectory !== null };
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
  if (
    lstatOrNull(join(options.dataRoot, "state", "identifier-salt")) === null
  ) {
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

function update(
  options,
  { run, stream, statfs, now, write, realpath, getuid, statFile },
) {
  const repository = checkedRepository({
    repository: options.repository,
    dataRoot: options.dataRoot,
    realpath,
    getuid,
    statFile,
  });
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
    [
      ...gitConfiguration,
      "-C",
      repository,
      "rev-parse",
      "--verify",
      "--quiet",
      "refs/remotes/origin/main",
    ],
    `refs/remotes/origin/main of ${repository}`,
  );
  const ancestry = run("git", [
    ...gitConfiguration,
    "-C",
    repository,
    "merge-base",
    "--is-ancestor",
    target,
    "refs/remotes/origin/main",
  ]);
  if (ancestry.status !== 0) {
    refuse(
      `${target} is not reachable from refs/remotes/origin/main of ${repository}.`,
    );
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

    // The state layout is checked before the service is stopped, and before
    // any read resolves a path through it.
    const stateDirectory = checkedStateDirectory(options.dataRoot);

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
      [
        ...gitConfiguration,
        "-C",
        repository,
        "diff",
        "--name-only",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        `${installed}..${target}`,
        "--",
      ],
      `git diff ${installed}..${target}`,
    )
      .stdout.split("\n")
      .filter((path) => path !== "");
    const imageChanges = changed.filter((path) => imageInputSet.has(path));
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

    // The archive of the target is extracted and checked before the service is
    // stopped: a commit whose archive holds a link or substituted content is
    // refused with nothing written.
    const targetTree = archiveTree({
      run,
      repository,
      commit: target,
      workRoot,
    });
    const expected = archiveDigests(targetTree);

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
    // A turn that started while the service was stopping still counts: nothing
    // is backed up or replaced while any row is in flight.
    const busyAfterStop = busyLines(statePath);
    if (busyAfterStop.length > 0) {
      refuse(
        `The service is busy after the stop; reconcile the cases and repeat:\n${busyAfterStop.join("\n")}`,
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
      run,
      stream,
      statfs,
      options,
      names,
      installed,
      stateDirectory,
      write,
    });

    // 7. Install from the checked archive, replacing both trees whole.
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
 * Run the command and return its exit code. The programs it calls, the roots it
 * works on and the identity checks are injectable, so a test runs it against
 * temporary directories with a fake `systemctl`, `chown`, `runuser` and stream.
 */
export function runUpdateCommand({
  argv = process.argv.slice(2),
  run = runProcess,
  stream = runProcessToFile,
  statfs = statfsSync,
  now = () => new Date(),
  roots = defaultRoots,
  realpath = realpathSync,
  getuid = () => process.getuid(),
  statFile = statSync,
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
    update(options, {
      run,
      stream,
      statfs,
      now,
      write,
      realpath,
      getuid,
      statFile,
    });
    return 0;
  } catch (error) {
    warn(messageOf(error));
    return 1;
  }
}
