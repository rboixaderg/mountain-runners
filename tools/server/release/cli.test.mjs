// Tests for the release tooling (phase 5, task 5.3).
//
// Run with: node --test tools/server/release/
//
// The suite exercises the security-critical paths with adversarial archives
// (absolute paths, traversal, symlinks, hardlinks, devices, duplicates, limits
// and digest mismatches) and the registry lifecycle (install, activate,
// rollback, revoke, health) without any production credentials or fixtures.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { assertWithinApprovedLimits } from "./archive.mjs";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const cliPath = join(toolDirectory, "cli.mjs");
const sshGatePath = join(toolDirectory, "ssh-gate.mjs");

const testCommit = "1f8611b283f924aab99aa98a6cff524306138a46";

async function withReleaseRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "mountain-release-test-"));
  try {
    await mkdir(join(root, "releases"), { recursive: true });
    await mkdir(join(root, "incoming"), { recursive: true });
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runCli(root, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, MOUNTAIN_RELEASE_ROOT: root },
  });
}

// Spawns the root release daemon on a per-test socket and runs the given
// function; the deploy identity reaches the daemon only through the gate.
async function withDaemon(root, run) {
  const socketPath = join(root, "mountain-release.sock");
  const daemon = spawn(process.execPath, [cliPath, "daemon"], {
    env: {
      ...process.env,
      MOUNTAIN_RELEASE_ROOT: root,
      MOUNTAIN_RELEASE_DAEMON_SOCKET: socketPath,
    },
    stdio: "ignore",
  });
  try {
    await waitForSocket(socketPath);
    return await run(socketPath);
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((resolveDone) => daemon.once("exit", resolveDone));
  }
}

async function waitForSocket(socketPath) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await stat(socketPath);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await new Promise((resolveDone) => setTimeout(resolveDone, 50));
    }
  }
  throw new Error("The release daemon did not start its socket in time.");
}

function runGate(root, socketPath, originalCommand) {
  return spawnSync(process.execPath, [sshGatePath], {
    encoding: "utf8",
    env: {
      ...process.env,
      MOUNTAIN_RELEASE_ROOT: root,
      MOUNTAIN_RELEASE_DAEMON_SOCKET: socketPath,
      SSH_ORIGINAL_COMMAND: originalCommand,
    },
  });
}

function gateOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function requestDaemon(socketPath, payload) {
  return new Promise((resolveDone, rejectDone) => {
    const socket = connect(socketPath);
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", rejectDone);
    socket.on("close", () => resolveDone(response.trim()));
    socket.write(`${payload}\n`);
  });
}

function makeManifest({ commit = testCommit, files }) {
  const manifestFiles = files.map(({ path, content }) => ({
    path,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256Of(Buffer.from(content, "utf8")),
  }));
  return {
    schemaVersion: 1,
    commit,
    origin: "https://mountainrunners.cat",
    buildToday: "2026-08-16",
    workflow: "Artifact",
    limits: { maxExpandedBytes: 134_217_728, maxFileCount: 5_000 },
    totals: {
      fileCount: manifestFiles.length,
      expandedBytes: manifestFiles.reduce((sum, entry) => sum + entry.size, 0),
    },
    files: manifestFiles,
  };
}

