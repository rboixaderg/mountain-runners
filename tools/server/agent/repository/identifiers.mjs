// Opaque identifiers for public names and for the worktree the sandbox mounts.
//
// A Telegram update identifier and a session key (chat plus topic) are private.
// They never reach a branch, a worktree directory name, a container label or an
// environment variable of the sandbox. The private trace keeps the real keys.
//
// Both names come from one HMAC-SHA256 keyed by a per-installation salt stored
// in the private state directory: the salt is never in the repository, a log,
// the trace or the environment of Pi. A different salt produces different
// names, so the mapping cannot be reproduced without it.

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const identifierSaltFileName = "identifier-salt";

const saltBytes = 32;
const saltPattern = /^[0-9a-f]{64}$/u;
// `topic-` plus 8 bytes of the digest: long enough to never collide in practice
// and short enough to stay a readable directory name.
const worktreeNameLength = 16;
// The public branch suffix keeps a branch name short and greppable.
const changeSuffixLength = 8;

export function identifierSaltPath(stateDirectory) {
  return join(stateDirectory, identifierSaltFileName);
}

/** Read the installation salt without ever creating it. */
export function readIdentifierSalt(stateDirectory) {
  const saltPath = identifierSaltPath(stateDirectory);
  if (!existsSync(saltPath)) {
    throw new Error(`The identifier salt ${saltPath} is missing.`);
  }
  return checkedSalt(saltPath);
}

/** Read the salt, creating it once with mode 0600 when it does not exist yet. */
export function readOrCreateIdentifierSalt(stateDirectory) {
  const saltPath = identifierSaltPath(stateDirectory);
  if (!existsSync(saltPath)) {
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(saltPath, `${randomBytes(saltBytes).toString("hex")}\n`, {
        mode: 0o600,
        flag: "wx",
      });
    } catch (error) {
      // Another process created it first: its value is the installation salt.
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
  return checkedSalt(saltPath);
}

function checkedSalt(saltPath) {
  const salt = readFileSync(saltPath, "utf8").trim();
  if (!saltPattern.test(salt)) {
    throw new Error(`The identifier salt ${saltPath} is invalid.`);
  }
  return salt;
}

function digest(salt, value) {
  return createHmac("sha256", Buffer.from(salt, "hex"))
    .update(value, "utf8")
    .digest("hex");
}

/**
 * The naming helpers of one installation. Every place that needs the name of a
 * topic worktree or of a public branch asks here, so a single salt and a single derivation rule produce them all.
 */
export function createIdentifierNames({ salt }) {
  if (!saltPattern.test(salt ?? "")) {
    throw new Error("A 32-byte hexadecimal identifier salt is required.");
  }

  /** The directory name of the worktree of a topic. */
  function worktreeName(sessionKey) {
    if (typeof sessionKey !== "string" || sessionKey === "") {
      throw new Error("A session key is required.");
    }
    return `topic-${digest(salt, sessionKey).slice(0, worktreeNameLength)}`;
  }

  /** The public suffix that identifies a change without exposing its update. */
  function changeSuffix(updateIdentifier) {
    if (!Number.isSafeInteger(updateIdentifier) || updateIdentifier < 0) {
      throw new Error("A change requires a valid update identifier.");
    }
    return digest(salt, String(updateIdentifier)).slice(0, changeSuffixLength);
  }

  return { worktreeName, changeSuffix };
}

/** The naming helpers of the installation that owns `stateDirectory`. */
export function openIdentifierNames(stateDirectory) {
  return createIdentifierNames({
    salt: readOrCreateIdentifierSalt(stateDirectory),
  });
}
