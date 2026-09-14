// Tests for the preview gate and namespace operations (T6.3).
//
// Run with: node --test tools/server/preview/
//
// The suite exercises the security-critical preview paths with adversarial
// archives (absolute paths, traversal, symlinks, hardlinks, devices,
// duplicates, limits and digest mismatches), the pull request namespace
// binding (origin and PR number must match the namespace argument) and the
// namespace lifecycle (receive, install, activate, list, health). The gate
// runs directly as the preview identity: no daemon, no root and no
// production credentials.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
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

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const gatePath = join(toolDirectory, "gate.mjs");

const previewPullNumber = 99;
const previewCommit = "9".repeat(40);
const updatedPreviewCommit = "8".repeat(40);

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
    return await run(root);
  } finally {
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
      SSH_ORIGINAL_COMMAND: originalCommand,
    },
  });
}

function runGateDirect(root, args) {
  return spawnSync(process.execPath, [gatePath, ...args], {
    encoding: "utf8",
    env: { ...process.env, MOUNTAIN_PREVIEW_ROOT: root },
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
    assert.match(gateOutput(result), /not registered/);
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

    const activate = runGateDirect(root, [
      "activate",
      String(previewPullNumber),
      previewCommit,
    ]);
    assert.equal(activate.status, 0, gateOutput(activate));
  });
});

test("the preview workflows pin actions, keep secrets off the build and gate the publisher", async () => {
  const buildWorkflow = await readFile(
    join(toolDirectory, "../../../.github/workflows/preview-build.yml"),
    "utf8",
  );
  const publishWorkflow = await readFile(
    join(toolDirectory, "../../../.github/workflows/preview-publish.yml"),
    "utf8",
  );

  // The untrusted build job: no secrets, no environment, no caches.
  assert.match(buildWorkflow, /pull_request:/);
  assert.match(buildWorkflow, /types: \[opened, synchronize, reopened\]/);
  assert.match(buildWorkflow, /permissions:\n {2}contents: read\n/);
  assert.doesNotMatch(buildWorkflow, /secrets\./);
  assert.doesNotMatch(buildWorkflow, /environment:/);
  assert.doesNotMatch(buildWorkflow, /cache:/);
  assert.match(
    buildWorkflow,
    /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
  );
  assert.match(buildWorkflow, /node tools\/preview\/build-artifact\.mjs/);

  // The trusted publisher: main-only, the previews environment for secrets,
  // comment- and dispatch-triggered, no forks and no approval click.
  assert.match(publishWorkflow, /workflow_dispatch:/);
  assert.match(publishWorkflow, /issue_comment:\n {4}types: \[created\]/);
  assert.match(publishWorkflow, /pull-requests: read/);
  assert.match(publishWorkflow, /name: previews/);
  assert.match(publishWorkflow, /group: previews/);
  assert.match(publishWorkflow, /cancel-in-progress: false/);
  assert.match(
    publishWorkflow,
    /github.ref == 'refs\/heads\/main' && github.event.repository.fork == false/,
  );
  assert.match(publishWorkflow, /actions: read/);
  assert.match(publishWorkflow, /secrets\.PREVIEW_SSH_PRIVATE_KEY/);
  assert.match(
    publishWorkflow,
    /uses: actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/,
  );
  assert.match(publishWorkflow, /node tools\/preview\/resolve-comment\.mjs/);
  assert.match(publishWorkflow, /node tools\/preview\/verify-source-run\.mjs/);
  assert.match(publishWorkflow, /node tools\/preview\/publish\.mjs/);
  assert.match(
    publishWorkflow,
    /if: steps\.resolve\.outputs\.should_publish == 'true'/,
  );

  // No pull_request_target anywhere in the preview system.
  assert.doesNotMatch(buildWorkflow, /pull_request_target/);
  assert.doesNotMatch(publishWorkflow, /pull_request_target/);
});
