// Tests for the preview gate and namespace operations (T6.3).
//
// Run with: node --test tools/server/preview/
//
// The suite exercises the security-critical preview paths with adversarial
// archives (absolute paths, traversal, symlinks, hardlinks, devices,
// duplicates, limits and digest mismatches), the pull request namespace
// binding (origin and PR number must match the namespace argument) and the
// namespace lifecycle (receive, install, activate, list, health). The command
// runs release operations as the preview identity; signed authorization uses
// the separate preview process. No production credentials are involved.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  makeManifest,
  makeNormalArchive,
  sha256Of,
  writeCraftedArchive,
} from "../release/adversarial-archive.mjs";
import { previewNamespacePaths, previewOrigin } from "./config.mjs";
import { signPreviewAuthorization } from "./authorization-proof.mjs";
import { withPreviewAuthorization } from "./test-authorization.mjs";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const gatePath = join(toolDirectory, "commands/mountain-preview/cli.mjs");

const previewPullNumber = 99;
const previewCommit = "9".repeat(40);
const updatedPreviewCommit = "8".repeat(40);
const authorizationKeys = new Map();

const previewFiles = [
  { path: "index.html", content: "<html>preview home</html>" },
  { path: "ca/index.html", content: "<html>hola preview</html>" },
];

function previewArchiveName(commit) {
  return `mountain-runners-${commit.slice(0, 12)}.tar.gz`;
}

async function withPreviewRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "mountain-preview-test-"));
  const previousPreviewRoot = process.env.MOUNTAIN_PREVIEW_ROOT;
  // The fixtures resolve namespaces through the same environment the gate
  // receives, so the test process sets the root too.
  process.env.MOUNTAIN_PREVIEW_ROOT = root;
  try {
    await mkdir(join(root, "namespaces"), { recursive: true });
    return await withPreviewAuthorization(root, async ({ privateKey }) => {
      authorizationKeys.set(root, privateKey);
      return run(root);
    });
  } finally {
    authorizationKeys.delete(root);
    process.env.MOUNTAIN_PREVIEW_ROOT = previousPreviewRoot;
    await rm(root, { recursive: true, force: true });
  }
}

function runGate(root, originalCommand, stdin) {
  return spawnSync(process.execPath, [gatePath], {
    encoding: "utf8",
    input: stdin,
    env: {
      ...process.env,
      MOUNTAIN_PREVIEW_ROOT: root,
      MOUNTAIN_PREVIEW_SITE_SOCKET: join(root, "site.sock"),
      SSH_ORIGINAL_COMMAND: originalCommand,
    },
  });
}

function authorizeRelease(root, commit = previewCommit, actor = "maintainer") {
  const issuedAt = Date.now();
  const signature = signPreviewAuthorization(
    { pullRequestNumber: previewPullNumber, commit, actor, issuedAt },
    authorizationKeys.get(root),
  );
  return runGate(
    root,
    `mountain-preview authorize ${previewPullNumber} ${commit} ${actor}`,
    JSON.stringify({ issuedAt, signature }),
  );
}

function runGateDirect(root, args) {
  return spawnSync(process.execPath, [gatePath, ...args], {
    encoding: "utf8",
    env: { ...process.env, MOUNTAIN_PREVIEW_ROOT: root },
  });
}

function runInstalledGate(
  gatePath,
  root,
  originalCommand,
  stdin,
  siteEnv = {},
) {
  return spawnSync(process.execPath, [gatePath], {
    encoding: "utf8",
    input: stdin,
    env: {
      ...process.env,
      MOUNTAIN_PREVIEW_ROOT: root,
      SSH_ORIGINAL_COMMAND: originalCommand,
      ...siteEnv,
    },
  });
}

function gateOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function makePreviewManifest({
  commit = previewCommit,
  files = previewFiles,
  pullRequestNumber = previewPullNumber,
  origin = previewOrigin(previewPullNumber),
} = {}) {
  return makeManifest({ commit, files, origin, pullRequestNumber });
}

// Builds a real tar.gz for the given files and returns its bytes, ready to be
// streamed through the gate's receive command.
async function makePreviewArchiveBytes(files) {
  const scratchDirectory = await mkdtemp(join(tmpdir(), "mountain-preview-"));
  try {
    const archivePath = join(scratchDirectory, "archive.tar.gz");
    await makeNormalArchive(archivePath, files);
    return await readFile(archivePath);
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true });
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Streams a real archive and a manifest into the given pull request's
// namespace through the gate, mirroring what the trusted publisher does. The
// manifest is built with the given commit and namespace binding.
async function receiveArtifact(
  root,
  {
    namespacePullNumber = previewPullNumber,
    commit = previewCommit,
    files = previewFiles,
    pullRequestNumber = namespacePullNumber,
    origin = previewOrigin(namespacePullNumber),
  } = {},
) {
  const namespace = previewNamespacePaths(namespacePullNumber);
  const archiveName = previewArchiveName(commit);
  const archiveBytes = await makePreviewArchiveBytes(files);
  const receiveArchive = runGate(
    root,
    `mountain-preview receive ${namespacePullNumber} ${archiveName}`,
    archiveBytes,
  );
  assert.equal(receiveArchive.status, 0, gateOutput(receiveArchive));
  assert.match(
    receiveArchive.stdout,
    new RegExp(
      `Received ${archiveName} sha256:${sha256Of(archiveBytes)} bytes:${archiveBytes.length}`,
    ),
  );
  assert.equal(
    (await readFile(join(namespace.incomingDirectory, archiveName))).equals(
      archiveBytes,
    ),
    true,
    "the upload must land inside the pull request namespace",
  );

  const receiveManifest = runGate(
    root,
    `mountain-preview receive ${namespacePullNumber} manifest.json`,
    Buffer.from(
      `${JSON.stringify(
        makeManifest({ commit, files, origin, pullRequestNumber }),
      )}\n`,
      "utf8",
    ),
  );
  assert.equal(receiveManifest.status, 0, gateOutput(receiveManifest));
  return archiveName;
}

