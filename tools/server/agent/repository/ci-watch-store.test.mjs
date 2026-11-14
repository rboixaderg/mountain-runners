import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "./ci-watch-store.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-watch-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "state.sqlite");
}

const request = {
  updateIdentifier: 12,
  sessionKey: "-100123:7",
  pullRequestNumber: 123,
  commitSha: "a".repeat(40),
};

test("preserves a pending watch and its pinned SHA after restart", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  store.add(request);
  store.close();
  store = new CiWatchStore(path);
  const [watch] = store.pending();
  assert.equal(watch.commit_sha, request.commitSha);
  assert.equal(watch.session_key, request.sessionKey);
  assert.equal(watch.pull_request_number, request.pullRequestNumber);
  assert.ok(Date.parse(watch.created_at) > 0);
  store.close();
});

test("does not resend a notification interrupted during delivery", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.beginSend(12, "success"), true);
  assert.equal(store.state(12), "sending");
  store.close();
  store = new CiWatchStore(path);
  const interrupted = store.recoverSending();
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].update_identifier, request.updateIdentifier);
  assert.equal(interrupted[0].session_key, request.sessionKey);
  assert.equal(interrupted[0].commit_sha, request.commitSha);
  assert.deepEqual(store.recoverSending(), []);
  assert.deepEqual(store.pending(), []);
  assert.equal(store.state(12), "uncertain");
  assert.equal(store.finishSend(12), false);
  store.close();
});

test("does not send a successfully recorded notification twice", (context) => {
  const path = fixture(context);
  const store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.beginSend(12, "failure"), true);
  assert.equal(store.beginSend(12, "success"), false);
  assert.equal(store.finishSend(12), true);
  assert.equal(store.beginSend(12, "failure"), false);
  assert.deepEqual(store.pending(), []);
  assert.equal(store.state(12), "sent");
  store.close();
});

test("keeps an uncertain delivery out of the pending queue", (context) => {
  const path = fixture(context);
  const store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.markUncertain(12), true);
  assert.equal(store.markUncertain(12), false);
  assert.deepEqual(store.pending(), []);
  assert.equal(store.state(12), "uncertain");
  store.close();
});
