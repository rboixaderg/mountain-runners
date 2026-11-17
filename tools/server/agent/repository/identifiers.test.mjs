import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdentifierNames,
  identifierSaltPath,
  openIdentifierNames,
  parseLegacyWorktreeName,
  readOrCreateIdentifierSalt,
} from "./identifiers.mjs";

const salt = "a".repeat(64);
const otherSalt = "b".repeat(64);
const sessionKey = "-1001234567890:7";

function stateFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-identifiers-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  return join(directory, "state");
}

test("derives an opaque worktree name that never contains the chat or the topic", () => {
  const identifiers = createIdentifierNames({ salt });
  const name = identifiers.worktreeName(sessionKey);

  assert.match(name, /^topic-[0-9a-f]{16}$/u);
  assert.equal(name.includes("1001234567890"), false);
  assert.equal(name.includes(":7"), false);
  assert.equal(identifiers.worktreeName(sessionKey), name);
});

test("derives a stable opaque branch suffix that changes with the salt", () => {
  const identifiers = createIdentifierNames({ salt });
  const otherInstallation = createIdentifierNames({ salt: otherSalt });
  const suffix = identifiers.changeSuffix(1001);

  assert.match(suffix, /^[0-9a-f]{8}$/u);
  assert.equal(identifiers.changeSuffix(1001), suffix);
  assert.notEqual(identifiers.changeSuffix(1002), suffix);
  assert.notEqual(otherInstallation.changeSuffix(1001), suffix);
  assert.notEqual(
    otherInstallation.worktreeName(sessionKey),
    identifiers.worktreeName(sessionKey),
  );
});

test("names an archive with an opaque suffix instead of the update identifier", () => {
  const identifiers = createIdentifierNames({ salt });
  const archive = identifiers.archiveName(
    identifiers.worktreeName(sessionKey),
    1001,
  );

  assert.match(archive, /^topic-[0-9a-f]{16}-before-[0-9a-f]{8}$/u);
  assert.equal(archive.includes("1001"), false);
});

test("rejects an invalid salt and an invalid update identifier", () => {
  assert.throws(
    () => createIdentifierNames({ salt: "synthetic" }),
    /hexadecimal identifier salt/u,
  );
  assert.throws(
    () => createIdentifierNames({ salt }).worktreeName(""),
    /session key is required/u,
  );
  assert.throws(
    () => createIdentifierNames({ salt }).changeSuffix(-1),
    /valid update identifier/u,
  );
});

test("creates the salt once in the private state directory", (context) => {
  const stateDirectory = stateFixture(context);
  const first = readOrCreateIdentifierSalt(stateDirectory);

  assert.match(first, /^[0-9a-f]{64}$/u);
  const saltPath = identifierSaltPath(stateDirectory);
  assert.equal((statSync(saltPath).mode & 0o777).toString(8), "600");
  assert.equal(readFileSync(saltPath, "utf8").trim(), first);
  assert.equal(
    readOrCreateIdentifierSalt(stateDirectory),
    first,
    "a second start reads the salt it already has",
  );
  assert.equal(
    openIdentifierNames(stateDirectory).worktreeName(sessionKey),
    createIdentifierNames({ salt: first }).worktreeName(sessionKey),
  );
});

test("reads back the private key a pre-migration worktree name encodes", () => {
  assert.deepEqual(parseLegacyWorktreeName("topic_n1001234567890_7"), {
    sessionKey,
    updateIdentifier: null,
  });
  assert.deepEqual(
    parseLegacyWorktreeName("topic_n1001234567890_7-before-1001"),
    { sessionKey, updateIdentifier: 1001 },
  );
  assert.equal(parseLegacyWorktreeName("topic-0123456789abcdef"), null);
  assert.equal(parseLegacyWorktreeName("synthetic"), null);
});
