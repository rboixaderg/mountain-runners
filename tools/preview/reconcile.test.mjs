import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePreviews } from "./reconcile.mjs";

const repository = "rboixaderg/mountain-runners";
const now = Date.parse("2026-09-27T12:00:00.000Z");
const commit = "a".repeat(40);

function transportFor(entries) {
  const commands = [];
  return {
    commands,
    async run(command) {
      commands.push(command);
      return command === "mountain-preview inventory"
        ? JSON.stringify(entries)
        : "Retired.";
    },
  };
}

test("retires expired, closed and stale-head previews but keeps open current heads", async () => {
  const transport = transportFor([
    { pullNumber: 1, commit, updatedAt: "2026-09-12T00:00:00.000Z" },
    { pullNumber: 2, commit, updatedAt: "2026-09-27T00:00:00.000Z" },
    { pullNumber: 3, commit, updatedAt: "2026-09-27T00:00:00.000Z" },
    { pullNumber: 4, commit, updatedAt: "2026-09-27T00:00:00.000Z" },
  ]);
  await reconcilePreviews({
    transport,
    repository,
    now,
    readPull: async (number) => ({
      state: number === 2 ? "closed" : "open",
      head: {
        sha: number === 3 ? "b".repeat(40) : commit,
        repo: { full_name: repository },
      },
    }),
  });
  assert.deepEqual(transport.commands, [
    "mountain-preview site-sync",
    "mountain-preview inventory",
    "mountain-preview retire 1",
    "mountain-preview site-disable 1",
    "mountain-preview retire 2",
    "mountain-preview site-disable 2",
    "mountain-preview retire 3",
    "mountain-preview site-disable 3",
  ]);
});

test("retires canceled uploads after one day and fork heads immediately", async () => {
  const transport = transportFor([
    { pullNumber: 1, updatedAt: "2026-09-26T11:00:00.000Z" },
    { pullNumber: 2, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
  ]);
  await reconcilePreviews({
    transport,
    repository,
    now,
    readPull: async () => ({
      state: "open",
      head: { sha: commit, repo: { full_name: "fork/repo" } },
    }),
  });
  assert.deepEqual(transport.commands, [
    "mountain-preview site-sync",
    "mountain-preview inventory",
    "mountain-preview retire 1",
    "mountain-preview site-disable 1",
    "mountain-preview retire 2",
    "mountain-preview site-disable 2",
  ]);
});

test("a maintainer revocation label retires an open preview", async () => {
  const transport = transportFor([
    { pullNumber: 7, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
  ]);
  await reconcilePreviews({
    transport,
    repository,
    now,
    readPull: async () => ({
      state: "open",
      labels: [{ name: "preview-revoked" }],
      head: { sha: commit, repo: { full_name: repository } },
    }),
  });
  assert.deepEqual(transport.commands.slice(-2), [
    "mountain-preview retire 7",
    "mountain-preview site-disable 7",
  ]);
});

test("an API failure never retires a fresh preview", async () => {
  const transport = transportFor([
    { pullNumber: 1, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
  ]);
  await assert.rejects(
    reconcilePreviews({
      transport,
      repository,
      now,
      readPull: async () => {
        throw new Error("GitHub unavailable");
      },
    }),
    /GitHub unavailable/,
  );
  assert.deepEqual(transport.commands, [
    "mountain-preview site-sync",
    "mountain-preview inventory",
  ]);
});
