import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../../repository/merge-request-store.mjs";
import { PreviewRequestStore } from "../../repository/preview-request-store.mjs";
import {
  imageInputs,
  runProcess,
  runProcessToFile,
  runUpdateCommand,
} from "./command.mjs";

const sessionKey = "-1001234567890:7";
const timestamp = new Date("2026-11-22T10:15:00Z");
const agentClone = "/var/lib/mountain-runners-agent/repository";

// The files of the operator checkout: the installed agent directory in full,
// tests included, and the bridge entries of the release tarball.
const baselineFiles = {
  "tools/server/agent/README.md": "# Agent\n",
  "tools/server/agent/processes/telegram-bridge/main.mjs":
    "export const main = 1;\n",
  "tools/server/agent/runtime/agent.test.mjs": "// test\n",
  "tools/server/agent/commands/old/cli.mjs": "// retired\n",
  "tools/server/agent/sandbox/Containerfile": "FROM scratch\n",
  "packages/telegram-pi-bridge/package.json": '{"name":"telegram-pi-bridge"}\n',
  "packages/telegram-pi-bridge/LICENSE": "MIT\n",
  "packages/telegram-pi-bridge/README.md": "# Bridge\n",
  "packages/telegram-pi-bridge/src/index.mjs": "export {};\n",
  "packages/telegram-pi-bridge/src/index.test.mjs": "// never installed\n",
  "packages/telegram-pi-bridge/examples/example.mjs": "// example\n",
  "packages/telegram-pi-bridge/test/queue.test.mjs": "// never installed\n",
  "package.json": '{"name":"mountain-runners"}\n',
  "apps/web/package.json": '{"name":"web"}\n',
  "pnpm-lock.yaml": "lockfileVersion: 9\n",
  ".node-version": "24.22.3\n",
  ".env.example": "# MOUNTAIN_AGENT_SANDBOX_IMAGE=\n",
  "tools/server/systemd/mountain-agent.service": "[Service]\n",
};

function temporaryDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-update-"));
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

function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commitAll(repository, message) {
  git(repository, ["add", "--all"]);
  // A target commit without changes is still a different revision.
  git(repository, ["commit", "--quiet", "--allow-empty", "--message", message]);
  return git(repository, ["rev-parse", "HEAD"]);
}

// The installed layout is the one the manual procedure of 22 November 2026
// left: the agent directory whole and the selected bridge entries.
function installFromWorktree({ repository, installRoot }) {
  cpSync(join(repository, "tools/server/agent"), join(installRoot, "agent"), {
    recursive: true,
  });
  const bridge = join(installRoot, "node_modules/telegram-pi-bridge");
  for (const entry of [
    "src",
    "examples",
    "package.json",
    "LICENSE",
    "README.md",
  ]) {
    cpSync(
      join(repository, "packages/telegram-pi-bridge", entry),
      join(bridge, entry),
      {
        recursive: true,
        filter: (source) => !/\.test\.[^/]+$/u.test(source),
      },
    );
  }
}

/** A checkout with one commit, its installed tree and empty state and backups. */
function createInstallation(context, { files = baselineFiles } = {}) {
  const root = temporaryDirectory(context);
  const repository = join(root, "checkout");
  const installRoot = join(root, "install");
  const backupsRoot = join(root, "backups");
  const dataRoot = join(root, "data");
  mkdirSync(repository, { recursive: true });
  mkdirSync(join(dataRoot, "state"), { recursive: true });
  git(repository, ["init", "--quiet", "--initial-branch=main"]);
  git(repository, ["config", "user.email", "operator@example.com"]);
  git(repository, ["config", "user.name", "Operator"]);
  writeTree(repository, files);
  const installed = commitAll(repository, "installed");
  installFromWorktree({ repository, installRoot });
  return { root, repository, installRoot, backupsRoot, dataRoot, installed };
}

/** Advance the checkout to the target commit and put it on `origin/main`. */
function advance(app, { write = {}, remove = [], link = {}, branch } = {}) {
  if (branch !== undefined) {
    git(app.repository, ["checkout", "--quiet", "-b", branch]);
  }
  writeTree(app.repository, write);
  for (const [path, target] of Object.entries(link)) {
    symlinkSync(target, join(app.repository, path));
  }
  for (const path of remove) {
    rmSync(join(app.repository, path));
  }
  const target = commitAll(app.repository, "target");
  if (branch !== undefined) {
    git(app.repository, ["checkout", "--quiet", "main"]);
    // `main` stays where it was, so the target is not reachable from it.
    git(app.repository, ["update-ref", "refs/remotes/origin/main", "main"]);
    return target;
  }
  git(app.repository, ["update-ref", "refs/remotes/origin/main", target]);
  return target;
}