function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function makeNormalArchive(destination, files) {
  const sourceDirectory = await mkdtemp(
    join(tmpdir(), "mountain-archive-src-"),
  );
  try {
    const names = [];
    for (const { path, content } of files) {
      const absolutePath = join(sourceDirectory, path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
      names.push(path);
    }
    const result = spawnSync(
      "tar",
      ["-czf", destination, "-C", sourceDirectory, ...names],
      {
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(sourceDirectory, { recursive: true, force: true });
  }
}

async function writeCraftedArchive(destination, entries) {
  await writeFile(destination, craftTarGz(entries));
}

// Builds a raw ustar archive with arbitrary type flags and names so the
// validator is tested against entries that system tar would never create.
function craftTarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "", "utf8");
    blocks.push(tarHeader(entry, content.length));
    if (content.length > 0) {
      const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
      content.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(512), Buffer.alloc(512));
  return gzipSync(Buffer.concat(blocks));
}

function tarHeader(
  { name, type = "0", linkname = "", size: sizeOverride },
  contentLength,
) {
  const recordedSize = sizeOverride ?? contentLength;
  const header = Buffer.alloc(512);
  Buffer.from(name, "utf8").copy(header, 0);
  writeOctal(header, 100, 0o644);
  writeOctal(header, 108, 0);
  writeOctal(header, 116, 0);
  writeTarSize(header, recordedSize);
  writeOctal(header, 136, 0);
  header[156] = type.charCodeAt(0);
  Buffer.from(linkname, "utf8").copy(header, 157);
  Buffer.from("ustar\u0000", "utf8").copy(header, 257);
  header[263] = 0x30;
  header[264] = 0x30;
  // The checksum is computed with the checksum field treated as spaces.
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const encoded = checksum.toString(8).padStart(6, "0");
  header.write(encoded, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeTarSize(header, size) {
  const encoded = size.toString(8).padStart(11, "0");
  header.write(encoded, 124, 11, "ascii");
  header[135] = 0;
}

function writeOctal(header, offset, value) {
  header.write(value.toString(8).padStart(6, "0"), offset, 6, "ascii");
  header[offset + 6] = 0;
  header[offset + 7] = 0x20;
}

const simpleFiles = [
  { path: "index.html", content: "<html>home</html>" },
  { path: "ca/index.html", content: "<html>hola</html>" },
];

test("installs, activates and reports health for a valid artifact", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await makeNormalArchive(archivePath, simpleFiles);
    await writeFile(
      manifestPath,
      JSON.stringify(makeManifest({ files: simpleFiles })),
    );

    const install = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /Installed release 1f8611b283f9/);

    const releaseDirectory = join(root, "releases", testCommit);
    assert.equal(
      await readFile(join(releaseDirectory, "ca/index.html"), "utf8"),
      "<html>hola</html>",
    );

    const activate = runCli(root, ["activate", testCommit]);
    assert.equal(activate.status, 0, activate.stderr);
    assert.match(activate.stdout, /Activated release 1f8611b283f9/);
    assert.equal(await readlink(join(root, "current")), releaseDirectory);

    const list = runCli(root, ["list"]);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /active\s+1f8611b283f9/);

    const health = runCli(root, ["health"]);
    assert.equal(health.status, 0, health.stderr);
    assert.match(health.stdout, /Health: OK/);
  });
});

test("rejects an absolute path entry", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await writeCraftedArchive(archivePath, [
      { name: "/etc/passwd", content: "x" },
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify(
        makeManifest({ files: [{ path: "etc/passwd", content: "x" }] }),
      ),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsafe entry name/);
    assert.equal(await pathExists(join(root, "releases", testCommit)), false);
  });
});

test("rejects traversal entries", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await writeCraftedArchive(archivePath, [{ name: "../evil", content: "x" }]);
    await writeFile(
      manifestPath,
      JSON.stringify(makeManifest({ files: [{ path: "evil", content: "x" }] })),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsafe entry name/);
  });
});

test("rejects symlink entries", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await writeCraftedArchive(archivePath, [
      { name: "index.html", content: "ok" },
      { name: "secret", type: "2", linkname: "/etc/passwd" },
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify(
        makeManifest({ files: [{ path: "index.html", content: "ok" }] }),
      ),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported type/);
  });
});

test("rejects hardlink entries", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await writeCraftedArchive(archivePath, [
      { name: "index.html", content: "ok" },
      { name: "alias", type: "1", linkname: "index.html" },
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify(
        makeManifest({ files: [{ path: "index.html", content: "ok" }] }),
      ),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported type/);
  });
});

