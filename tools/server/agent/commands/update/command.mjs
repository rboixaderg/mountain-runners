// Operator command: install a reviewed commit of the agent.
//
// ADR 0013: only a reviewed commit of `main` is installed, from a root-owned
// checkout of the operator, and the command never starts the service. It never
// reads agent.env. `agent.REVISION` lives outside the installed trees.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
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
import { join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const defaultRoots = Object.freeze({
  installRoot: "/usr/local/lib/mountain-runners",
  backupsRoot: "/var/backups/mountain-runners-agent",
  dataRoot: "/var/lib/mountain-runners-agent",
});

const serviceUser = "mountain-agent";
const agentDirectory = "agent";
const bridgeDirectory = "node_modules/telegram-pi-bridge";

// What `git archive` takes for each installed directory: the agent in full and
// the bridge without its tests. The bridge entries are not listed one by one:
// this command also archives the installed revision, which may carry entries
// that a newer one removed, and `git archive` fails on a path it cannot match.
const bridgeSource = "packages/telegram-pi-bridge";
const releaseSources = {
  [agentDirectory]: "tools/server/agent",
  [bridgeDirectory]: bridgeSource,
};
const releasePathspecs = [
  releaseSources[agentDirectory],
  bridgeSource,
  `:(exclude)${bridgeSource}/test`,
  `:(exclude,glob)${bridgeSource}/**/*.test.*`,
];
const fullRevisionPattern = /^[0-9a-f]{40}$/u;

// The state volume is 1 GiB and the installed trees are a few MB.
const minimumBackupBytes = 1024 ** 3;

// Every repository path the sandbox image copies or derives from. A change in
// one of them means the image of the new commit does not exist yet on the VPS.
export const imageInputs = Object.freeze([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".node-version",
  "package.json",
  "apps/web/package.json",
  "packages/telegram-pi-bridge/package.json",
  "tools/server/agent/sandbox/Containerfile",
]);

// Work in flight or of unknown result. The stores cannot be reused: their
// constructors write the schema, and this check only reads. A pending CI watch
// is not busy: it resumes after a restart (ADR 0014).
const busyQueries = [
  [
    "admission",
    "instructions",
    "status IN ('pending', 'running')",
    "pending or running instructions",
  ],
  [
    "admission",
    "instructions",
    "status = 'uncertain'",
    "uncertain instructions",
  ],
  [
    "merge-request",
    "merge_requests",
    "state IN ('merging', 'uncertain')",
    "merging or uncertain merge requests",
  ],
  [
    "preview-request",
    "preview_requests",
    "state = 'awaiting'",
    "awaiting preview requests",
  ],
];

const usage = `Usage: node commands/update/cli.mjs --repository <path> --commit <sha>
         [--installed <sha>] [--image-rebuilt]
         [--install-root <path>] [--backups <path>] [--data-root <path>]

Install a reviewed commit of the agent; the service is never started.
--installed is required only while <install root>/agent.REVISION does not exist.
Both commits are full 40-character SHAs.

Exit codes: 0 success, 1 refusal or failure, 2 usage error.
`;

function refuse(message) {
  throw new Error(message);
}

/**
 * Run one program. With `outputPath`, its output goes into a new file that only
 * root reads.
 */
export function runProcess(command, args, { outputPath } = {}) {
  const output =
    outputPath === undefined ? "pipe" : openSync(outputPath, "wx", 0o600);
  try {
    const result = spawnSync(command, args, {
      stdio: ["ignore", output, "pipe"],
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.error?.message ?? result.stderr ?? "",
    };
  } finally {
    if (output !== "pipe") {
      closeSync(output);
    }
  }
}

function runOrRefuse(run, command, args, description, options) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit ${result.status}`;
    refuse(`${description} failed: ${detail}`);
  }
  return result.stdout;
}

/** Parse the command line without reading the filesystem or running anything. */
function parseArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      repository: { type: "string" },
      commit: { type: "string" },
      installed: { type: "string" },
      "image-rebuilt": { type: "boolean", default: false },
      "install-root": { type: "string", default: defaultRoots.installRoot },
      backups: { type: "string", default: defaultRoots.backupsRoot },
      "data-root": { type: "string", default: defaultRoots.dataRoot },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    return { help: true };
  }
  if (values.repository === undefined) {
    throw new Error("--repository is required.");
  }
  if (values.commit === undefined) {
    throw new Error("--commit is required.");
  }
  for (const revision of [values.commit, values.installed]) {
    if (revision !== undefined && !fullRevisionPattern.test(revision)) {
      throw new Error(
        "A commit must be a full 40-character lowercase SHA; `git rev-parse <short>` prints it.",
      );
    }
  }
  return {
    repository: resolve(values.repository),
    commit: values.commit,
    installed: values.installed,
    imageRebuilt: values["image-rebuilt"],
    installRoot: resolve(values["install-root"]),
    backupsRoot: resolve(values.backups),
    dataRoot: resolve(values["data-root"]),
  };
}

/** The checkout is a root-owned directory outside what the agent writes. */
function checkedRepository(options, { getuid, statFile }) {
  if (getuid() !== 0) {
    refuse("The update installs root-owned code: run it as root (uid 0).");
  }
  const repository = realpathSync(options.repository);
  const dataRoot = realpathSync(options.dataRoot);
  if (repository === dataRoot || repository.startsWith(`${dataRoot}${sep}`)) {
    refuse(
      `Refusing ${repository}: it is inside the data root ${dataRoot}, which the agent writes.`,
    );
  }
  if (statFile(repository).uid !== 0) {
    refuse(
      `Refusing ${repository}: the checkout is not owned by root (uid 0), so the agent could rewrite it.`,
    );
  }
  return repository;
}

/**
 * Every entry below `root`. A link or a special file is refused: a copy or a
 * chmod would follow it and no digest would describe it.
 */
function treeEntries(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true }).map(
    (entry) => {
      const path = join(entry.parentPath, entry.name);
      if (!entry.isDirectory() && !entry.isFile()) {
        refuse(
          `${path} is not a regular file or a directory: refusing the tree.`,
        );
      }
      return { path, isDirectory: entry.isDirectory() };
    },
  );
}

/**
 * Install-relative path to sha256 of every file below the directory that
 * `sourceOf` names for each installed directory.
 */
function treeDigests(sourceOf) {
  const digests = new Map();
  for (const directory of [agentDirectory, bridgeDirectory]) {
    const base = sourceOf(directory);
    if (!existsSync(base)) {
      continue;
    }
    for (const { path, isDirectory } of treeEntries(base)) {
      if (!isDirectory) {
        const content = readFileSync(path);
        digests.set(
          `${directory}/${relative(base, path)}`,
          createHash("sha256").update(content).digest("hex"),
        );
      }
    }
  }
  return digests;
}

/** Refuse unless the files below `root` are exactly the expected ones. */
function assertSameTree({ expected, installRoot, message }) {
  const actual = treeDigests((directory) => join(installRoot, directory));
  const differences = [];
  for (const [path, digest] of expected) {
    if (!actual.has(path)) {
      differences.push(`missing ${path}`);
    } else if (actual.get(path) !== digest) {
      differences.push(`modified ${path}`);
    }
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) {
      differences.push(`added ${path}`);
    }
  }
  if (differences.length > 0) {
    const shown = differences.sort().slice(0, 20).join("\n  ");
    refuse(`${message} (${differences.length} differences):\n  ${shown}`);
  }
}

/**
 * A fresh `git archive` of `commit` in a new directory below `workRoot`.
 * Returns where the source of each installed directory was extracted.
 */
function releaseTree({ run, repository, commit, workRoot }) {
  const root = mkdtempSync(join(workRoot, "release-"));
  const archive = `${root}.tar`;
  runOrRefuse(
    run,
    "git",
    [
      // Attributes outside the review cannot rewrite or drop archived files.
      "-c",
      "core.attributesFile=/dev/null",
      "-C",
      repository,
      "archive",
      "--output",
      archive,
      commit,
      "--",
      ...releasePathspecs,
    ],
    `git archive ${commit}`,
  );
  runOrRefuse(
    run,
    "tar",
    ["-x", "-f", archive, "-C", root],
    `extraction of the archive of ${commit}`,
  );
  // A link in the archive is refused here, before anything follows it.
  treeEntries(root);
  return (directory) => join(root, releaseSources[directory]);
}

function assertIdle(statePath, message) {
  const lines = [];
  for (const [name, table, condition, label] of busyQueries) {
    const path = join(statePath, `${name}.sqlite`);
    // A missing database has no row of its kind and is never created.
    const stats = lstatSync(path, { throwIfNoEntry: false });
    if (stats === undefined) {
      continue;
    }
    // Opening a FIFO would block, and a link points wherever the agent chose.
    if (!stats.isFile()) {
      refuse(`Refusing ${path}: a state database must be a regular file.`);
    }
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const { count } = database
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`)
        .get();
      if (count > 0) {
        lines.push(`  ${label}: ${count}`);
      }
    } finally {
      database.close();
    }
  }
  if (lines.length > 0) {
    refuse(`${message}; reconcile the cases and repeat:\n${lines.join("\n")}`);
  }
}