function writeRevision(installRoot, revision) {
  writeFileSync(join(installRoot, "agent.REVISION"), `${revision}\n`);
}

function createRunner({ isActive = "inactive", onChown, onIsActive } = {}) {
  const calls = [];
  function run(command, args) {
    calls.push(`${command} ${args.join(" ")}`);
    if (command === "systemctl") {
      if (args[0] === "is-active") {
        onIsActive?.();
        return {
          status: isActive === "active" ? 0 : 3,
          stdout: `${isActive}\n`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "runuser") {
      // The size of the state, measured as the service user.
      return { status: 0, stdout: "4096\t/synthetic\n", stderr: "" };
    }
    if (command === "chown") {
      onChown?.(args);
      return { status: 0, stdout: "", stderr: "" };
    }
    return runProcess(command, args);
  }
  return { run, calls };
}

// The state as the service user writes it: either a synthetic private file or
// the real `tar` of the directory, run without the service identity.
function createStream({ realTar = false } = {}) {
  const calls = [];
  function stream(command, args, path) {
    calls.push(`${command} ${args.join(" ")}`);
    if (!realTar) {
      writeFileSync(path, "synthetic state archive\n", {
        flag: "wx",
        mode: 0o600,
      });
      return { status: 0, stdout: "", stderr: "" };
    }
    const separator = args.indexOf("--");
    return runProcessToFile(
      args[separator + 1],
      args.slice(separator + 2),
      path,
    );
  }
  return { stream, calls };
}

function runUpdate(
  app,
  {
    argv = [],
    repository = app.repository,
    runner,
    stream,
    getuid = () => 0,
    checkoutUid = 0,
    statfs,
    umask,
  } = {},
) {
  const { run, calls } = runner ?? createRunner();
  const { stream: writeStream, calls: streamCalls } = stream ?? createStream();
  const output = { stdout: "", stderr: "" };
  const previousUmask = umask === undefined ? null : process.umask(umask);
  const code = runUpdateCommand({
    argv: [
      "--repository",
      repository,
      "--install-root",
      app.installRoot,
      "--backups",
      app.backupsRoot,
      "--data-root",
      app.dataRoot,
      ...argv,
    ],
    run,
    stream: writeStream,
    statfs,
    now: () => timestamp,
    getuid,
    statFile: (path) => ({ ...statSync(path), uid: checkoutUid }),
    write: (text) => {
      output.stdout += text;
    },
    warn: (text) => {
      output.stderr += text;
    },
  });
  if (previousUmask !== null) {
    process.umask(previousUmask);
  }
  return { code, calls, streamCalls, ...output };
}

function assertServiceNotStarted(calls) {
  assert.equal(
    calls.filter((call) => call === "systemctl start mountain-agent").length,
    0,
  );
}

// A refusal before the stop runs no privileged program: no service operation
// and no ownership change.
function assertServiceUntouched(calls) {
  assert.deepEqual(
    calls.filter(
      (call) => call.startsWith("systemctl ") || call.startsWith("chown "),
    ),
    [],
  );
}

// A refused update creates no backup and never moves the recorded revision.
function assertNotUpdated(app) {
  assert.equal(existsSync(app.backupsRoot), false);
  const revisionPath = join(app.installRoot, "agent.REVISION");
  if (existsSync(revisionPath)) {
    assert.equal(readFileSync(revisionPath, "utf8").trim(), app.installed);
  }
}

test("installs the target commit, replaces the tree and records the revision", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: {
      "tools/server/agent/README.md": "# Agent v2\n",
      "tools/server/agent/processes/added.mjs": "export const added = 1;\n",
    },
    // The commit retires a module: the directory swap must remove it.
    remove: ["tools/server/agent/commands/old/cli.mjs"],
  });
  mkdirSync(join(app.dataRoot, "state"), { recursive: true });

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    readFileSync(join(app.installRoot, "agent.REVISION"), "utf8").trim(),
    target,
  );
  assert.equal(
    readFileSync(join(app.installRoot, "agent/README.md"), "utf8"),
    "# Agent v2\n",
  );
  assert.equal(
    existsSync(join(app.installRoot, "agent/commands/old/cli.mjs")),
    false,
  );
  assert.equal(
    existsSync(join(app.installRoot, "agent/processes/added.mjs")),
    true,
  );
  assert.equal(
    statSync(join(app.installRoot, "agent/README.md")).mode & 0o777,
    0o644,
  );
  assert.equal(statSync(join(app.installRoot, "agent")).mode & 0o777, 0o755);

  const identity = `${app.installed.slice(0, 7)}-to-${target.slice(0, 7)}`;
  const stamp = "20261122T101500Z";
  assert.equal(
    readFileSync(
      join(app.backupsRoot, `agent-${identity}-${stamp}/README.md`),
      "utf8",
    ),
    "# Agent\n",
  );
  assert.equal(statSync(app.backupsRoot).mode & 0o777, 0o700);
  assert.equal(
    statSync(join(app.backupsRoot, `agent-${identity}-${stamp}`)).mode & 0o777,
    0o700,
  );
  assert.equal(
    lstatSync(join(app.backupsRoot, "agent-previous")).isSymbolicLink(),
    true,
  );
  assert.equal(
    readFileSync(join(app.backupsRoot, "agent-previous.REVISION"), "utf8"),
    `${app.installed}\n`,
  );
  const stateBackup = join(app.backupsRoot, `state-${identity}-${stamp}.tar`);
  assert.equal(lstatSync(stateBackup).isFile(), true);
  assert.equal(statSync(stateBackup).mode & 0o777, 0o600);

  assertServiceNotStarted(result.calls);
  assert.match(result.stdout, /The service was not started/u);
});

