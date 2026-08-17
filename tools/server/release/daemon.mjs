#!/usr/bin/env node
// Mountain Runners release daemon (phase 5, task 5.3).
//
// A root-owned systemd service that performs the privileged release
// operations on behalf of the deploy SSH identity. The SSH gate tokenizes
// without a shell and sends the request over a Unix socket; the daemon
// validates the arguments, executes the operation and returns the result.
// This keeps the deploy identity free of any privileged filesystem access
// ("sense sudo").
//
// The daemon is the only writer of the release registry, the release trees
// and the `current` symlink; it listens on /run/mountain-release.sock (owned
// by the mountain-runners group, mode 0660) and processes one request at a
// time.

import { chmodSync, chownSync, lstatSync, unlinkSync } from "node:fs";
import { connect, createServer } from "node:net";
import {
  NoEligibleReleaseError,
  performActivate,
  performHealth,
  performInstall,
  performList,
  performRevoke,
  performRollback,
} from "./operations.mjs";
import { isAllowedCommand, validateArgs } from "./validate.mjs";

const socketPath =
  process.env.MOUNTAIN_RELEASE_DAEMON_SOCKET ?? "/run/mountain-release.sock";
const socketGid = Number.parseInt(
  process.env.MOUNTAIN_RELEASE_DAEMON_GID ?? "0",
  10,
);
const maxRequestBytes = 4 * 1024;

async function prepareSocketPath() {
  try {
    const stats = lstatSync(socketPath);
    if (!stats.isSocket()) {
      // Leftover file from a previous run: root owns /run, so this is safe.
      unlinkSync(socketPath);
      return;
    }
    if (!(await isSocketLive(socketPath))) {
      // Stale socket left behind by a crashed daemon: safe to reclaim.
      unlinkSync(socketPath);
      return;
    }
    throw new Error(
      `A live socket already exists at ${socketPath}; is another daemon running?`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function isSocketLive(path) {
  return new Promise((resolveLive) => {
    const socket = connect(path);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolveLive(false);
    }, 500);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolveLive(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolveLive(false);
    });
  });
}

async function serve() {
  await prepareSocketPath();

  const server = createServer((socket) => {
    let received = "";
    let handled = false;
    socket.setTimeout(30_000, () => {
      if (!handled) {
        socket.destroy();
      }
    });
    socket.on("data", (chunk) => {
      if (handled) {
        return;
      }
      received += chunk.toString("utf8");
      if (received.length > maxRequestBytes) {
        handled = true;
        socket.setTimeout(0);
        socket.end('{"ok":false,"message":"Request too large."}\n');
        socket.destroy();
        return;
      }
      const newlineIndex = received.indexOf("\n");
      if (newlineIndex !== -1) {
        handled = true;
        // The request is complete: keep the socket open while the operation
        // runs (install can take longer than the idle timeout).
        socket.setTimeout(0);
        const requestLine = received.slice(0, newlineIndex).trim();
        void handleRequest(requestLine).then((response) => {
          socket.end(`${JSON.stringify(response)}\n`);
        });
      }
    });
    socket.on("error", () => {});
  });
  // Bounded parallelism: a stalled client cannot starve legitimate requests.
  server.maxConnections = 8;

  server.listen(socketPath, () => {
    // The socket is only group-readable/writable by the deploy identity; the
    // chown (root only) applies the group id resolved by the bootstrap.
    chmodSync(socketPath, 0o660);
    if (process.getuid() === 0 && socketGid > 0) {
      chownSync(socketPath, 0, socketGid);
    }
    console.log(`Release daemon listening on ${socketPath}.`);
  });
}

async function handleRequest(requestLine) {
  let request;
  try {
    request = JSON.parse(requestLine);
  } catch (error) {
    return { ok: false, message: `Invalid request JSON: ${error.message}` };
  }

  const { command, args } = request;
  if (typeof command !== "string" || !isAllowedCommand(command)) {
    return { ok: false, message: `Unknown command: ${command}.` };
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return { ok: false, message: "The args must be an array of strings." };
  }

  let validated;
  try {
    validated = validateArgs(command, args);
  } catch (error) {
    return { ok: false, message: error.message };
  }

  try {
    const message = await runOperation(validated);
    // A degraded health state is a failed check for the caller (exit 1), so
    // the gate maps it the same way the human CLI does.
    const degradedHealth =
      command === "health" && message.startsWith("Health: DEGRADED");
    return { ok: !degradedHealth, message };
  } catch (error) {
    return {
      ok: false,
      message: error.message,
      noEligible: error instanceof NoEligibleReleaseError,
    };
  }
}

async function runOperation(validated) {
  const [command, ...args] = validated;
  if (command === "install") {
    return performInstall(args[0], args[1]);
  }
  if (command === "activate") {
    return performActivate(args[0]);
  }
  if (command === "rollback") {
    return performRollback(args[0]);
  }
  if (command === "revoke") {
    return performRevoke(args[0], args[1]);
  }
  if (command === "list") {
    return performList();
  }
  return performHealth();
}

serve().catch((error) => {
  console.error(`Release daemon failed to start: ${error.message}`);
  process.exitCode = 1;
});