/**
 * The previous trees, the state and the previous revision, with
 * `agent-previous` pointing at the agent backup.
 */
function createBackups({ run, options, installed, target, timestamp, write }) {
  const { backupsRoot, installRoot, dataRoot } = options;
  const identity = `${installed.slice(0, 7)}-to-${target.slice(0, 7)}-${timestamp}`;
  const names = {
    agent: `agent-${identity}`,
    bridge: `telegram-pi-bridge-${identity}`,
    state: `state-${identity}.tar`,
  };
  cpSync(join(installRoot, agentDirectory), join(backupsRoot, names.agent), {
    recursive: true,
  });
  cpSync(join(installRoot, bridgeDirectory), join(backupsRoot, names.bridge), {
    recursive: true,
  });

  const statePath = join(dataRoot, "state");
  const hasState = existsSync(statePath);
  if (hasState) {
    // The service user reads its own state, so a link it planted never makes
    // root read anything. `lost+found` of the volume is unreadable for it.
    // GNU tar writes the holes of a sparse file in full without `--sparse`,
    // past the free-space check; bsdtar has no such flag and skips them.
    const isGnuTar = runOrRefuse(
      run,
      "tar",
      ["--version"],
      "tar --version",
    ).includes("GNU tar");
    const path = join(backupsRoot, names.state);
    try {
      runOrRefuse(
        run,
        "runuser",
        [
          "-u",
          serviceUser,
          "--",
          "tar",
          "-C",
          statePath,
          "-cf",
          "-",
          "--exclude=./lost+found",
          ...(isGnuTar ? ["--sparse"] : []),
          ".",
        ],
        "The state backup",
        { outputPath: path },
      );
    } catch (error) {
      // A partial archive must not look like a backup.
      rmSync(path, { force: true });
      throw error;
    }
  }

  const link = join(backupsRoot, "agent-previous");
  rmSync(link, { force: true });
  symlinkSync(names.agent, link);
  writeFileSync(join(backupsRoot, "agent-previous.REVISION"), `${installed}\n`);
  write(`Backups in ${backupsRoot}:\n`);
  write(`  agent: ${names.agent}\n`);
  write(`  bridge: ${names.bridge}\n`);
  write(
    `  state: ${hasState ? names.state : "not present, nothing to copy"}\n`,
  );
  return names;
}

