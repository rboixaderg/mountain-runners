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

  // The older commit is not the head any more: its notice is never sent and it
  // never becomes the report of the topic.
  assert.deepEqual(
    store.pending().map((row) => row.update_identifier),
    [13],
  );
  assert.equal(store.state(12), "superseded");
  assert.equal(store.finishSend(12, "success"), false);
  assert.equal(store.hasUnreportedWork(request.sessionKey), true);

  store.finishSend(13, "success");
  assert.equal(
    store.lastReported(request.sessionKey).commit_sha,
    "b".repeat(40),
  );
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

test("widens the state check of a store created before superseding", (context) => {
  const path = fixture(context);
  // The previous schema could not hold a superseded watch: opening it rebuilds
  // the table once and keeps its rows.
  const previous = new DatabaseSync(path);
  previous.exec(`
    CREATE TABLE ci_watches (
      update_identifier INTEGER PRIMARY KEY,
      session_key TEXT NOT NULL,
      pull_request_number INTEGER NOT NULL,
      commit_sha TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'uncertain')),
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO ci_watches
      (update_identifier, session_key, pull_request_number, commit_sha, state,
       result, created_at, updated_at)
    VALUES (12, '-100123:7', 123, '${"a".repeat(40)}', 'pending', NULL,
            '2026-11-14T10:00:00Z', '2026-11-14T10:00:00Z');
  `);
  previous.close();

  const store = new CiWatchStore(path);
  store.add({ ...request, updateIdentifier: 13, commitSha: "b".repeat(40) });
  assert.equal(store.state(12), "superseded");
  assert.deepEqual(
    store.pending().map((row) => row.update_identifier),
    [13],
  );
  store.close();

  // The indexes of the rebuilt table were created in the same transaction.
  const database = new DatabaseSync(path, { readOnly: true });
  const indexes = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND tbl_name = 'ci_watches' ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
  database.close();
  assert.deepEqual(indexes, [
    "ci_watches_pull_request",
    "ci_watches_topic_state",
  ]);
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
  assert.equal(store.lastReported(request.sessionKey), undefined);
});

test("reports the last delivered notice of the session, never a pending one", (context) => {
  const store = new CiWatchStore(fixture(context));
  assert.equal(store.lastReported("-100123:7"), undefined);

  store.add(request);
  assert.equal(store.lastReported("-100123:7"), undefined);
  assert.equal(store.lastReported("-100123:7"), undefined);
  store.finishSend(12, "success");
  assert.deepEqual(
    { ...store.lastReported("-100123:7") },
    {
      pull_request_number: 123,
      commit_sha: request.commitSha,
      result: "success",
    },
  );

  store.add({
    ...request,
    updateIdentifier: 13,
    commitSha: "b".repeat(40),
  });
  store.finishSend(13, "failure");
  assert.equal(store.lastReported("-100123:7").result, "failure");
  assert.equal(store.lastReported("-100123:8"), undefined);
  store.close();
});

test("reports the last delivered notice of one pull request, never of another", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  store.finishSend(12, "success");
  store.add({
    ...request,
    updateIdentifier: 13,
    pullRequestNumber: 124,
    commitSha: "b".repeat(40),
  });
  store.finishSend(13, "failure");

  assert.deepEqual(
    {
      ...store.lastReportedForPullRequest({
        sessionKey: request.sessionKey,
        pullRequestNumber: 123,
      }),
    },
    {
      update_identifier: request.updateIdentifier,
      pull_request_number: 123,
      commit_sha: request.commitSha,
      result: "success",
    },
  );
  assert.equal(
    store.lastReportedForPullRequest({
      sessionKey: request.sessionKey,
      pullRequestNumber: 124,
    }).commit_sha,
    "b".repeat(40),
  );
  assert.equal(
    store.lastReportedForPullRequest({
      sessionKey: request.sessionKey,
      pullRequestNumber: 125,
    }),
    undefined,
  );
  store.close();
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

test("never lets a slow older watch overwrite a newer green report", (context) => {
  let instant = Date.parse("2026-11-16T10:00:00Z");
  const store = new CiWatchStore(fixture(context), {
    now: () => new Date(instant),
  });
  const topic = "-100123:7";
  const olderCommit = "a".repeat(40);
  const newerCommit = "b".repeat(40);
  store.add({
    ...request,
    updateIdentifier: 10,
    commitSha: olderCommit,
  });
  instant += 1000;
  store.add({
    ...request,
    updateIdentifier: 11,
    commitSha: newerCommit,
  });

  // The newer commit is reported first, and the older one only afterwards.
  store.finishSend(11, "failure");
  instant += 1000;
  store.finishSend(10, "success");

  assert.equal(store.lastReported(topic).commit_sha, newerCommit);
  assert.equal(store.lastReported(topic).result, "failure");
  store.close();
});

test("reports the topic of the most recent publication of a pull request", (context) => {
  const store = new CiWatchStore(fixture(context));
  assert.equal(store.latestPublication(123), undefined);

  store.add(request);
  assert.equal(store.latestPublication(123).session_key, request.sessionKey);
  assert.equal(store.latestPublication(124), undefined);

  store.add({
    ...request,
    updateIdentifier: 13,
    sessionKey: "-100123:8",
  });
  assert.equal(store.latestPublication(123).session_key, "-100123:8");
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

test("lists the latest watch of each published pull request and its owner", (context) => {
  const store = new CiWatchStore(fixture(context));
  assert.deepEqual(store.latestPublications(), []);

  // Two topics publish two pull requests; the later publication of one topic
  // leaves its previous pull request without a local branch.
  store.add(request);
  store.add({
    ...request,
    updateIdentifier: 13,
    sessionKey: "-100123:8",
  });
  store.add({
    ...request,
    updateIdentifier: 14,
    pullRequestNumber: 124,
    commitSha: "b".repeat(40),
  });

  const published = store.latestPublications().map((row) => ({ ...row }));
  assert.deepEqual(published, [
    {
      pull_request_number: 123,
      session_key: "-100123:8",
      delivered_result: null,
      is_owner_latest: 1,
    },
    {
      pull_request_number: 124,
      session_key: request.sessionKey,
      delivered_result: null,
      is_owner_latest: 1,
    },
  ]);

  store.add({
    ...request,
    updateIdentifier: 15,
    pullRequestNumber: 125,
    commitSha: "c".repeat(40),
  });
  const publications = store.latestPublications();
  assert.deepEqual(
    publications.map(({ pull_request_number, is_owner_latest }) => [
      pull_request_number,
      is_owner_latest,
    ]),
    [
      [123, 1],
      [124, 0],
      [125, 1],
    ],
  );
  store.close();
});

test("keeps the result of the latest delivered notice of a pull request", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  store.finishSend(12, "pull-request-closed");

  const [publication] = store.latestPublications().map((row) => ({ ...row }));
  assert.deepEqual(publication, {
    pull_request_number: 123,
    session_key: request.sessionKey,
    delivered_result: "pull-request-closed",
    is_owner_latest: 1,
  });
  store.close();
});
