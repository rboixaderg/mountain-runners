// Argument validation shared by the SSH gate and the release daemon
// (phase 5, task 5.3). The gate validates before sending; the daemon validates
// again before executing, so a compromised gate cannot bypass the rules.

import { resolve } from "node:path";
import { releasePaths } from "./config.mjs";

export const commitPattern = /^[0-9a-f]{40}$/u;
export const reasonPattern = /^[\p{L}\p{N} ,._:/-]{1,200}$/u;

const allowedCommands = new Set([
  "install",
  "activate",
  "rollback",
  "revoke",
  "list",
  "health",
]);

export function isAllowedCommand(command) {
  return allowedCommands.has(command);
}

// Returns the validated argument list for the CLI, or throws on any deviation.
export function validateArgs(command, tokens) {
  if (command === "install") {
    const [archiveArg, manifestArg] = tokens;
    if (
      tokens.length !== 2 ||
      archiveArg === undefined ||
      manifestArg === undefined
    ) {
      throw new Error(
        "install requires exactly an archive and a manifest path.",
      );
    }
    return ["install", incomingPath(archiveArg), incomingPath(manifestArg)];
  }

  if (command === "activate" || command === "rollback") {
    if (tokens.length > 1) {
      throw new Error(`${command} takes at most one commit argument.`);
    }
    const [commit] = tokens;
    if (command === "activate" && commit === undefined) {
      throw new Error("activate requires a commit.");
    }
    if (commit !== undefined && !commitPattern.test(commit)) {
      throw new Error("The commit must be a 40-character hex SHA-1.");
    }
    return [command, ...(commit === undefined ? [] : [commit])];
  }

  if (command === "revoke") {
    const [commit, reasonFlag, ...reasonTokens] = tokens;
    const reason =
      reasonFlag === "--reason" ? reasonTokens.join(" ") : undefined;
    if (commit === undefined || !commitPattern.test(commit)) {
      throw new Error("revoke requires a valid commit.");
    }
    if (reason === undefined || !reasonPattern.test(reason)) {
      throw new Error(
        "revoke requires --reason with letters, digits and basic punctuation (max 200 characters).",
      );
    }
    return ["revoke", commit, "--reason", reason];
  }

  if (command === "list" || command === "health") {
    if (tokens.length > 0) {
      throw new Error(`${command} takes no arguments.`);
    }
    return [command];
  }

  throw new Error(`Unknown command: ${command}.`);
}

export function incomingPath(argument) {
  const { incomingDirectory } = releasePaths();
  const resolved = resolve(incomingDirectory, argument);
  const incomingPrefix = `${resolve(incomingDirectory)}${"/"}`;
  if (argument.startsWith("/") || !resolved.startsWith(incomingPrefix)) {
    throw new Error(
      `The upload path must live inside the incoming directory: ${argument}.`,
    );
  }
  return resolved;
}
