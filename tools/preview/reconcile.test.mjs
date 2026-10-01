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
    "mountain-preview cleanup-retired",
    "mountain-preview site-reconcile",
    "mountain-preview inventory",
    "mountain-preview retire 1",
    "mountain-preview site-disable 1",
    "mountain-preview retire 2",
    "mountain-preview site-disable 2",
    "mountain-preview retire 3",
    "mountain-preview site-disable 3",
    "mountain-preview prune 4",
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
    "mountain-preview cleanup-retired",
    "mountain-preview site-reconcile",
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
    "mountain-preview cleanup-retired",
    "mountain-preview site-reconcile",
    "mountain-preview inventory",
  ]);
});

test("a failed GitHub lookup does not block retirement of another preview", async () => {
  const transport = transportFor([
    { pullNumber: 1, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
    { pullNumber: 2, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
  ]);
  await assert.rejects(
    reconcilePreviews({
      transport,
      repository,
      now,
      readPull: async (number) => {
        if (number === 1) throw new Error("GitHub unavailable");
        return { state: "closed" };
      },
    }),
    /Preview 1: GitHub unavailable/,
  );
  assert.deepEqual(transport.commands, [
    "mountain-preview cleanup-retired",
    "mountain-preview site-reconcile",
    "mountain-preview inventory",
    "mountain-preview retire 2",
    "mountain-preview site-disable 2",
  ]);
});

test("a failed prune does not block revocation of another preview", async () => {
  const transport = transportFor([
    { pullNumber: 1, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
    { pullNumber: 2, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
  ]);
  const originalRun = transport.run;
  transport.run = async (command) => {
    if (command === "mountain-preview prune 1") {
      transport.commands.push(command);
      throw new Error("Health: DEGRADED");
    }
    return originalRun(command);
  };
  await assert.rejects(
    reconcilePreviews({
      transport,
      repository,
      now,
      readPull: async (number) => ({
        state: "open",
        labels: number === 2 ? [{ name: "preview-revoked" }] : [],
        head: { sha: commit, repo: { full_name: repository } },
      }),
    }),
    /Preview 1: Health: DEGRADED/,
  );
  assert.deepEqual(transport.commands.slice(-3), [
    "mountain-preview prune 1",
    "mountain-preview retire 2",
    "mountain-preview site-disable 2",
  ]);
});

test("one inconsistent namespace does not prevent retiring other previews", async () => {
  const transport = transportFor([
    { pullNumber: 1, inconsistent: true },
    { pullNumber: 2, commit, updatedAt: "2026-09-27T11:00:00.000Z" },
  ]);
  await assert.rejects(
    reconcilePreviews({
      transport,
      repository,
      now,
      readPull: async () => ({ state: "closed" }),
    }),
    /Inconsistent active previews were retired: 1/,
  );
  assert.deepEqual(transport.commands.slice(-4), [
    "mountain-preview retire 1",
    "mountain-preview site-disable 1",
    "mountain-preview retire 2",
    "mountain-preview site-disable 2",
  ]);
});
