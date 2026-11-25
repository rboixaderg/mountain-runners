import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

test("keeps working on a store whose watches could ask for the preview", (context) => {
  const path = fixture(context);
  const previous = new DatabaseSync(path);
  previous.exec(`
    CREATE TABLE ci_watches (
      update_identifier INTEGER PRIMARY KEY,
      session_key TEXT NOT NULL,
      pull_request_number INTEGER NOT NULL,
      commit_sha TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'uncertain', 'superseded')),
      result TEXT,
      preview_author_identifier INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO ci_watches
      (update_identifier, session_key, pull_request_number, commit_sha, state,
       result, preview_author_identifier, created_at, updated_at)
    VALUES (12, '-100123:7', 123, '${"a".repeat(40)}', 'pending', NULL, 42,
            '2026-11-14T10:00:00Z', '2026-11-14T10:00:00Z');
  `);
  previous.close();

  const store = new CiWatchStore(path);
  store.add({
    ...request,
    updateIdentifier: 13,
    pullRequestNumber: 124,
    commitSha: "b".repeat(40),
  });
  assert.deepEqual(
    store.pending().map((watch) => watch.update_identifier),
    [12, 13],
  );
  store.close();
});

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

test("supersedes the older pending watch of the same pull request", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  store.add({
    ...request,
    updateIdentifier: 13,
    commitSha: "b".repeat(40),
  });

  // The older commit is not the head any more: its notice is never sent.
  assert.deepEqual(
    store.pending().map((row) => row.update_identifier),
    [13],
  );
  assert.equal(store.state(12), "superseded");
  assert.equal(store.finishSend(12, "success"), false);
  assert.equal(store.hasUnreportedWork(request.sessionKey), true);
  store.close();
});

test("keeps the pending watch of another pull request", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  store.add({
    ...request,
    updateIdentifier: 13,
    pullRequestNumber: 124,
    commitSha: "b".repeat(40),
  });

  assert.deepEqual(
    store.pending().map((row) => row.update_identifier),
    [12, 13],
  );
  assert.equal(store.state(12), "pending");
  store.close();
});

test("does not send a successfully recorded notification twice", (context) => {
  const path = fixture(context);
  const store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.finishSend(12, "failure"), true);
  assert.equal(store.finishSend(12, "success"), false);
  assert.deepEqual(store.pending(), []);
  assert.equal(store.state(12), "sent");
  store.close();
});

test("ignores the tables and notice states of an earlier version", (context) => {
  const path = fixture(context);
  const earlier = new CiWatchStore(path);
  earlier.add(request);
  earlier.add({ ...request, updateIdentifier: 13, pullRequestNumber: 124 });
  earlier.close();
  const database = new DatabaseSync(path);
  database.exec(`
    UPDATE ci_watches SET state = 'sending', result = 'failure'
      WHERE update_identifier = 12;
    UPDATE ci_watches SET state = 'uncertain', result = 'repairing'
      WHERE update_identifier = 13;
    CREATE TABLE ci_repairs (session_key TEXT, status TEXT);
    INSERT INTO ci_repairs VALUES ('-100123:7', 'uncertain');
    CREATE TABLE ci_reruns (run_identifier INTEGER PRIMARY KEY);
  `);
  database.close();

  const store = new CiWatchStore(path);
  context.after(() => store.close());

  assert.deepEqual(store.pending(), []);
  assert.equal(store.hasUnreportedWork(request.sessionKey), false);
});

test("tells whether the topic has work newer than its last notice", (context) => {
  const store = new CiWatchStore(fixture(context));
  const topic = "-100123:7";
  assert.equal(store.hasUnreportedWork(topic), false);

  store.add(request);
  assert.equal(store.hasUnreportedWork(topic), true);
  assert.equal(store.hasUnreportedWork("-100123:8"), false);
  store.finishSend(12, "failure");
  assert.equal(store.hasUnreportedWork(topic), false);
  store.close();
});

test("finds the newest publication of a topic regardless of CI delivery", (context) => {
  const store = new CiWatchStore(fixture(context), {
    now: () => new Date("2026-11-22T10:00:00Z"),
  });
  context.after(() => store.close());
  assert.equal(store.latestTopicPublication(request.sessionKey), undefined);

  store.add(request);
  store.finishSend(request.updateIdentifier, "success");
  const newerCommit = "b".repeat(40);
  store.add({ ...request, updateIdentifier: 13, commitSha: newerCommit });
  store.add({ ...request, updateIdentifier: 14, sessionKey: "-100123:8" });

  assert.deepEqual(
    { ...store.latestTopicPublication(request.sessionKey) },
    {
      update_identifier: 13,
      pull_request_number: request.pullRequestNumber,
      commit_sha: newerCommit,
    },
  );
});