test("installs without a recorded revision when --installed declares the tree", (context) => {
  const app = createInstallation(context);
  const target = advance(app, {
    write: { "tools/server/agent/README.md": "# Agent v2\n" },
  });

  const result = runUpdate(app, {
    argv: ["--commit", target, "--installed", app.installed],
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    readFileSync(join(app.installRoot, "agent.REVISION"), "utf8").trim(),
    target,
  );
});

test("refuses when there is no recorded revision and no --installed", (context) => {
  const app = createInstallation(context);
  const target = advance(app);

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--installed/u);
  assertNotUpdated(app);
  assertServiceUntouched(result.calls);
});

test("refuses an --installed that contradicts the recorded revision", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);

  const contradicted = runUpdate(app, {
    argv: ["--commit", target, "--installed", target],
  });
  assert.equal(contradicted.code, 1);
  assert.match(contradicted.stderr, /records .* and --installed says/u);
  assertNotUpdated(app);

  const agreed = runUpdate(app, {
    argv: ["--commit", target, "--installed", app.installed],
  });
  assert.equal(agreed.code, 0, agreed.stderr);
});

test("refuses a commit that is not reachable from origin/main", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/README.md": "# Unreviewed\n" },
    branch: "unreviewed",
  });

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /not reachable from refs\/remotes\/origin\/main/u,
  );
  assertNotUpdated(app);
  assertServiceUntouched(result.calls);
});

test("refuses the clone of the agent as the repository", (context) => {
  const app = createInstallation(context);

  for (const repository of [
    agentClone,
    `${agentClone}/nested`,
    "/var/lib/mountain-runners-agent",
  ]) {
    const result = runUpdate(app, {
      argv: ["--commit", app.installed],
      repository,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /never a source of an installation/u);
    assert.deepEqual(result.calls, []);
  }
});

for (const [label, mutate, expected] of [
  [
    "a modified file",
    (installRoot) =>
      writeFileSync(join(installRoot, "agent/README.md"), "# Edited\n"),
    /modified agent\/README\.md/u,
  ],
  [
    "a missing file",
    (installRoot) =>
      rmSync(join(installRoot, "agent/processes"), {
        recursive: true,
        force: true,
      }),
    /missing agent\/processes\/telegram-bridge\/main\.mjs/u,
  ],
  [
    "an added file",
    (installRoot) =>
      writeFileSync(join(installRoot, "agent/extra.mjs"), "// extra\n"),
    /added agent\/extra\.mjs/u,
  ],
]) {
  test(`refuses an installed tree with ${label}`, (context) => {
    const app = createInstallation(context);
    writeRevision(app.installRoot, app.installed);
    const target = advance(app);
    mutate(app.installRoot);

    const result = runUpdate(app, { argv: ["--commit", target] });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not match/u);
    assert.match(result.stderr, expected);
    assertNotUpdated(app);
    assertServiceUntouched(result.calls);
  });
}