test("receives into the pull request namespace, installs, activates and reports health", async () => {
  await withPreviewRoot(async (root) => {
    const namespace = previewNamespacePaths(previewPullNumber);
    const archiveName = await receiveArtifact(root, previewCommit);

    const install = runGate(
      root,
      `mountain-preview install ${previewPullNumber} ${archiveName} manifest.json`,
    );
    assert.equal(install.status, 0, gateOutput(install));
    assert.match(install.stdout, /Installed release/);
    assert.equal(
      await readFile(
        join(namespace.releasesDirectory, previewCommit, "ca/index.html"),
        "utf8",
      ),
      "<html>hola preview</html>",
    );
    assert.equal(authorizeRelease(root).status, 0);

    const activate = runGate(
      root,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
    );
    assert.equal(activate.status, 0, gateOutput(activate));
    assert.equal(
      await readlink(namespace.currentLink),
      join(namespace.releasesDirectory, previewCommit),
    );

    const list = runGate(root, `mountain-preview list ${previewPullNumber}`);
    assert.equal(list.status, 0);
    assert.match(list.stdout, new RegExp(`active\\s+${previewCommit}`));

    const health = runGate(
      root,
      `mountain-preview health ${previewPullNumber}`,
    );
    assert.equal(health.status, 0, gateOutput(health));
    assert.match(health.stdout, /Health: OK/);
  });
});

test("retire unpublishes only the requested namespace and is idempotent", async () => {
  await withPreviewRoot(async (root) => {
    const first = previewNamespacePaths(previewPullNumber);
    const second = previewNamespacePaths(previewPullNumber + 1);
    await mkdir(first.releasesDirectory, { recursive: true });
    await mkdir(second.releasesDirectory, { recursive: true });
    await writeFile(join(first.releasesDirectory, "old.html"), "retire me");
    await writeFile(join(second.releasesDirectory, "keep.html"), "keep me");

    const retired = runGate(
      root,
      `mountain-preview retire ${previewPullNumber}`,
    );
    assert.equal(retired.status, 0, gateOutput(retired));
    assert.equal(await pathExists(first.root), false);
    assert.equal(
      await readFile(join(second.releasesDirectory, "keep.html"), "utf8"),
      "keep me",
    );
    assert.deepEqual(await readdir(join(root, "namespaces")), [
      `pr-${previewPullNumber + 1}`,
    ]);

    const repeated = runGate(
      root,
      `mountain-preview retire ${previewPullNumber}`,
    );
    assert.equal(repeated.status, 0, gateOutput(repeated));
    assert.match(repeated.stdout, /already retired/);
    assert.notEqual(runGate(root, "mountain-preview retire ../99").status, 0);
  });
});

test("retire refuses a symlinked namespace instead of deleting its target", async () => {
  await withPreviewRoot(async (root) => {
    const target = join(root, "unrelated");
    await mkdir(target);
    await writeFile(join(target, "keep.html"), "keep me");
    await symlink(target, previewNamespacePaths(previewPullNumber).root);

    const result = runGate(
      root,
      `mountain-preview retire ${previewPullNumber}`,
    );
    assert.notEqual(result.status, 0);
    assert.match(gateOutput(result), /not a directory/);
    assert.equal(await readFile(join(target, "keep.html"), "utf8"), "keep me");
  });
});

test("cleanup-retired removes directories left by an interrupted retirement while inventory preserves them", async () => {
  await withPreviewRoot(async (root) => {
    const retired = join(
      root,
      "namespaces",
      ".retired-pr-99-00000000-0000-4000-8000-000000000000",
    );
    await mkdir(retired);
    await writeFile(join(retired, "old.html"), "orphaned release");
    const inventory = runGate(root, "mountain-preview inventory");
    assert.equal(inventory.status, 0, gateOutput(inventory));
    assert.equal(await pathExists(retired), true);
    const cleaned = runGate(root, "mountain-preview cleanup-retired");
    assert.equal(cleaned.status, 0, gateOutput(cleaned));
    assert.match(cleaned.stdout, /Cleaned retired preview namespaces/);
    assert.equal(await pathExists(retired), false);
  });
});

