// Incoming receive path (phase 5, task 5.4).
//
// The deploy identity cannot use scp/sftp, so the SSH gate writes stdin into
// incoming/. These tests cover that write without production credentials.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { approvedLimits } from "./config.mjs";
import { receiveIncomingFile } from "./receive.mjs";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const cliPath = join(toolDirectory, "cli.mjs");
const sshGatePath = join(toolDirectory, "ssh-gate.mjs");
const testCommit = "1f8611b283f924aab99aa98a6cff524306138a46";

async function withReleaseRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "mountain-receive-test-"));
  try {
    await mkdir(join(root, "releases"), { recursive: true });
    await mkdir(join(root, "incoming"), { recursive: true });
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

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

function runGate(root, socketPath, originalCommand, input) {
  return spawnSync(process.execPath, [sshGatePath], {
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      MOUNTAIN_RELEASE_ROOT: root,
      MOUNTAIN_RELEASE_DAEMON_SOCKET: socketPath,
      SSH_ORIGINAL_COMMAND: originalCommand,
    },
  });
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

test("receive writes a bounded hashed file without the daemon", async () => {
  await withReleaseRoot(async (root) => {
    const body = Buffer.from('{"ok":true}\n', "utf8");
    const result = runGate(
      root,
      join(root, "missing.sock"),
      "mountain-release receive manifest.json",
      body,
    );
    assert.equal(result.status, 0, result.stderr);
    const digest = createHash("sha256").update(body).digest("hex");
    assert.match(
      result.stdout,
      new RegExp(
        `Received manifest.json sha256:${digest} bytes:${body.length}`,
      ),
    );
    const stored = await readFile(join(root, "incoming", "manifest.json"));
    assert.deepEqual(stored, body);
  });
});

test("receive rejects traversal, bad names, empty bodies and oversize uploads", async () => {
  await withReleaseRoot(async (root) => {
    const traversal = runGate(
      root,
      join(root, "missing.sock"),
      "mountain-release receive ../escape.json",
      Buffer.from("{}\n"),
    );
    assert.equal(traversal.status, 1);
    assert.match(traversal.stderr, /incoming directory/);

    const absolute = runGate(
      root,
      join(root, "missing.sock"),
      "mountain-release receive /tmp/x.json",
      Buffer.from("{}\n"),
    );
    assert.equal(absolute.status, 1);
    assert.match(absolute.stderr, /incoming directory|metacharacters/);

    const empty = runGate(
      root,
      join(root, "missing.sock"),
      "mountain-release receive manifest.json",
      Buffer.alloc(0),
    );
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /empty upload/);

    const previousRoot = process.env.MOUNTAIN_RELEASE_ROOT;
    process.env.MOUNTAIN_RELEASE_ROOT = root;
    try {
      await assert.rejects(
        () =>
          receiveIncomingFile({
            fileName: "manifest.json",
            stdin: Readable.from([Buffer.from("too-big")]),
            maxBytes: 4,
          }),
        /exceeds the input limit/,
      );
    } finally {
      if (previousRoot === undefined) {
        delete process.env.MOUNTAIN_RELEASE_ROOT;
      } else {
        process.env.MOUNTAIN_RELEASE_ROOT = previousRoot;
      }
    }
    assert.equal(
      await pathExists(join(root, "incoming", "manifest.json")),
      false,
    );
  });
});

test("receive then install through the gate activates the uploaded artifact", async () => {
  await withReleaseRoot(async (root) => {
    await withDaemon(root, async (socketPath) => {
      const files = [{ path: "index.html", content: "<html>home</html>" }];
      const sourceDirectory = await mkdtemp(
        join(tmpdir(), "mountain-receive-src-"),
      );
      const archiveName = `mountain-runners-${testCommit.slice(0, 12)}.tar.gz`;
      const archiveSource = join(sourceDirectory, archiveName);
      await writeFile(join(sourceDirectory, "index.html"), files[0].content);
      const packed = spawnSync(
        "tar",
        ["-czf", archiveSource, "-C", sourceDirectory, "index.html"],
        { encoding: "utf8" },
      );
      assert.equal(packed.status, 0, packed.stderr);
      const archiveBuffer = await readFile(archiveSource);
      const manifest = {
        schemaVersion: 1,
        commit: testCommit,
        origin: "https://mountainrunners.cat",
        buildToday: "2026-08-16",
        workflow: "Artifact",
        limits: {
          maxExpandedBytes: approvedLimits.maxExpandedBytes,
          maxFileCount: approvedLimits.maxFileCount,
        },
        totals: {
          fileCount: 1,
          expandedBytes: Buffer.byteLength(files[0].content),
        },
        files: [
          {
            path: "index.html",
            size: Buffer.byteLength(files[0].content),
            sha256: createHash("sha256").update(files[0].content).digest("hex"),
          },
        ],
      };
      const manifestBuffer = Buffer.from(`${JSON.stringify(manifest)}\n`);

      const receivedArchive = runGate(
        root,
        socketPath,
        `mountain-release receive ${archiveName}`,
        archiveBuffer,
      );
      assert.equal(receivedArchive.status, 0, receivedArchive.stderr);
      const receivedManifest = runGate(
        root,
        socketPath,
        "mountain-release receive manifest.json",
        manifestBuffer,
      );
      assert.equal(receivedManifest.status, 0, receivedManifest.stderr);

      const install = runGate(
        root,
        socketPath,
        `mountain-release install ${archiveName} manifest.json`,
      );
      assert.equal(install.status, 0, install.stderr);
      const activate = runGate(
        root,
        socketPath,
        `mountain-release activate ${testCommit}`,
      );
      assert.equal(activate.status, 0, activate.stderr);
      await rm(sourceDirectory, { recursive: true, force: true });
    });
  });
});

test("the daemon rejects a receive command sent over the socket", async () => {
  await withReleaseRoot(async (root) => {
    await withDaemon(root, async (socketPath) => {
      const response = JSON.parse(
        await requestDaemon(
          socketPath,
          JSON.stringify({ command: "receive", args: ["manifest.json"] }),
        ),
      );
      assert.equal(response.ok, false);
      assert.match(response.message, /Unknown command/);
    });
  });
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