test("installs a bridge without the tests of the package", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 0, result.stderr);
  const bridge = join(app.installRoot, "node_modules/telegram-pi-bridge");
  assert.equal(existsSync(join(bridge, "src/index.mjs")), true);
  assert.equal(existsSync(join(bridge, "src/index.test.mjs")), false);
  assert.equal(existsSync(join(bridge, "test")), false);
});

const busyStates = [
  {
    name: "a pending instruction",
    prepare: (state) => {
      const queue = new AdmissionQueue(join(state, "admission.sqlite"), {
        maxPending: 10,
      });
      queue.admit({
        updateIdentifier: 11,
        messageIdentifier: 1011,
        sessionKey,
        authorIdentifier: 42,
        instruction: "synthetic instruction",
      });
      queue.close();
    },
    expected: /pending or running instructions: 1/u,
  },
  {
    name: "a running instruction",
    prepare: (state) => {
      const queue = new AdmissionQueue(join(state, "admission.sqlite"), {
        maxPending: 10,
      });
      queue.admit({
        updateIdentifier: 12,
        messageIdentifier: 1012,
        sessionKey,
        authorIdentifier: 42,
        instruction: "synthetic instruction",
      });
      queue.next();
      queue.close();
    },
    expected: /pending or running instructions: 1/u,
  },
  {
    name: "a reserved CI repair",
    prepare: (state) => {
      const store = new CiWatchStore(join(state, "ci-watch.sqlite"));
      store.requestRepair({
        updateIdentifier: 21,
        sessionKey,
        pullRequestNumber: 200,
        failureFingerprint: "fingerprint",
        failedChecks: ["Validate"],
        evidence: { summary: "synthetic" },
        commitSha: "a".repeat(40),
        maximumAttempts: 2,
      });
      store.close();
    },
    expected: /reserved, queued or running CI repairs: 1/u,
  },
  {
    name: "a sending CI notice",
    prepare: (state) => {
      const store = new CiWatchStore(join(state, "ci-watch.sqlite"));
      store.add({
        updateIdentifier: 31,
        sessionKey,
        pullRequestNumber: 201,
        commitSha: "b".repeat(40),
      });
      store.beginSend(31, "success");
      store.close();
    },
    expected: /pending, sending or uncertain CI notices: 1/u,
  },
  {
    name: "an uncertain instruction case",
    prepare: (state) => {
      const queue = new AdmissionQueue(join(state, "admission.sqlite"), {
        maxPending: 10,
      });
      queue.admit({
        updateIdentifier: 13,
        messageIdentifier: 1013,
        sessionKey,
        authorIdentifier: 42,
        instruction: "synthetic instruction",
      });
      queue.next();
      queue.markUncertain(13, "uncertain");
      queue.close();
    },
    expected: /uncertain instruction case\(s\): 1/u,
  },
  {
    name: "an uncertain CI repair case",
    prepare: (state) => {
      const store = new CiWatchStore(join(state, "ci-watch.sqlite"));
      const { sequence } = store.requestRepair({
        updateIdentifier: 22,
        sessionKey,
        pullRequestNumber: 202,
        failureFingerprint: "fingerprint",
        failedChecks: ["Validate"],
        evidence: { summary: "synthetic" },
        commitSha: "c".repeat(40),
        maximumAttempts: 2,
      });
      store.queueRepair(sequence);
      store.claimNextRepair();
      store.finishRepair(sequence, {
        status: "uncertain",
        outcome: "uncertain",
      });
      store.close();
    },
    expected: /uncertain repair case\(s\): 1/u,
  },
  {
    name: "a merge request in progress",
    prepare: (state) => {
      const store = new MergeRequestStore(join(state, "merge-request.sqlite"));
      store.begin({
        updateIdentifier: 41,
        sessionKey,
        authorIdentifier: 42,
        pullRequestNumber: 210,
        commitSha: "e".repeat(40),
      });
      store.close();
    },
    expected: /merging or uncertain merge requests: 1/u,
  },
  {
    name: "an uncertain merge request",
    prepare: (state) => {
      const store = new MergeRequestStore(join(state, "merge-request.sqlite"));
      store.begin({
        updateIdentifier: 42,
        sessionKey,
        authorIdentifier: 42,
        pullRequestNumber: 211,
        commitSha: "f".repeat(40),
      });
      store.markUncertain(42);
      store.close();
    },
    expected: /merging or uncertain merge requests: 1/u,
  },
  {
    name: "a preview request awaiting the publisher",
    prepare: (state) => {
      const store = new PreviewRequestStore(
        join(state, "preview-request.sqlite"),
      );
      store.begin({
        updateIdentifier: 51,
        sessionKey,
        authorIdentifier: 42,
        pullRequestNumber: 212,
        commitSha: "1".repeat(40),
      });
      store.close();
    },
    expected: /preview requests awaiting the publisher: 1/u,
  },
  {
    name: "an uncertain CI notice case",
    prepare: (state) => {
      const store = new CiWatchStore(join(state, "ci-watch.sqlite"));
      store.add({
        updateIdentifier: 32,
        sessionKey,
        pullRequestNumber: 203,
        commitSha: "d".repeat(40),
      });
      store.beginSend(32, "failure");
      store.markUncertain(32);
      store.close();
    },
    expected: /uncertain notice case\(s\): 1/u,
  },
];