test("list and health never create a missing namespace", async () => {
  await withPreviewRoot(async (root) => {
    const namespace = previewNamespacePaths(77);
    const list = runGate(root, "mountain-preview list 77");
    assert.equal(list.status, 0, gateOutput(list));
    assert.match(list.stdout, /No releases registered/);
    const health = runGate(root, "mountain-preview health 77");
    assert.notEqual(health.status, 0);
    assert.match(gateOutput(health), /Health: DEGRADED/);
    assert.equal(await pathExists(namespace.root), false);
    assert.equal(
      await pathExists(join(root, "namespaces", ".capacity.lock")),
      false,
    );
  });
});

test("inventory returns an empty list when no namespace exists", async () => {
  await withPreviewRoot(async (root) => {
    await rm(join(root, "namespaces"), { recursive: true, force: true });
    const inventory = runGate(root, "mountain-preview inventory");
    assert.equal(inventory.status, 0, gateOutput(inventory));
    assert.deepEqual(JSON.parse(inventory.stdout), []);
  });
});

test("site-sync is rejected as an unknown command", async () => {
  await withPreviewRoot(async (root) => {
    const result = runGate(root, "mountain-preview site-sync");
    assert.notEqual(result.status, 0);
    assert.match(gateOutput(result), /Unknown command/);
  });
});

test("a sixth active preview is refused until an existing origin is retired", async () => {
  await withPreviewRoot(async (root) => {
    const archiveName = await receiveArtifact(root);
    const installed = runGate(
      root,
      `mountain-preview install ${previewPullNumber} ${archiveName} manifest.json`,
    );
    assert.equal(installed.status, 0, gateOutput(installed));
    assert.equal(authorizeRelease(root).status, 0);
    for (let number = 1; number <= 5; number += 1) {
      const namespace = previewNamespacePaths(number);
      await mkdir(namespace.releasesDirectory, { recursive: true });
      await symlink(namespace.releasesDirectory, namespace.currentLink);
    }
    const rejected = runGate(
      root,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
    );
    assert.notEqual(rejected.status, 0);
    assert.match(gateOutput(rejected), /limit of 5 active origins/);

    const retired = runGate(root, "mountain-preview retire 1");
    assert.equal(retired.status, 0, gateOutput(retired));
    const activated = runGate(
      root,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
    );
    assert.equal(activated.status, 0, gateOutput(activated));
  });
});

test("a sixth pending namespace is refused before accepting uploads", async () => {
  await withPreviewRoot(async (root) => {
    for (let number = 1; number <= 5; number += 1) {
      await mkdir(previewNamespacePaths(number).root);
    }
    const result = runGate(
      root,
      `mountain-preview receive ${previewPullNumber} manifest.json`,
      "{}",
    );
    assert.notEqual(result.status, 0);
    assert.match(gateOutput(result), /limit of 5 namespaces/);
    assert.equal(
      await pathExists(previewNamespacePaths(previewPullNumber).root),
      false,
    );
  });
});

test("inventory reports active commits and pending namespaces without opening releases", async () => {
  await withPreviewRoot(async (root) => {
    const archiveName = await receiveArtifact(root);
    const pending = JSON.parse(
      runGate(root, "mountain-preview inventory").stdout,
    );
    assert.equal(pending.length, 1);
    assert.equal(pending[0].pullNumber, previewPullNumber);
    assert.equal(pending[0].commit, undefined);

    const install = runGate(
      root,
      `mountain-preview install ${previewPullNumber} ${archiveName} manifest.json`,
    );
    assert.equal(install.status, 0, gateOutput(install));
    assert.equal(authorizeRelease(root).status, 0);
    const activate = runGate(
      root,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
    );
    assert.equal(activate.status, 0, gateOutput(activate));
    const active = JSON.parse(
      runGate(root, "mountain-preview inventory").stdout,
    );
    assert.equal(active[0].commit, previewCommit);
    assert.ok(Date.parse(active[0].updatedAt));
  });
});

