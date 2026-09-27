import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { updatePreviewSite } from "./site-manager.mjs";
import { parsePreviewSites, renderPreviewSites } from "./site-config.mjs";

const toolDirectory = fileURLToPath(new URL(".", import.meta.url));

async function withCaddyFiles(run) {
  const directory = await mkdtemp(join(tmpdir(), "preview-caddy-"));
  await writeFile(join(directory, "Caddyfile"), "import Caddyfile.previews\n");
  await writeFile(join(directory, "Caddyfile.previews"), "\n");
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("configures only numeric preview origins, validates before restart and is idempotent", async () => {
  await withCaddyFiles(async (directory) => {
    const commands = [];
    const run = async (executable, args) => commands.push([executable, args]);
    await updatePreviewSite(42, true, { directory, run });
    assert.deepEqual(
      parsePreviewSites(
        await readFile(join(directory, "Caddyfile.previews"), "utf8"),
      ),
      [42],
    );
    await updatePreviewSite(7, true, { directory, run });
    assert.deepEqual(
      parsePreviewSites(
        await readFile(join(directory, "Caddyfile.previews"), "utf8"),
      ),
      [7, 42],
    );
    assert.deepEqual(
      commands.map(([executable]) => executable),
      ["caddy", "systemctl", "curl", "caddy", "systemctl", "curl"],
    );
    assert.match(commands[0][1][2], /Caddyfile\.\d+\.candidate/u);
    await updatePreviewSite(42, true, { directory, run });
    assert.equal(commands.length, 6);
    await updatePreviewSite(42, false, { directory, run });
    assert.deepEqual(
      parsePreviewSites(
        await readFile(join(directory, "Caddyfile.previews"), "utf8"),
      ),
      [7],
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      "Caddyfile",
      "Caddyfile.previews",
    ]);
  });
});

test("validation failure leaves the existing Caddy fragment untouched", async () => {
  await withCaddyFiles(async (directory) => {
    const fragment = join(directory, "Caddyfile.previews");
    await writeFile(fragment, `${renderPreviewSites([5])}\n`);
    await assert.rejects(
      updatePreviewSite(6, true, {
        directory,
        run: async () => {
          throw new Error("validation failed");
        },
      }),
      /validation failed/,
    );
    assert.deepEqual(parsePreviewSites(await readFile(fragment, "utf8")), [5]);
  });
});

test("a failed Caddy restart restores the previous preview fragment", async () => {
  await withCaddyFiles(async (directory) => {
    const fragment = join(directory, "Caddyfile.previews");
    await writeFile(fragment, `${renderPreviewSites([5])}\n`);
    let restarts = 0;
    await assert.rejects(
      updatePreviewSite(6, true, {
        directory,
        run: async (executable) => {
          if (executable === "systemctl" && ++restarts === 1) {
            throw new Error("restart failed");
          }
        },
      }),
      /restart failed/,
    );
    assert.equal(restarts, 2);
    assert.deepEqual(parsePreviewSites(await readFile(fragment, "utf8")), [5]);
  });
});

test("rejects hand-edited fragments and a sixth configured site", async () => {
  await withCaddyFiles(async (directory) => {
    const fragment = join(directory, "Caddyfile.previews");
    await writeFile(fragment, `${renderPreviewSites([1, 2, 3, 4, 5])}\n`);
    await assert.rejects(
      updatePreviewSite(6, true, { directory }),
      /limit of 5/,
    );
    await writeFile(
      fragment,
      "https://production.example { respond hacked }\n",
    );
    await assert.rejects(
      updatePreviewSite(1, true, { directory }),
      /trusted template/,
    );
  });
});

test("the gate reaches the restricted site daemon through its own socket", async () => {
  await withCaddyFiles(async (directory) => {
    const socketPath = join(directory, "site.sock");
    const daemon = spawn(
      process.execPath,
      [join(toolDirectory, "site-daemon.mjs")],
      {
        env: {
          ...process.env,
          MOUNTAIN_PREVIEW_SITE_SOCKET: socketPath,
          MOUNTAIN_PREVIEW_CADDY_DIRECTORY: directory,
        },
        stdio: "ignore",
      },
    );
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const live = await new Promise((resolve) => {
          const socket = connect(socketPath);
          socket.once("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.once("error", () => resolve(false));
        });
        if (live) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const result = spawnSync(
        process.execPath,
        [join(toolDirectory, "gate.mjs"), "site-sync"],
        {
          encoding: "utf8",
          env: { ...process.env, MOUNTAIN_PREVIEW_SITE_SOCKET: socketPath },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reconciled preview Caddy sites/);
    } finally {
      if (daemon.exitCode === null) {
        daemon.kill();
        await new Promise((resolve) => daemon.once("exit", resolve));
      }
    }
  });
});