for (const { name, prepare, expected } of busyStates) {
  test(`refuses while the state has ${name}`, (context) => {
    const app = createInstallation(context);
    writeRevision(app.installRoot, app.installed);
    const target = advance(app);
    prepare(join(app.dataRoot, "state"));

    const result = runUpdate(app, { argv: ["--commit", target] });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /The service is busy/u);
    assert.match(result.stderr, expected);
    assertNotUpdated(app);
    assert.equal(
      result.calls.includes("systemctl stop mountain-agent"),
      false,
      "the service is stopped only after the idle check",
    );
  });
}

for (const path of ["pnpm-lock.yaml", ".node-version"]) {
  test(`refuses a change of ${path} without --image-rebuilt`, (context) => {
    const app = createInstallation(context);
    writeRevision(app.installRoot, app.installed);
    const target = advance(app, { write: { [path]: "changed\n" } });

    const result = runUpdate(app, { argv: ["--commit", target] });

    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(path.replace(".", "\\."), "u"));
    assert.match(result.stderr, /--image-rebuilt/u);
    assertNotUpdated(app);
  });
}

test("refuses a change of the sandbox Containerfile without --image-rebuilt", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/sandbox/Containerfile": "FROM node\n" },
  });

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /sandbox\/Containerfile/u);
  assertNotUpdated(app);
});

test("installs with the sandbox image already rebuilt", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, { write: { "pnpm-lock.yaml": "changed\n" } });

  const result = runUpdate(app, {
    argv: ["--commit", target, "--image-rebuilt"],
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    readFileSync(join(app.installRoot, "agent.REVISION"), "utf8").trim(),
    target,
  );
});

test("reports the systemd and environment changes as operator actions", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: {
      "tools/server/systemd/mountain-agent.service": "[Service]\nExecStart=\n",
      ".env.example": "# MOUNTAIN_AGENT_SANDBOX_IMAGE=\n# NEW=\n",
    },
  });

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Operator actions before starting:/u);
  assert.match(
    result.stdout,
    /tools\/server\/systemd\/mountain-agent\.service changed/u,
  );
  assert.match(result.stdout, /\.env\.example changed/u);
});

test("refuses when the service is still active after the stop", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/README.md": "# Agent v2\n" },
  });

  const result = runUpdate(app, {
    argv: ["--commit", target],
    runner: createRunner({ isActive: "active" }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /is-active reports "active"/u);
  assertNotUpdated(app);
  assert.equal(
    readFileSync(join(app.installRoot, "agent/README.md"), "utf8"),
    "# Agent\n",
  );
});