test("rejects character, block and FIFO device entries", async () => {
  for (const type of ["3", "4", "6"]) {
    await withReleaseRoot(async (root) => {
      const archivePath = join(root, "incoming", "release.tar.gz");
      const manifestPath = join(root, "incoming", "manifest.json");
      await writeCraftedArchive(archivePath, [
        { name: "index.html", content: "ok" },
        { name: "device", type },
      ]);
      await writeFile(
        manifestPath,
        JSON.stringify(
          makeManifest({ files: [{ path: "index.html", content: "ok" }] }),
        ),
      );

      const result = runCli(root, ["install", archivePath, manifestPath]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unsupported type/);
    });
  }
});

test("rejects duplicate entries", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await writeCraftedArchive(archivePath, [
      { name: "index.html", content: "first" },
      { name: "index.html", content: "second" },
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify(
        makeManifest({ files: [{ path: "index.html", content: "first" }] }),
      ),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /more than once/);
  });
});

test("rejects a digest mismatch and removes the incomplete release", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await makeNormalArchive(archivePath, simpleFiles);
    const manifest = makeManifest({
      files: [
        { path: "index.html", content: "<html>home</html>" },
        // Tampered: the archive stores "<html>hola</html>" for ca/index.html.
        { path: "ca/index.html", content: "<html>tampered</html>" },
      ],
    });
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Digest mismatch/);
    assert.equal(await pathExists(join(root, "releases", testCommit)), false);
    assert.equal(
      await pathExists(join(root, "releases.json")),
      false,
      "registry must not exist after a failed install",
    );
  });
});

test("a failed install does not move an existing current pointer", async () => {
  await withReleaseRoot(async (root) => {
    const firstArchive = join(root, "incoming", "first.tar.gz");
    const firstManifest = join(root, "incoming", "first.json");
    await makeNormalArchive(firstArchive, simpleFiles);
    await writeFile(
      firstManifest,
      JSON.stringify(makeManifest({ files: simpleFiles })),
    );
    assert.equal(
      runCli(root, ["install", firstArchive, firstManifest]).status,
      0,
    );
    assert.equal(runCli(root, ["activate", testCommit]).status, 0);
    const currentBefore = await readlink(join(root, "current"));

    const secondCommit = "a".repeat(40);
    const secondArchive = join(root, "incoming", "second.tar.gz");
    const secondManifest = join(root, "incoming", "second.json");
    await makeNormalArchive(secondArchive, simpleFiles);
    await writeFile(
      secondManifest,
      JSON.stringify(
        makeManifest({
          commit: secondCommit,
          files: [
            { path: "index.html", content: "<html>home</html>" },
            { path: "ca/index.html", content: "<html>tampered</html>" },
          ],
        }),
      ),
    );

    const result = runCli(root, ["install", secondArchive, secondManifest]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Digest mismatch/);
    assert.equal(await pathExists(join(root, "releases", secondCommit)), false);
    assert.equal(await readlink(join(root, "current")), currentBefore);
  });
});

test("rejects an archive whose file set differs from the manifest", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await makeNormalArchive(archivePath, [
      ...simpleFiles,
      { path: "extra.html", content: "unexpected" },
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify(makeManifest({ files: simpleFiles })),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the manifest/);
  });
});

test("rejects invalid manifests", async () => {
  const invalidCases = [
    {
      name: "bad commit",
      manifest: makeManifest({
        commit: "not-a-commit",
        files: [{ path: "index.html", content: "x" }],
      }),
    },
    {
      name: "unsafe path",
      manifest: makeManifest({
        files: [{ path: "../escape.html", content: "x" }],
      }),
    },
    {
      name: "duplicate paths",
      manifest: makeManifest({
        files: [
          { path: "index.html", content: "x" },
          { path: "index.html", content: "y" },
        ],
      }),
    },
    {
      name: "totals mismatch",
      manifest: (() => {
        const manifest = makeManifest({
          files: [{ path: "index.html", content: "x" }],
        });
        manifest.totals.fileCount = 99;
        return manifest;
      })(),
    },
  ];

  for (const { name, manifest } of invalidCases) {
    await withReleaseRoot(async (root) => {
      const archivePath = join(root, "incoming", "release.tar.gz");
      const manifestPath = join(root, "incoming", "manifest.json");
      await makeNormalArchive(archivePath, simpleFiles);
      await writeFile(manifestPath, JSON.stringify(manifest));

      const result = runCli(root, ["install", archivePath, manifestPath]);
      assert.equal(result.status, 1, `${name} must be rejected`);
    });
  }
});

