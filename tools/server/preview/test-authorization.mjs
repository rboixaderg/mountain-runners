import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { connect } from "node:net";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export async function withPreviewAuthorization(
  root,
  run,
  keys = generateKeyPairSync("ed25519"),
) {
  const socketPath = join(root, "site.sock");
  const publicKeyPath = join(root, "auth.pub");
  await writeFile(
    publicKeyPath,
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  const env = {
    ...process.env,
    MOUNTAIN_PREVIEW_ROOT: root,
    MOUNTAIN_PREVIEW_SITE_SOCKET: socketPath,
    MOUNTAIN_PREVIEW_AUTH_PUBLIC_KEY: publicKeyPath,
  };
  const daemon = spawn(
    process.execPath,
    [join(import.meta.dirname, "site-daemon.mjs")],
    {
      env,
      stdio: "ignore",
    },
  );
  try {
    let connected = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      connected = await new Promise((resolve) => {
        const socket = connect(socketPath);
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      });
      if (connected) break;
      await sleep(20);
    }
    if (!connected) throw new Error("Preview site daemon did not start.");
    return await run({ env, privateKey: keys.privateKey });
  } finally {
    if (daemon.exitCode === null) {
      daemon.kill();
      await new Promise((resolve) => daemon.once("exit", resolve));
    }
  }
}