test("inventory isolates a damaged registry instead of blocking other namespaces", async () => {
  await withPreviewRoot(async (root) => {
    const archiveName = await receiveArtifact(root);
    assert.equal(
      runGate(
        root,
        `mountain-preview install ${previewPullNumber} ${archiveName} manifest.json`,
      ).status,
      0,
    );
    assert.equal(authorizeRelease(root).status, 0);
    assert.equal(
      runGate(
        root,
        `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
      ).status,
      0,
    );
    await writeFile(
      previewNamespacePaths(previewPullNumber).registryFile,
      "corrupted registry",
    );
    await mkdir(previewNamespacePaths(previewPullNumber + 1).root);
    const result = runGate(root, "mountain-preview inventory");
    assert.equal(result.status, 0, gateOutput(result));
    const inventory = JSON.parse(result.stdout);
    assert.deepEqual(
      inventory
        .map((entry) => entry.pullNumber)
        .sort((first, second) => first - second),
      [previewPullNumber, previewPullNumber + 1],
    );
    assert.equal(
      inventory.find((entry) => entry.pullNumber === previewPullNumber)
        .inconsistent,
      true,
    );
  });
});

test("authorization records PR, actor and expiry in the verified release", async () => {
  await withPreviewRoot(async (root) => {
    const archiveName = await receiveArtifact(root);
    assert.equal(
      runGate(
        root,
        `mountain-preview install ${previewPullNumber} ${archiveName} manifest.json`,
      ).status,
      0,
    );
    const badActor = authorizeRelease(root, previewCommit, "bad.actor");
    assert.notEqual(badActor.status, 0);
    const authorized = authorizeRelease(root);
    assert.equal(authorized.status, 0, gateOutput(authorized));
    const forged = runGate(
      root,
      `mountain-preview authorize ${previewPullNumber} ${previewCommit} maintainer`,
      JSON.stringify({ issuedAt: Date.now(), signature: "forged" }),
    );
    assert.notEqual(forged.status, 0);
    assert.match(gateOutput(forged), /Invalid preview authorization/);
    const release = JSON.parse(
      await readFile(
        previewNamespacePaths(previewPullNumber).registryFile,
        "utf8",
      ),
    ).releases[0];
    assert.equal(release.pullRequestNumber, previewPullNumber);
    assert.equal(release.authorizedBy, "maintainer");
    assert.equal(
      Date.parse(release.expiresAt) - Date.parse(release.authorizedAt),
      14 * 24 * 60 * 60 * 1000,
    );
  });
});

test("a deploy key cannot activate an installed release without signed authorization", async () => {
  await withPreviewRoot(async (root) => {
    const archiveName = await receiveArtifact(root);
    assert.equal(
      runGate(
        root,
        `mountain-preview install ${previewPullNumber} ${archiveName} manifest.json`,
      ).status,
      0,
    );
    const denied = runGate(
      root,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
    );
    assert.notEqual(denied.status, 0);
    assert.match(gateOutput(denied), /no current authorization/);
  });
});

test("re-authorizing an active SHA renews its retention timestamp", async () => {
  await withPreviewRoot(async (root) => {
    const archiveName = await receiveArtifact(root);
    assert.equal(
      runGate(
        root,
        `mountain-preview install ${previewPullNumber} ${archiveName} manifest.json`,
      ).status,
      0,
    );
    assert.equal(authorizeRelease(root).status, 0);
    assert.equal(
      runGate(
        root,
        `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
      ).status,
      0,
    );
    const registryFile = previewNamespacePaths(previewPullNumber).registryFile;
    const registry = JSON.parse(await readFile(registryFile, "utf8"));
    registry.releases[0].activatedAt = "2026-08-01T00:00:00.000Z";
    await writeFile(registryFile, JSON.stringify(registry));
    assert.equal(authorizeRelease(root).status, 0);
    const inventory = JSON.parse(
      runGate(root, "mountain-preview inventory").stdout,
    );
    assert.ok(
      Date.parse(inventory[0].updatedAt) >
        Date.parse("2026-08-01T00:00:00.000Z"),
    );
  });
});