test("enforces the approved size and count limits", () => {
  const limits = { maxExpandedBytes: 100, maxFileCount: 3 };
  assert.doesNotThrow(() => assertWithinApprovedLimits(3, 100, limits));
  assert.throws(
    () => assertWithinApprovedLimits(4, 50, limits),
    /file count limit/,
  );
  assert.throws(
    () => assertWithinApprovedLimits(2, 101, limits),
    /expanded size limit/,
  );
});

test("activation, rollback and revocation lifecycle", async () => {
  await withReleaseRoot(async (root) => {
    const commitB = "b".repeat(40);
    const commitC = "c".repeat(40);
    const releases = [
      [testCommit, [{ path: "index.html", content: "version a" }]],
      [commitB, [{ path: "index.html", content: "version b" }]],
      [commitC, [{ path: "index.html", content: "version c" }]],
    ];

    for (const [commit, files] of releases) {
      const archivePath = join(root, "incoming", `${commit}.tar.gz`);
      const manifestPath = join(root, "incoming", `${commit}.json`);
      await makeNormalArchive(archivePath, files);
      await writeFile(
        manifestPath,
        JSON.stringify(makeManifest({ commit, files })),
      );
      assert.equal(
        runCli(root, ["install", archivePath, manifestPath]).status,
        0,
      );
    }

    assert.equal(runCli(root, ["activate", testCommit]).status, 0);
    assert.equal(
      await readlink(join(root, "current")),
      join(root, "releases", testCommit),
    );

    // Rollback without a commit activates the most recent eligible release (C).
    const rollback = runCli(root, ["rollback"]);
    assert.equal(rollback.status, 0, rollback.stderr);
    assert.equal(
      await readlink(join(root, "current")),
      join(root, "releases", commitC),
    );

    // Explicit rollback to a specific eligible release.
    assert.equal(runCli(root, ["rollback", commitB]).status, 0);
    assert.equal(
      await readlink(join(root, "current")),
      join(root, "releases", commitB),
    );

    // The active release cannot be revoked; candidates can.
    const revokeActive = runCli(root, ["revoke", commitB, "--reason", "test"]);
    assert.equal(revokeActive.status, 1);
    assert.match(revokeActive.stderr, /is active/);

    assert.equal(
      runCli(root, ["revoke", testCommit, "--reason", "test"]).status,
      0,
    );
    const activateRevoked = runCli(root, ["activate", testCommit]);
    assert.equal(activateRevoked.status, 1);
    assert.match(activateRevoked.stderr, /not eligible/);

    // Revoking the last eligible release leaves rollback without options.
    assert.equal(
      runCli(root, ["revoke", commitC, "--reason", "test"]).status,
      0,
    );
    const emptyRollback = runCli(root, ["rollback"]);
    assert.equal(emptyRollback.status, 3);
    assert.match(emptyRollback.stderr, /emergency response/);
  });
});

test("health reports a degraded state when no release is active", async () => {
  await withReleaseRoot(async (root) => {
    const health = runCli(root, ["health"]);
    assert.equal(health.status, 1);
    assert.match(health.stdout, /Health: DEGRADED/);
  });
});