/** Build both trees beside the live directories and swap them by rename. */
function installTree({ run, sourceOf, installRoot }) {
  const swaps = [agentDirectory, bridgeDirectory].map((directory) => ({
    live: join(installRoot, directory),
    staged: join(installRoot, `${directory}.new`),
    source: sourceOf(directory),
  }));
  for (const { staged, source } of swaps) {
    rmSync(staged, { recursive: true, force: true });
    cpSync(source, staged, { recursive: true });
    runOrRefuse(
      run,
      "chown",
      ["-R", "root:root", staged],
      `chown of ${staged}`,
    );
    chmodSync(staged, 0o755);
    for (const { path, isDirectory } of treeEntries(staged)) {
      chmodSync(path, isDirectory ? 0o755 : 0o644);
    }
  }
  for (const { live, staged } of swaps) {
    const previous = `${live}.old`;
    rmSync(previous, { recursive: true, force: true });
    renameSync(live, previous);
    renameSync(staged, live);
    rmSync(previous, { recursive: true, force: true });
  }
}

/** The operator actions and the steps that follow the install. */
function report({ target, changed, backup, revisionPath, write }) {
  const operatorActions = changed
    .filter((path) => path.startsWith("tools/server/systemd/"))
    .map((path) => `  - ${path} changed: reinstall it from ${target}.`);
  if (changed.includes(".env.example")) {
    operatorActions.push(
      "  - .env.example changed: compare it with agent.env and add the new variables.",
    );
  }
  const lines = [
    `Installed ${target}.`,
    `Revision recorded in ${revisionPath}.`,
  ];
  if (operatorActions.length > 0) {
    lines.push("", "Operator actions before starting:", ...operatorActions);
  }
  lines.push(
    "",
    'Next: start and check the service ("Actualitzar" in docs/operations/agent.md).',
    `Roll back with the backup ${backup} ("Tornar enrere").`,
    "",
    "The service was not started.",
  );
  write(`${lines.join("\n")}\n`);
}

