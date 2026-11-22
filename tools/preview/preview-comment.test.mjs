import assert from "node:assert/strict";
import test from "node:test";
import { confirmedPreviewOrigin } from "../server/agent/repository/preview-comment.mjs";
import { markPreviewRetired } from "./preview-comment.mjs";

const marker = "<!-- mountain-runners-preview -->";
const base = "https://api.github.com/repos/rboixaderg/mountain-runners";
const publishedBody = `${marker}\nPreview publicada: https://pr-5.preview.mountainrunners.cat\nCommit: \`${"a".repeat(40)}\`.`;

function fakeFetch(comments) {
  const writes = [];
  async function fetchImpl(url, options) {
    if (options.method) {
      writes.push({ url, ...options });
      return { ok: true };
    }
    return { ok: true, json: async () => comments };
  }
  return { fetchImpl, writes };
}

async function retire(comments) {
  const { fetchImpl, writes } = fakeFetch(comments);
  await markPreviewRetired({ base, headers: {}, pullNumber: 5, fetchImpl });
  return writes;
}

test("retiring edits the bot comment to a body no confirmation can read", async () => {
  const writes = await retire([
    { id: 3, user: { login: "github-actions[bot]" }, body: publishedBody },
  ]);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PATCH");
  assert.match(writes[0].url, /\/issues\/comments\/3$/u);
  const { body } = JSON.parse(writes[0].body);
  assert.equal(body, `${marker}\nPreview retirada.`);
  assert.equal(
    confirmedPreviewOrigin({
      comments: [{ user: { login: "github-actions[bot]" }, body }],
      pullRequestNumber: 5,
      commit: "a".repeat(40),
    }),
    null,
  );
});

test("retiring ignores a human comment that carries the marker", async () => {
  const writes = await retire([
    { id: 4, user: { login: "someone" }, body: publishedBody },
  ]);

  assert.deepEqual(writes, []);
});

test("retiring a pull request without a preview comment writes nothing", async () => {
  assert.deepEqual(await retire([]), []);
});