test("the SSH gate reaches the daemon and performs validated operations", async () => {
  await withReleaseRoot(async (root) => {
    await withDaemon(root, async (socketPath) => {
      const archiveName = "release.tar.gz";
      const archivePath = join(root, "incoming", archiveName);
      const manifestPath = join(root, "incoming", "manifest.json");
      await makeNormalArchive(archivePath, simpleFiles);
      await writeFile(
        manifestPath,
        JSON.stringify(makeManifest({ files: simpleFiles })),
      );

      const install = runGate(
        root,
        socketPath,
        `mountain-release install ${archiveName} manifest.json`,
      );
      assert.equal(install.status, 0, install.stderr);
      assert.equal(await pathExists(join(root, "releases", testCommit)), true);

      const activate = runGate(
        root,
        socketPath,
        `mountain-release activate ${testCommit}`,
      );
      assert.equal(activate.status, 0, activate.stderr);
      assert.equal(
        await readlink(join(root, "current")),
        join(root, "releases", testCommit),
      );

      assert.equal(
        runGate(root, socketPath, "mountain-release list").status,
        0,
      );
      assert.equal(
        runGate(root, socketPath, "mountain-release health").status,
        0,
      );

      const revokeActive = runGate(
        root,
        socketPath,
        `mountain-release revoke ${testCommit} --reason auditoria`,
      );
      assert.equal(revokeActive.status, 1, gateOutput(revokeActive));
      assert.match(gateOutput(revokeActive), /is active/);

      const emptyRollback = runGate(
        root,
        socketPath,
        "mountain-release rollback",
      );
      assert.equal(emptyRollback.status, 3, gateOutput(emptyRollback));
      assert.match(gateOutput(emptyRollback), /emergency response/);
    });
  });
});

test("the SSH gate rejects metacharacters and the daemon rejects bad arguments", async () => {
  await withReleaseRoot(async (root) => {
    await withDaemon(root, async (socketPath) => {
      const metacharacterCommands = [
        "mountain-release install release.tar.gz; rm -rf /",
        "mountain-release install $(reboot) manifest.json",
      ];
      for (const command of metacharacterCommands) {
        const result = runGate(root, socketPath, command);
        assert.equal(
          result.status,
          1,
          `must reject: ${JSON.stringify(command)}`,
        );
        assert.match(result.stderr, /metacharacters/);
      }

      const daemonRejected = [
        [
          "mountain-release install ../outside.tar.gz manifest.json",
          /incoming directory/,
        ],
        [
          "mountain-release install /etc/passwd manifest.json",
          /incoming directory/,
        ],
        ["mountain-release activate", /requires a commit/],
        ["mountain-release activate short", /40-character hex/],
        ["mountain-release revoke abc --reason fine", /valid commit/],
        [
          "mountain-release unknown-command",
          /Unknown command|Only the release tool/,
        ],
        [
          "mountain-release install release.tar.gz manifest.json --extra",
          /exactly an archive/,
        ],
      ];
      for (const [command, pattern] of daemonRejected) {
        const result = runGate(root, socketPath, command);
        assert.equal(
          result.status,
          1,
          `must reject: ${JSON.stringify(command)}`,
        );
        assert.match(gateOutput(result), pattern);
      }

      const emptyCommand = runGate(root, socketPath, "");
      assert.equal(emptyCommand.status, 1);
      assert.match(emptyCommand.stderr, /No command was provided/);
    });
  });
});

test("the release daemon rejects malformed requests and maps no-eligible to exit 3", async () => {
  await withReleaseRoot(async (root) => {
    await withDaemon(root, async (socketPath) => {
      const invalid = await requestDaemon(socketPath, "not-json");
      assert.match(invalid, /"ok":false/);

      const unknown = await requestDaemon(
        socketPath,
        JSON.stringify({ command: "reboot", args: [] }),
      );
      assert.match(unknown, /Unknown command/);

      const escaping = await requestDaemon(
        socketPath,
        JSON.stringify({
          command: "install",
          args: ["../escape.tar.gz", "manifest.json"],
        }),
      );
      assert.match(escaping, /incoming directory/);

      const emptyRollback = JSON.parse(
        await requestDaemon(
          socketPath,
          JSON.stringify({ command: "rollback", args: [] }),
        ),
      );
      assert.equal(emptyRollback.ok, false);
      assert.equal(emptyRollback.noEligible, true);

      const degradedHealth = JSON.parse(
        await requestDaemon(
          socketPath,
          JSON.stringify({ command: "health", args: [] }),
        ),
      );
      assert.equal(degradedHealth.ok, false);
      assert.match(degradedHealth.message, /DEGRADED/);

      const tooLarge = await requestDaemon(socketPath, "x".repeat(8 * 1024));
      assert.match(tooLarge, /Request too large/);
    });
  });
});