function update(options, { run, statfs, now, write, getuid, statFile }) {
  const repository = checkedRepository(options, { getuid, statFile });
  const { installRoot, backupsRoot, commit: target } = options;
  const statePath = join(options.dataRoot, "state");

  const git = ["-C", repository];
  runOrRefuse(
    run,
    "git",
    [...git, "merge-base", "--is-ancestor", target, "refs/remotes/origin/main"],
    `${target} is not reachable from refs/remotes/origin/main of ${repository}: the check`,
  );
  write(`${target} is reachable from origin/main.\n`);

  const revisionPath = join(installRoot, "agent.REVISION");
  const recorded = existsSync(revisionPath)
    ? readFileSync(revisionPath, "utf8").trim()
    : undefined;
  if (recorded === undefined && options.installed === undefined) {
    refuse(
      `There is no ${revisionPath} yet: pass --installed with the commit the installed tree must match.`,
    );
  }
  if (
    recorded !== undefined &&
    options.installed !== undefined &&
    options.installed !== recorded
  ) {
    refuse(
      `${revisionPath} records ${recorded}, and --installed says ${options.installed}.`,
    );
  }
  const installed = recorded ?? options.installed;

  const workRoot = mkdtempSync(join(tmpdir(), "mr-agent-update-"));
  try {
    const release = (commit) =>
      releaseTree({ run, repository, commit, workRoot });
    assertSameTree({
      expected: treeDigests(release(installed)),
      installRoot,
      message: `The installed tree does not match ${installed}`,
    });
    write(`The installed tree matches ${installed}.\n`);

    // Everything that can refuse runs while the service still works.
    assertIdle(statePath, "The service is busy");
    write("The service is idle.\n");

    const changed = runOrRefuse(
      run,
      "git",
      [...git, "diff", "--name-only", "--no-renames", installed, target, "--"],
      `git diff ${installed}..${target}`,
    )
      .split("\n")
      .filter((path) => path !== "");
    const imageChanges = changed.filter((path) => imageInputs.includes(path));
    if (imageChanges.length > 0 && !options.imageRebuilt) {
      refuse(
        `The sandbox image inputs changed:\n  ${imageChanges.join("\n  ")}\n` +
          'Rebuild the image ("Reconstruir la imatge del sandbox" in docs/operations/agent.md) ' +
          "and repeat with --image-rebuilt.",
      );
    }

    // `export-subst` makes the archive differ from the reviewed bytes. `git
    // grep` exits 1 only when no attributes file of the commit mentions it.
    const substitution = run("git", [
      ...git,
      ...["grep", "--quiet", "export-subst", target],
      ...["--", ":(glob)**/.gitattributes"],
    ]);
    if (substitution.status !== 1) {
      refuse(`Refusing ${target}: its .gitattributes carry export-subst.`);
    }
    const targetSource = release(target);
    const expected = treeDigests(targetSource);

    // The backups hold private state: only root enters this directory.
    mkdirSync(backupsRoot, { recursive: true });
    chmodSync(backupsRoot, 0o700);
    const { bsize, bavail } = statfs(backupsRoot);
    if (bsize * bavail < minimumBackupBytes) {
      refuse(
        `The backup needs ${minimumBackupBytes} free bytes in ${backupsRoot}; free space first ("Retenció" in docs/operations/agent.md).`,
      );
    }

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
    // A turn may have started while the service was stopping.
    assertIdle(statePath, "The service is busy after the stop");
    write("mountain-agent is stopped.\n");

    const names = createBackups({
      run,
      options,
      installed,
      target,
      timestamp: now()
        .toISOString()
        .replace(/[-:]|\.\d+/gu, ""),
      write,
    });

    installTree({ run, sourceOf: targetSource, installRoot });
    // The revision is recorded only for a verified tree.
    assertSameTree({
      expected,
      installRoot,
      message: `Restore the backup in ${backupsRoot} if this is not resolved. The installed tree does not match ${target} after the install`,
    });
    writeFileSync(revisionPath, `${target}\n`);
    chmodSync(revisionPath, 0o644);

    report({
      target,
      changed,
      backup: names.agent,
      revisionPath,
      write,
    });
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

/**
 * Run the command and return its exit code. The programs it calls and the
 * identity checks are injectable for the tests.
 */
export function runUpdateCommand({
  argv,
  run = runProcess,
  statfs = statfsSync,
  now = () => new Date(),
  getuid = () => process.getuid(),
  statFile = statSync,
  write = (text) => process.stdout.write(text),
  warn = (message) => process.stderr.write(`${message}\n`),
}) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    warn(`${error.message}\n\n${usage}`);
    return 2;
  }
  if (options.help) {
    write(usage);
    return 0;
  }
  try {
    update(options, { run, statfs, now, write, getuid, statFile });
    return 0;
  } catch (error) {
    warn(error.message);
    return 1;
  }
}
