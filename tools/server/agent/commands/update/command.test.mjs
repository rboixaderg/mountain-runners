import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { runProcess, runUpdateCommand } from "./command.mjs";

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
function advance(app, { write = {}, remove = [], branch } = {}) {
  if (branch !== undefined) {
    git(app.repository, ["checkout", "--quiet", "-b", branch]);
  }
  writeTree(app.repository, write);
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

function createRunner({ isActive = "inactive", onChown } = {}) {
  const calls = [];
  function run(command, args) {
    calls.push(`${command} ${args.join(" ")}`);
    if (command === "systemctl") {
      if (args[0] === "is-active") {
        return {
          status: isActive === "active" ? 0 : 3,
          stdout: `${isActive}\n`,
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "chown") {
      onChown?.(args);
      return { status: 0, stdout: "", stderr: "" };
    }
    return runProcess(command, args);
  }
  return { run, calls };
}

function runUpdate(
  app,
  { argv = [], repository = app.repository, runner } = {},
) {
  const { run, calls } = runner ?? createRunner();
  const output = { stdout: "", stderr: "" };
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
    now: () => timestamp,
    write: (text) => {
      output.stdout += text;
    },
    warn: (text) => {
      output.stderr += text;
    },
  });
  return { code, calls, ...output };
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
  assert.equal(
    readdirSync(app.backupsRoot).includes(`state-${identity}-${stamp}`),
    true,
  );

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
  assert.match(result.stderr, /not reachable from origin\/main/u);
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