test("rejects a FIFO placed in incoming/ without hanging", async () => {
  await withReleaseRoot(async (root) => {
    const fifoPath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    const created = spawnSync("mkfifo", [fifoPath]);
    if (created.status !== 0) {
      // mkfifo unavailable: nothing to assert.
      return;
    }
    await writeFile(
      manifestPath,
      JSON.stringify(makeManifest({ files: simpleFiles })),
    );

    const startedAt = Date.now();
    const result = runCli(root, ["install", fifoPath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a regular file/);
    assert.ok(
      Date.now() - startedAt < 5_000,
      "the FIFO read must not block the operation",
    );
  });
});

test("rejects a directory bomb over the approved entry count", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    const manyDirectories = Array.from({ length: 5_001 }, (_, index) => ({
      name: `dir-${index}/`,
      type: "5",
    }));
    await writeCraftedArchive(archivePath, manyDirectories);
    await writeFile(
      manifestPath,
      JSON.stringify(makeManifest({ files: simpleFiles })),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /file count limit/);
  });
});

test("rejects an archive whose listed expanded size exceeds the limit", async () => {
  await withReleaseRoot(async (root) => {
    const archivePath = join(root, "incoming", "release.tar.gz");
    const manifestPath = join(root, "incoming", "manifest.json");
    await writeCraftedArchive(archivePath, [
      { name: "index.html", type: "0", content: "x", size: 134_217_729 },
    ]);
    await writeFile(
      manifestPath,
      JSON.stringify(makeManifest({ files: simpleFiles })),
    );

    const result = runCli(root, ["install", archivePath, manifestPath]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expanded size limit|tar failed/);
    assert.equal(await pathExists(join(root, "releases", testCommit)), false);
  });
});

test("the daemon stores the revocation reason supplied through the gate", async () => {
  await withReleaseRoot(async (root) => {
    await withDaemon(root, async (socketPath) => {
      const archiveName = "release.tar.gz";
      await makeNormalArchive(join(root, "incoming", archiveName), simpleFiles);
      await writeFile(
        join(root, "incoming", "manifest.json"),
        JSON.stringify(makeManifest({ files: simpleFiles })),
      );
      assert.equal(
        runGate(
          root,
          socketPath,
          `mountain-release install ${archiveName} manifest.json`,
        ).status,
        0,
      );

      const revoke = runGate(
        root,
        socketPath,
        `mountain-release revoke ${testCommit} --reason vulnerabilitat`,
      );
      assert.equal(revoke.status, 0, revoke.stderr);
      const registry = JSON.parse(
        await readFile(join(root, "releases.json"), "utf8"),
      );
      assert.equal(registry.releases[0].revokedReason, "vulnerabilitat");
    });
  });
});

test("bootstrap installs every release module and verifies Caddy with SHA-512", async () => {
  const bootstrap = await readFile(
    join(toolDirectory, "../bootstrap/bootstrap.sh"),
    "utf8",
  );
  const requiredModules = [
    "config.mjs",
    "fsutil.mjs",
    "manifest.mjs",
    "archive.mjs",
    "registry.mjs",
    "validate.mjs",
    "operations.mjs",
    "daemon.mjs",
    "cli.mjs",
    "ssh-gate.mjs",
  ];
  for (const moduleName of requiredModules) {
    assert.match(bootstrap, new RegExp(moduleName.replaceAll(".", "\\.")));
  }
  assert.match(bootstrap, /sha512sum/);
  assert.doesNotMatch(bootstrap, /sha256sum/);
  assert.match(bootstrap, /caddy-mountain-runners\.conf/);
  assert.doesNotMatch(bootstrap, /grep -q/);
  const bootstrapMode = (
    await stat(join(toolDirectory, "../bootstrap/bootstrap.sh"))
  ).mode;
  assert.equal(bootstrapMode & 0o111, 0o111, "bootstrap.sh must be executable");
});

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