test("prune removes the previous release after updating an origin", async () => {
  await withPreviewRoot(async (root) => {
    const first = await receiveArtifact(root);
    assert.equal(
      runGate(
        root,
        `mountain-preview install ${previewPullNumber} ${first} manifest.json`,
      ).status,
      0,
    );
    assert.equal(authorizeRelease(root).status, 0);
    assert.equal(
      runGate(
        root,
        `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
      ).status,
      0,
    );
    const namespace = previewNamespacePaths(previewPullNumber);
    const interruptedCommit = "a".repeat(40);
    const orphan = join(namespace.releasesDirectory, interruptedCommit);
    await mkdir(orphan);
    await writeFile(join(orphan, "index.html"), "interrupted install");
    const second = await receiveArtifact(root, {
      commit: updatedPreviewCommit,
    });
    assert.equal(
      runGate(
        root,
        `mountain-preview install ${previewPullNumber} ${second} manifest.json`,
      ).status,
      0,
    );
    assert.equal(authorizeRelease(root, updatedPreviewCommit).status, 0);
    assert.equal(
      runGate(
        root,
        `mountain-preview activate ${previewPullNumber} ${updatedPreviewCommit}`,
      ).status,
      0,
    );
    const pruned = runGate(root, `mountain-preview prune ${previewPullNumber}`);
    assert.equal(pruned.status, 0, gateOutput(pruned));
    assert.equal(
      await pathExists(join(namespace.releasesDirectory, previewCommit)),
      false,
    );
    assert.equal(await pathExists(orphan), false);
    assert.equal(
      await pathExists(join(namespace.releasesDirectory, updatedPreviewCommit)),
      true,
    );
    assert.deepEqual(await readdir(namespace.incomingDirectory), []);
    assert.equal(
      JSON.parse(await readFile(namespace.registryFile, "utf8")).releases
        .length,
      1,
    );
  });
});

test("the bootstrap install layout resolves the preview command and process imports", async () => {
  const installRoot = await mkdtemp(
    join(tmpdir(), "mountain-preview-install-"),
  );
  const previewRoot = join(installRoot, "preview");
  const releaseLink = join(installRoot, "release");
  const installedGate = join(previewRoot, "commands/mountain-preview/cli.mjs");
  const installedProcess = join(
    previewRoot,
    "processes/mountain-preview-site/main.mjs",
  );
  const flatReleaseModules = [
    "archive.mjs",
    "config.mjs",
    "fsutil.mjs",
    "manifest.mjs",
    "operations.mjs",
    "receive.mjs",
    "registry.mjs",
    "validate.mjs",
    "cli.mjs",
    "daemon.mjs",
    "ssh-gate.mjs",
  ];

  try {
    await mkdir(join(previewRoot, "commands/mountain-preview"), {
      recursive: true,
    });
    await mkdir(join(previewRoot, "processes/mountain-preview-site"), {
      recursive: true,
    });
    await mkdir(join(previewRoot, "processes/preview-authorization"));
    await symlink(".", releaseLink);
    await cp(gatePath, installedGate);
    await cp(
      join(toolDirectory, "config.mjs"),
      join(previewRoot, "config.mjs"),
    );
    await cp(
      join(toolDirectory, "processes/preview-authorization/main.mjs"),
      join(previewRoot, "processes/preview-authorization/main.mjs"),
    );
    for (const moduleName of ["caddy-fragment.mjs", "caddy.mjs", "main.mjs"]) {
      await cp(
        join(toolDirectory, "processes/mountain-preview-site", moduleName),
        join(previewRoot, "processes/mountain-preview-site", moduleName),
      );
    }
    await cp(
      join(toolDirectory, "authorization-proof.mjs"),
      join(previewRoot, "authorization-proof.mjs"),
    );
    for (const moduleName of [
      "site-request.mjs",
      "retire.mjs",
      "capacity.mjs",
      "inventory.mjs",
      "prune.mjs",
    ]) {
      await cp(
        join(toolDirectory, "commands/mountain-preview", moduleName),
        join(previewRoot, "commands/mountain-preview", moduleName),
      );
    }
    for (const moduleName of flatReleaseModules) {
      await cp(
        join(toolDirectory, "../release", moduleName),
        join(installRoot, moduleName),
      );
    }
    assert.equal((await stat(join(installRoot, "cli.mjs"))).isFile(), true);
    assert.equal(await readlink(releaseLink), ".");

    const root = join(installRoot, "preview-data");
    await mkdir(join(root, "namespaces"), { recursive: true });
    const archiveBytes = Buffer.from("test upload");
    const result = runInstalledGate(
      installedGate,
      root,
      "mountain-preview receive 99 artifact.tar.gz",
      archiveBytes,
    );

    assert.equal(result.status, 0, gateOutput(result));
    assert.match(result.stdout, /Received artifact\.tar\.gz/);
    assert.equal(
      (
        await readFile(
          join(root, "namespaces", "pr-99", "incoming", "artifact.tar.gz"),
        )
      ).equals(archiveBytes),
      true,
    );
    const archiveName = previewArchiveName(previewCommit);
    const archive = await makePreviewArchiveBytes(previewFiles);
    await withPreviewAuthorization(
      root,
      async ({ env, privateKey }) => {
        for (const [name, bytes] of [
          [archiveName, archive],
          ["manifest.json", Buffer.from(JSON.stringify(makePreviewManifest()))],
        ]) {
          const receive = runInstalledGate(
            installedGate,
            root,
            `mountain-preview receive 99 ${name}`,
            bytes,
            env,
          );
          assert.equal(receive.status, 0, gateOutput(receive));
        }
        const install = runInstalledGate(
          installedGate,
          root,
          `mountain-preview install 99 ${archiveName} manifest.json`,
          undefined,
          env,
        );
        assert.equal(install.status, 0, gateOutput(install));
        const issuedAt = Date.now();
        const signature = signPreviewAuthorization(
          {
            pullRequestNumber: 99,
            commit: previewCommit,
            actor: "maintainer",
            issuedAt,
          },
          privateKey,
        );
        const authorize = runInstalledGate(
          installedGate,
          root,
          `mountain-preview authorize 99 ${previewCommit} maintainer`,
          JSON.stringify({ issuedAt, signature }),
          env,
        );
        assert.equal(authorize.status, 0, gateOutput(authorize));
        const registry = JSON.parse(
          await readFile(join(root, "namespaces/pr-99/releases.json"), "utf8"),
        );
        assert.equal(registry.releases[0].authorizedBy, "maintainer");
      },
      undefined,
      installedProcess,
    );
    const service = await readFile(
      join(toolDirectory, "../systemd/mountain-preview-site.service"),
      "utf8",
    );
    assert.match(
      service,
      /ExecStart=\/usr\/local\/lib\/mountain-runners\/preview\/processes\/mountain-preview-site\/main\.mjs/u,
    );
  } finally {
    await rm(installRoot, { recursive: true, force: true });
  }
});

test("bootstrap denies preview-deploy access to the production release root with a named ACL", async () => {
  const bootstrap = await readFile(
    join(toolDirectory, "../bootstrap/bootstrap.sh"),
    "utf8",
  );
  const previewUserSetup = bootstrap.indexOf("usermod -p '*' preview-deploy");
  const productionAcl = bootstrap.indexOf(
    'setfacl -n -m u:preview-deploy:--- "${RELEASE_ROOT}"',
  );

  assert.match(bootstrap, /apt-get install[^\n]*\bacl\b/u);
  assert.notEqual(previewUserSetup, -1);
  assert.notEqual(productionAcl, -1);
  assert.ok(productionAcl > previewUserSetup);
  assert.doesNotMatch(bootstrap, /setfacl\s+-R/u);
});

test("bootstrap preserves the Caddy preview fragment on a repeated run", async () => {
  const bootstrap = await readFile(
    join(toolDirectory, "../bootstrap/bootstrap.sh"),
    "utf8",
  );
  // The fragment is live configuration once a preview is enabled, so the
  // template only seeds it on a fresh server.
  const guard = bootstrap.indexOf(
    "if [[ ! -e /etc/caddy/Caddyfile.previews ]]; then",
  );
  const seed = bootstrap.indexOf(
    '/caddy/Caddyfile.previews" /etc/caddy/Caddyfile.previews',
  );
  assert.notEqual(guard, -1);
  assert.notEqual(seed, -1);
  assert.ok(guard < seed);
  assert.ok(bootstrap.indexOf("fi", seed) > seed);
});

test("the preview process sandbox permits authorization writes only inside preview namespaces", async () => {
  const service = await readFile(
    join(toolDirectory, "../systemd/mountain-preview-site.service"),
    "utf8",
  );
  assert.match(service, /^ProtectSystem=strict$/mu);
  assert.equal(
    service.match(/^ReadWritePaths=.*$/mu)?.[0],
    "ReadWritePaths=/etc/caddy /run /var/lib/mountain-runners-previews/namespaces",
  );
});

test("bootstrap and the preview-only runbook reject incompatible release paths before installing the gate", async () => {
  const bootstrap = await readFile(
    join(toolDirectory, "../bootstrap/bootstrap.sh"),
    "utf8",
  );
  const runbook = await readFile(
    join(toolDirectory, "../../../docs/runbook.md"),
    "utf8",
  );
  const bootstrapPathCheck = bootstrap.indexOf(
    'elif [[ -e "${RELEASE_IMPORT_LINK}" ]]',
  );
  const flatModuleInstall = bootstrap.indexOf(
    '"${TOOL_ROOT}/release/config.mjs"',
  );
  const runbookPathCheck = runbook.indexOf('if sudo test -L "$LIB/release"');
  const previewGateInstall = runbook.indexOf(
    '"$REPO/tools/server/preview/commands/mountain-preview/cli.mjs"',
  );

  assert.notEqual(bootstrapPathCheck, -1);
  assert.ok(bootstrapPathCheck < flatModuleInstall);
  assert.notEqual(runbookPathCheck, -1);
  assert.ok(runbookPathCheck < previewGateInstall);
});

test("rejects a manifest built for another pull request", async () => {
  await withPreviewRoot(async (root) => {
    // The trusted publisher stages the manifest bound to PR 99, but the
    // namespace argument is 98: the consistency check must reject it.
    await receiveArtifact(root, {
      namespacePullNumber: 98,
      pullRequestNumber: previewPullNumber,
      origin: previewOrigin(previewPullNumber),
    });

    const install = runGate(
      root,
      `mountain-preview install 98 ${previewArchiveName(previewCommit)} manifest.json`,
    );
    assert.equal(install.status, 1);
    assert.match(
      gateOutput(install),
      /does not match the preview origin|does not match namespace/,
    );
    assert.equal(
      await pathExists(
        join(previewNamespacePaths(98).releasesDirectory, previewCommit),
      ),
      false,
      "the foreign namespace must not receive the build",
    );
  });
});

test("rejects a production manifest inside a preview namespace", async () => {
  await withPreviewRoot(async (root) => {
    // A production manifest carries the production origin and no PR number.
    await receiveArtifact(root, {
      pullRequestNumber: undefined,
      origin: "https://mountainrunners.cat",
    });

    const install = runGate(
      root,
      `mountain-preview install ${previewPullNumber} ${previewArchiveName(previewCommit)} manifest.json`,
    );
    assert.equal(install.status, 1);
    assert.match(gateOutput(install), /does not match the preview origin/);
    assert.equal(
      await pathExists(
        join(
          previewNamespacePaths(previewPullNumber).releasesDirectory,
          previewCommit,
        ),
      ),
      false,
    );
  });
});

test("rejects a pull request number that is not decimal digits", async () => {
  await withPreviewRoot(async (root) => {
    const rejectedCommands = [
      `mountain-preview receive 9-evil index.html`,
      `mountain-preview install ../escape archive.tar.gz manifest.json`,
      `mountain-preview activate main ${previewCommit}`,
      `mountain-preview list 99 98`,
    ];
    for (const command of rejectedCommands) {
      const result = runGate(root, command);
      assert.equal(result.status, 1, `must reject: ${JSON.stringify(command)}`);
      assert.match(gateOutput(result), /decimal digits|requires exactly/);
    }
  });
});

test("rejects tokens with shell metacharacters and a tool other than mountain-preview", async () => {
  await withPreviewRoot(async (root) => {
    const metacharacterCommands = [
      `mountain-preview receive 99 index.html; rm -rf /`,
      `mountain-preview install 99 $(reboot) manifest.json`,
    ];
    for (const command of metacharacterCommands) {
      const result = runGate(root, command);
      assert.equal(result.status, 1, `must reject: ${JSON.stringify(command)}`);
      assert.match(gateOutput(result), /metacharacters/);
    }

    const wrongTool = runGate(root, `mountain-release list 99`);
    assert.equal(wrongTool.status, 1);
    assert.match(gateOutput(wrongTool), /Only the preview tool/);

    const emptyCommand = runGate(root, "");
    assert.equal(emptyCommand.status, 1);
    assert.match(gateOutput(emptyCommand), /No command was provided/);
  });
});

test("rejects malicious archives like the release tool", async () => {
  const maliciousCases = [
    {
      name: "absolute path entry",
      entries: [{ name: "/etc/passwd", content: "x" }],
      pattern: /unsafe entry name/,
    },
    {
      name: "traversal entry",
      entries: [{ name: "../evil", content: "x" }],
      pattern: /unsafe entry name/,
    },
    {
      name: "symlink entry",
      entries: [
        { name: "index.html", content: "ok" },
        { name: "secret", type: "2", linkname: "/etc/passwd" },
      ],
      pattern: /unsupported type/,
    },
    {
      name: "hardlink entry",
      entries: [
        { name: "index.html", content: "ok" },
        { name: "alias", type: "1", linkname: "index.html" },
      ],
      pattern: /unsupported type/,
    },
    {
      name: "device entry",
      entries: [
        { name: "index.html", content: "ok" },
        { name: "device", type: "3" },
      ],
      pattern: /unsupported type/,
    },
    {
      name: "duplicate entries",
      entries: [
        { name: "index.html", content: "first" },
        { name: "index.html", content: "second" },
      ],
      pattern: /more than once/,
    },
    {
      name: "directory bomb over the entry count",
      entries: Array.from({ length: 5_001 }, (_, index) => ({
        name: `dir-${index}/`,
        type: "5",
      })),
      pattern: /file count limit/,
    },
    {
      name: "expanded size over the limit",
      entries: [
        { name: "index.html", type: "0", content: "x", size: 134_217_729 },
      ],
      pattern: /expanded size limit|tar failed/,
    },
  ];

  for (const { name, entries, pattern } of maliciousCases) {
    await withPreviewRoot(async (root) => {
      const namespace = previewNamespacePaths(previewPullNumber);
      await mkdir(join(namespace.root, "incoming"), { recursive: true });
      const archivePath = join(
        namespace.incomingDirectory,
        previewArchiveName(previewCommit),
      );
      await writeCraftedArchive(archivePath, entries);
      await writeFile(
        join(namespace.incomingDirectory, "manifest.json"),
        JSON.stringify(makePreviewManifest({ files: previewFiles })),
      );

      const result = runGate(
        root,
        `mountain-preview install ${previewPullNumber} ${previewArchiveName(previewCommit)} manifest.json`,
      );
      assert.equal(result.status, 1, `${name} must be rejected`);
      assert.match(gateOutput(result), pattern);
      assert.equal(
        await pathExists(join(namespace.releasesDirectory, previewCommit)),
        false,
      );
    });
  }
});

test("rejects a digest mismatch and removes the incomplete release", async () => {
  await withPreviewRoot(async (root) => {
    const namespace = previewNamespacePaths(previewPullNumber);
    await mkdir(join(namespace.root, "incoming"), { recursive: true });
    await makeNormalArchive(
      join(namespace.incomingDirectory, previewArchiveName(previewCommit)),
      previewFiles,
    );
    await writeFile(
      join(namespace.incomingDirectory, "manifest.json"),
      JSON.stringify(
        makePreviewManifest({
          files: [
            { path: "index.html", content: "<html>preview home</html>" },
            // Tampered: the archive stores the untampered content.
            { path: "ca/index.html", content: "<html>tampered</html>" },
          ],
        }),
      ),
    );

    const result = runGate(
      root,
      `mountain-preview install ${previewPullNumber} ${previewArchiveName(previewCommit)} manifest.json`,
    );
    assert.equal(result.status, 1);
    assert.match(gateOutput(result), /Digest mismatch/);
    assert.equal(
      await pathExists(join(namespace.releasesDirectory, previewCommit)),
      false,
    );
    assert.equal(await pathExists(namespace.registryFile), false);
  });
});

test("a failed install does not move an existing namespace pointer", async () => {
  await withPreviewRoot(async (root) => {
    await receiveArtifact(root, previewCommit);
    const namespace = previewNamespacePaths(previewPullNumber);
    const install = runGate(
      root,
      `mountain-preview install ${previewPullNumber} ${previewArchiveName(previewCommit)} manifest.json`,
    );
    assert.equal(install.status, 0, gateOutput(install));
    assert.equal(authorizeRelease(root).status, 0);
    const activate = runGate(
      root,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
    );
    assert.equal(activate.status, 0, gateOutput(activate));
    const currentBefore = await readlink(namespace.currentLink);

    // Stage a second commit whose content is tampered relative to its manifest.
    await makeNormalArchive(
      join(
        namespace.incomingDirectory,
        previewArchiveName(updatedPreviewCommit),
      ),
      previewFiles,
    );
    await writeFile(
      join(namespace.incomingDirectory, "manifest.json"),
      JSON.stringify(
        makePreviewManifest({
          commit: updatedPreviewCommit,
          files: [
            { path: "index.html", content: "<html>preview home</html>" },
            { path: "ca/index.html", content: "<html>tampered</html>" },
          ],
        }),
      ),
    );

    const result = runGate(
      root,
      `mountain-preview install ${previewPullNumber} ${previewArchiveName(updatedPreviewCommit)} manifest.json`,
    );
    assert.equal(result.status, 1);
    assert.match(gateOutput(result), /Digest mismatch/);
    assert.equal(
      await pathExists(join(namespace.releasesDirectory, updatedPreviewCommit)),
      false,
    );
    assert.equal(await readlink(namespace.currentLink), currentBefore);
  });
});

test("activate requires an installed commit and rejects an unknown one", async () => {
  await withPreviewRoot(async (root) => {
    const result = runGate(
      root,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
    );
    assert.equal(result.status, 1);
    assert.match(gateOutput(result), /no current authorization/);
  });
});

test("health reports a degraded namespace when nothing is active", async () => {
  await withPreviewRoot(async (root) => {
    const result = runGate(
      root,
      `mountain-preview health ${previewPullNumber}`,
    );
    assert.equal(result.status, 1);
    assert.match(gateOutput(result), /Health: DEGRADED/);
  });
});

test("the direct invocation (maintainer CLI) runs the same operations", async () => {
  await withPreviewRoot(async (root) => {
    await receiveArtifact(root, previewCommit);

    const install = runGateDirect(root, [
      "install",
      String(previewPullNumber),
      previewArchiveName(previewCommit),
      "manifest.json",
    ]);
    assert.equal(install.status, 0, gateOutput(install));
    assert.match(install.stdout, /Installed release/);
    assert.equal(authorizeRelease(root).status, 0);

    const activate = runGateDirect(root, [
      "activate",
      String(previewPullNumber),
      previewCommit,
    ]);
    assert.equal(activate.status, 0, gateOutput(activate));
  });
});

test("the preview workflow pins actions, separates the trust boundaries and has no approval click", async () => {
  const previewWorkflow = await readFile(
    join(toolDirectory, "../../../.github/workflows/preview.yml"),
    "utf8",
  );

  // Triggered on demand: a /preview comment or a manual dispatch; nothing
  // builds or publishes automatically on pull request events.
  assert.match(previewWorkflow, /issue_comment:\n {4}types: \[created\]/);
  assert.match(previewWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(previewWorkflow, /pull_request:/);
  assert.doesNotMatch(previewWorkflow, /pull_request_target/);
  assert.match(previewWorkflow, /pull-requests: read/);
  assert.match(
    previewWorkflow,
    /github.ref == 'refs\/heads\/main' && github.event.repository.fork == false/,
  );

  // The authorize job resolves the request from trusted code on main.
  assert.match(previewWorkflow, /node tools\/preview\/resolve-publish\.mjs/);

  // The untrusted build job: no secrets, no environment, no caches, and the
  // checkout is the pull request head SHA resolved by the authorize job.
  const [authorizeJob, restOfWorkflow] = previewWorkflow.split("\n  build:\n");
  const [buildJob, publishJob] = restOfWorkflow.split("\n  publish:\n");
  assert.match(
    authorizeJob,
    /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
  );
  assert.doesNotMatch(buildJob, /secrets\./);
  assert.doesNotMatch(buildJob, /environment:/);
  assert.doesNotMatch(buildJob, /cache:/);
  assert.match(
    buildJob,
    /ref: \$\{\{ needs\.authorize\.outputs\.head_sha \}\}/,
  );
  assert.match(buildJob, /node tools\/preview\/build-artifact\.mjs/);
  assert.match(
    buildJob,
    /uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/,
  );

  // The trusted publish job: code from main behind the previews environment
  // (secrets only), the same-run artifact and the publish script.
  assert.match(publishJob, /needs: \[authorize, build\]/);
  assert.match(publishJob, /name: previews/);
  assert.match(publishJob, /group: previews/);
  assert.match(publishJob, /cancel-in-progress: false/);
  assert.match(publishJob, /secrets\.PREVIEW_SSH_PRIVATE_KEY/);
  assert.match(
    publishJob,
    /uses: actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/,
  );
  assert.doesNotMatch(publishJob, /run-id:/);
  assert.match(publishJob, /node tools\/preview\/publish\.mjs/);
});