test("records the revision only after the installed tree is verified", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/README.md": "# Agent v2\n" },
  });

  // The staging tree gains a file the archive does not have, so the check after
  // the swap fails. The marker must stay untouched.
  const result = runUpdate(app, {
    argv: ["--commit", target],
    runner: createRunner({
      onChown: (args) => {
        if (args[2]?.endsWith("/agent.new") === true) {
          writeFileSync(join(args[2], "unexpected.mjs"), "// unexpected\n");
        }
      },
    }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /after the install/u);
  assert.match(result.stderr, /added agent\/unexpected\.mjs/u);
  assert.equal(existsSync(join(app.installRoot, "agent.REVISION")), true);
  assert.equal(
    readFileSync(join(app.installRoot, "agent.REVISION"), "utf8").trim(),
    app.installed,
  );
});

test("backs up the state as the service user and never follows a link inside it", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/README.md": "# Agent v2\n" },
  });
  const outside = join(app.root, "outside.txt");
  writeFileSync(outside, "outside\n");
  chmodSync(outside, 0o640);
  symlinkSync(outside, join(app.dataRoot, "state", "link"));
  const stream = createStream({ realTar: true });

  const result = runUpdate(app, { argv: ["--commit", target], stream });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.streamCalls.length, 1);
  assert.match(
    result.streamCalls[0],
    /^runuser -u mountain-agent -- tar -C .* -cf - \.$/u,
  );
  // The link is stored, never followed: its target keeps content and mode.
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
  assert.equal(statSync(outside).mode & 0o777, 0o640);
  const stateBackup = join(
    app.backupsRoot,
    `state-${app.installed.slice(0, 7)}-to-${target.slice(0, 7)}-20261122T101500Z.tar`,
  );
  assert.equal(lstatSync(stateBackup).isFile(), true);
  assert.equal(statSync(stateBackup).mode & 0o777, 0o600);
  const listing = spawnSync("tar", ["-tf", stateBackup], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /\.\/link/u);
});

test("refuses a state directory that is a link", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);
  const moved = join(app.root, "real-state");
  cpSync(join(app.dataRoot, "state"), moved, { recursive: true });
  rmSync(join(app.dataRoot, "state"), { recursive: true });
  symlinkSync(moved, join(app.dataRoot, "state"));

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /must be a directory, not a link or a file/u);
  assertNotUpdated(app);
  assertServiceUntouched(result.calls);
});

test("stores a FIFO in the state without opening it", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);
  const created = spawnSync("mkfifo", [join(app.dataRoot, "state", "pipe")], {
    encoding: "utf8",
  });
  assert.equal(created.status, 0, created.stderr);

  // Root never opens a FIFO: the archive is produced by the service user, which
  // stores it as an entry.
  const stream = createStream();
  const result = runUpdate(app, { argv: ["--commit", target], stream });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.streamCalls.length, 1);
});

test("refuses a state database that is a link", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);
  const decoy = join(app.root, "decoy.sqlite");
  const store = new CiWatchStore(decoy);
  store.close();
  symlinkSync(decoy, join(app.dataRoot, "state", "ci-watch.sqlite"));

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /a state database must be a regular file/u);
  assertNotUpdated(app);
  assertServiceUntouched(result.calls);
});

test("refuses when the state becomes busy while the service stops", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);
  const runner = createRunner({
    onIsActive: () => {
      const queue = new AdmissionQueue(
        join(app.dataRoot, "state", "admission.sqlite"),
        { maxPending: 10 },
      );
      queue.admit({
        updateIdentifier: 61,
        messageIdentifier: 1061,
        sessionKey,
        authorIdentifier: 42,
        instruction: "synthetic instruction",
      });
      queue.close();
    },
  });

  const result = runUpdate(app, { argv: ["--commit", target], runner });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /busy after the stop/u);
  assert.match(result.stderr, /pending or running instructions: 1/u);
  assert.equal(existsSync(app.backupsRoot), false);
  assert.equal(
    readFileSync(join(app.installRoot, "agent/README.md"), "utf8"),
    "# Agent\n",
  );
});

test("refuses an archive that contains a link", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/README.md": "# Agent v2\n" },
    link: { "tools/server/agent/sneaky.mjs": "/etc/passwd" },
  });

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /not a regular file or a directory/u);
  assert.match(result.stderr, /sneaky\.mjs/u);
  assertNotUpdated(app);
  assertServiceUntouched(result.calls);
});

test("refuses an archive that rewrites content with export-subst", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/.gitattributes": "*.mjs export-subst\n" },
  });

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /export-subst/u);
  assertNotUpdated(app);
  assertServiceUntouched(result.calls);
});

