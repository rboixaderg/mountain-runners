import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { updatePreviewSite } from "./processes/mountain-preview-site/caddy.mjs";
import {
  parsePreviewSites,
  renderPreviewSites,
} from "./processes/mountain-preview-site/caddy-fragment.mjs";

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
      ["caddy", "systemctl", "curl", "caddy", "systemctl", "curl", "curl"],
    );
    assert.equal(
      commands.at(-1)[1].at(-1),
      "https://pr-42.preview.mountainrunners.cat/ca/",
    );
    assert.match(commands[0][1][2], /Caddyfile\.\d+\.candidate/u);
    await updatePreviewSite(42, true, { directory, run });
    assert.equal(commands.length, 7);
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

test("an existing preview failing after restart restores the previous fragment", async () => {
  await withCaddyFiles(async (directory) => {
    const fragment = join(directory, "Caddyfile.previews");
    await writeFile(fragment, `${renderPreviewSites([5])}\n`);
    let restarts = 0;
    await assert.rejects(
      updatePreviewSite(6, true, {
        directory,
        run: async (executable, args) => {
          if (executable === "systemctl") restarts += 1;
          if (executable === "curl" && args.at(-1).includes("pr-5")) {
            throw new Error("existing preview unavailable");
          }
        },
      }),
      /existing preview unavailable/,
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

test("the preview sites never allow the analytics origin", () => {
  const policy = renderPreviewSites([1]).match(
    /header Content-Security-Policy "([^"]+)"/u,
  )?.[1];
  assert.ok(policy, "the preview fragment must set a Content-Security-Policy");
  assert.match(policy, /script-src 'self';/u);
  assert.match(policy, /connect-src 'self';/u);
  assert.doesNotMatch(policy, /analytics\.rogerbg\.cat/u);
});

test("the socket accepts site-reconcile and rejects the retired sync request", async () => {
  await withCaddyFiles(async (directory) => {
    const socketPath = join(directory, "site.sock");
    const daemon = spawn(
      process.execPath,
      [join(toolDirectory, "processes/mountain-preview-site/main.mjs")],
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
        [
          join(toolDirectory, "commands/mountain-preview/cli.mjs"),
          "site-reconcile",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, MOUNTAIN_PREVIEW_SITE_SOCKET: socketPath },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reconciled preview Caddy sites/);
      const legacyResponse = await new Promise((resolve, reject) => {
        let response = "";
        const socket = connect(socketPath, () =>
          socket.write(`${JSON.stringify({ command: "sync" })}\n`),
        );
        socket.on("data", (chunk) => (response += chunk.toString("utf8")));
        socket.on("end", () => resolve(JSON.parse(response)));
        socket.on("error", reject);
      });
      assert.equal(legacyResponse.ok, false);
      assert.match(legacyResponse.message, /or reconcile are allowed/);
    } finally {
      if (daemon.exitCode === null) {
        daemon.kill();
        await new Promise((resolve) => daemon.once("exit", resolve));
      }
    }
  });
});
