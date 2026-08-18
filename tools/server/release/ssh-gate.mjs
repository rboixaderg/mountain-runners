#!/usr/bin/env node
// SSH forced-command gate for the deploy identity (phase 5, tasks 5.3 and 5.4).
//
// The deploy SSH key is installed with `command="/usr/local/bin/mountain-ssh-gate"`
// in authorized_keys, so the holder can only reach the release daemon through
// this gate, except for `receive`, which writes stdin into incoming/ because
// `restrict` disables scp/sftp. The gate tokenizes SSH_ORIGINAL_COMMAND without
// a shell, rejects any token containing shell metacharacters and forwards
// other requests to the daemon socket. The daemon (root) validates every
// argument and executes the operation.

import { connect } from "node:net";
import { formatReceiveMessage, receiveIncomingFile } from "./receive.mjs";

const socketPath =
  process.env.MOUNTAIN_RELEASE_DAEMON_SOCKET ?? "/run/mountain-release.sock";
const unsafeTokenPattern = /[\s"'`$\\;|&<>()]/u;

function tokenize(originalCommand) {
  if (originalCommand === undefined || originalCommand === "") {
    throw new Error("No command was provided over SSH.");
  }
  const tokens = originalCommand.trim().split(/\s+/u);
  for (const token of tokens) {
    if (unsafeTokenPattern.test(token)) {
      throw new Error(
        `Rejected token with shell metacharacters: ${JSON.stringify(token)}.`,
      );
    }
  }
  return tokens;
}

async function main() {
  const tokens = tokenize(process.env.SSH_ORIGINAL_COMMAND);
  const [toolName, ...args] = tokens;
  if (toolName !== "mountain-release" && toolName !== "release") {
    throw new Error(
      `Only the release tool can run over the deploy identity; got ${JSON.stringify(toolName)}.`,
    );
  }
  const [command, ...commandArgs] = args;
  if (command === "receive") {
    if (commandArgs.length !== 1 || commandArgs[0] === undefined) {
      throw new Error("receive requires exactly one incoming file name.");
    }
    const result = await receiveIncomingFile({
      fileName: commandArgs[0],
      stdin: process.stdin,
    });
    console.log(formatReceiveMessage(result));
    return;
  }
  await request(args);
}

function request(args) {
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = connect(socketPath);
    let response = "";
    let finished = false;

    const finish = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      if (error !== undefined) {
        rejectRequest(error);
        return;
      }
      try {
        const parsed = JSON.parse(response);
        if (parsed.message !== undefined) {
          console.log(parsed.message);
        }
        process.exitCode =
          parsed.ok === true ? 0 : parsed.noEligible === true ? 3 : 1;
        resolveRequest();
      } catch {
        rejectRequest(new Error("the daemon returned an invalid response."));
      }
    };

    socket.setTimeout(60_000, () => {
      socket.destroy(new Error("Timed out waiting for the release daemon."));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish(undefined));
    socket.write(
      `${JSON.stringify({ command: args[0], args: args.slice(1) })}\n`,
    );
  });
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