test("covers every path the sandbox Containerfile copies", () => {
  const containerfile = readFileSync(
    fileURLToPath(new URL("../../sandbox/Containerfile", import.meta.url)),
    "utf8",
  );
  const copied = containerfile
    .split("\n")
    .filter((line) => /^COPY\s/u.test(line))
    .flatMap((line) =>
      line
        .replace(/^COPY\s+/u, "")
        .trim()
        .split(/\s+/u)
        .slice(0, -1),
    );

  assert.ok(copied.length > 0);
  for (const path of copied) {
    assert.equal(
      imageInputs.some(
        (input) => path === input || path.startsWith(`${input}/`),
      ),
      true,
      `${path} is copied by the Containerfile and is not an image input`,
    );
  }
  assert.equal(imageInputs.includes("pnpm-workspace.yaml"), true);
});

test("refuses a checkout that is not owned by root", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);

  const result = runUpdate(app, {
    argv: ["--commit", target],
    checkoutUid: 501,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /not owned by root \(uid 0\)/u);
  assertServiceUntouched(result.calls);
});

test("refuses to run as another identity", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);

  const result = runUpdate(app, {
    argv: ["--commit", target],
    getuid: () => 1000,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /run it as root \(uid 0\)/u);
  assertServiceUntouched(result.calls);
});

test("refuses a checkout that resolves inside the data root", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);
  const inside = join(app.dataRoot, "checkout");
  cpSync(app.repository, inside, { recursive: true });

  const result = runUpdate(app, {
    argv: ["--commit", target],
    repository: inside,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /inside the data root/u);
  assertServiceUntouched(result.calls);
});

test("refuses a short or malformed commit", (context) => {
  const app = createInstallation(context);
  const short = app.installed.slice(0, 7);

  for (const argv of [
    ["--commit", short],
    ["--commit", app.installed, "--installed", short],
    ["--commit", `${app.installed}0`],
  ]) {
    const result = runUpdate(app, { argv });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /full 40-character/u);
  }
});

test("runs git with the hardened configuration and explicit paths", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app, {
    write: { "tools/server/agent/README.md": "# Agent v2\n" },
  });

  const result = runUpdate(app, { argv: ["--commit", target] });

  assert.equal(result.code, 0, result.stderr);
  const gitCalls = result.calls.filter((call) => call.startsWith("git "));
  assert.ok(gitCalls.length > 0);
  for (const call of gitCalls) {
    assert.match(
      call,
      /^git -c core\.fsmonitor=false -c core\.hooksPath=\/dev\/null /u,
    );
  }
  const archiveCall = gitCalls.find((call) => call.includes(" archive "));
  assert.match(archiveCall, /-c core\.attributesFile=\/dev\/null/u);
  const diffCall = gitCalls.find((call) => call.includes(" diff "));
  assert.match(diffCall, /--no-renames --no-ext-diff --no-textconv/u);
  assert.match(diffCall, / --$/u);
});

test("creates the installed layout with the documented modes under a private umask", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);

  const result = runUpdate(app, { argv: ["--commit", target], umask: 0o077 });

  assert.equal(result.code, 0, result.stderr);
  const mode = (path) => statSync(path).mode & 0o777;
  assert.equal(mode(join(app.installRoot, "node_modules")), 0o755);
  assert.equal(mode(join(app.installRoot, "agent")), 0o755);
  assert.equal(mode(join(app.installRoot, "agent/README.md")), 0o644);
  assert.equal(
    mode(join(app.installRoot, "node_modules/telegram-pi-bridge")),
    0o755,
  );
  assert.equal(mode(join(app.installRoot, "agent.REVISION")), 0o644);
  assert.equal(mode(app.backupsRoot), 0o700);
});

test("refuses when the backup filesystem has no room", (context) => {
  const app = createInstallation(context);
  writeRevision(app.installRoot, app.installed);
  const target = advance(app);

  const result = runUpdate(app, {
    argv: ["--commit", target],
    statfs: () => ({ bsize: 1, bavail: 10 }),
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Retenció/u);
  assert.equal(result.calls.includes("systemctl stop mountain-agent"), true);
  assert.deepEqual(readdirSync(app.backupsRoot), []);
  assert.equal(
    readFileSync(join(app.installRoot, "agent/README.md"), "utf8"),
    "# Agent\n",
  );
});
