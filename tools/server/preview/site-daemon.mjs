#!/usr/bin/env node
// Privileged, bounded broker: preview-deploy can request only numeric hosts.
import { execFile } from "node:child_process";
import { chmodSync, chownSync, lstatSync, unlinkSync } from "node:fs";
import { readFile, readlink } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { previewNamespacePaths, previewOrigin } from "./config.mjs";
import { verifyPreviewAuthorization } from "./authorization-proof.mjs";
import { parsePreviewSites } from "./site-config.mjs";
import { updatePreviewSite } from "./site-manager.mjs";

const socketPath =
  process.env.MOUNTAIN_PREVIEW_SITE_SOCKET ?? "/run/mountain-preview-site.sock";
const socketGid = Number(process.env.MOUNTAIN_PREVIEW_SITE_GID ?? 0);
const previewUid = Number(
  process.env.MOUNTAIN_PREVIEW_SITE_UID ?? process.getuid(),
);
const exec = promisify(execFile);
const fragmentPath = process.env.MOUNTAIN_PREVIEW_CADDY_DIRECTORY
  ? join(process.env.MOUNTAIN_PREVIEW_CADDY_DIRECTORY, "Caddyfile.previews")
  : "/etc/caddy/Caddyfile.previews";
const options = process.env.MOUNTAIN_PREVIEW_CADDY_DIRECTORY
  ? { directory: process.env.MOUNTAIN_PREVIEW_CADDY_DIRECTORY }
  : {};

async function eligible(pullNumber) {
  const paths = previewNamespacePaths(pullNumber);
  const registry = JSON.parse(await readFile(paths.registryFile, "utf8"));
  if (
    !registry.releases?.some(
      (release) =>
        ["eligible", "active"].includes(release.status) &&
        release.origin === previewOrigin(pullNumber) &&
        release.pullRequestNumber === pullNumber &&
        release.authorizedBy &&
        Date.parse(release.expiresAt) > Date.now(),
    )
  ) {
    throw new Error("No verified release belongs to this preview origin.");
  }
}

async function update(request) {
  if (request.command === "authorize") {
    const { pullRequestNumber, commit, actor, issuedAt, signature } = request;
    const publicKey = await readFile(
      process.env.MOUNTAIN_PREVIEW_AUTH_PUBLIC_KEY ??
        "/etc/mountain-runners/preview-auth.pub",
      "utf8",
    );
    verifyPreviewAuthorization(
      { pullRequestNumber, commit, actor, issuedAt },
      signature,
      publicKey,
    );
    if (previewUid === 0)
      throw new Error(
        "Preview authorization requires the unprivileged preview UID.",
      );
    const { stdout } = await exec(
      process.execPath,
      [
        fileURLToPath(new URL("./authorize.mjs", import.meta.url)),
        commit,
        actor,
        String(pullRequestNumber),
      ],
      {
        uid: previewUid,
        gid: socketGid || process.getgid(),
        env: {
          ...process.env,
          MOUNTAIN_RELEASE_ROOT: previewNamespacePaths(pullRequestNumber).root,
        },
      },
    );
    return stdout.trim();
  }
  if (request.command === "sync") {
    const sites = parsePreviewSites(await readFile(fragmentPath, "utf8"));
    for (const number of sites) {
      try {
        await readlink(previewNamespacePaths(number).currentLink);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await updatePreviewSite(number, false, options);
      }
    }
    return "Reconciled preview Caddy sites.";
  }
  const number = request.pullRequestNumber;
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    (request.command !== "enable" && request.command !== "disable")
  ) {
    throw new Error(
      "Only enable/disable with a numeric PR or sync are allowed.",
    );
  }
  if (request.command === "enable") await eligible(number);
  await updatePreviewSite(number, request.command === "enable", options);
  return `${request.command} preview site ${number}.`;
}

async function main() {
  try {
    if (lstatSync(socketPath).isSocket()) {
      await new Promise((resolve, reject) => {
        const socket = connect(socketPath);
        socket.on("connect", () =>
          reject(new Error("Preview site daemon already running.")),
        );
        socket.on("error", resolve);
      });
    }
    unlinkSync(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let pending = Promise.resolve();
  const server = createServer((socket) => {
    let input = "";
    socket.setTimeout(65_000, () => socket.destroy());
    socket.on("data", (chunk) => {
      input += chunk.toString("utf8");
      if (input.length > 1024) socket.destroy();
      if (!input.includes("\n")) return;
      const line = input.slice(0, input.indexOf("\n"));
      socket.removeAllListeners("data");
      pending = pending
        .catch(() => {})
        .then(async () => {
          try {
            const message = await update(JSON.parse(line));
            socket.end(`${JSON.stringify({ ok: true, message })}\n`);
          } catch (error) {
            socket.end(
              `${JSON.stringify({ ok: false, message: error.message })}\n`,
            );
          }
        });
    });
  });
  server.maxConnections = 8;
  server.listen(socketPath, () => {
    chmodSync(socketPath, 0o660);
    if (process.getuid() === 0 && socketGid > 0)
      chownSync(socketPath, 0, socketGid);
  });
}

main().catch((error) => {
  console.error(`Preview site daemon failed: ${error.message}`);
  process.exitCode = 1;
});
