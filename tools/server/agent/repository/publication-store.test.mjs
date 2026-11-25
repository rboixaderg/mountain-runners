import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { previewStates, PublicationStore } from "./publication-store.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-publication-store-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "agent.sqlite");
}

const request = {
  updateIdentifier: 1,
  sessionKey: "-100123:7",
  authorIdentifier: 555,
  pullRequestNumber: 42,
  commitSha: "a".repeat(40),
};

const newerCommit = "b".repeat(40);
const previewOrigin = "https://pr-42.preview.mountainrunners.cat";

/** The stored row of one update, read without the store. */
function readRow(path, updateIdentifier) {
  const database = new DatabaseSync(path);
  try {
    return database
      .prepare("SELECT * FROM publications WHERE update_identifier = ?")
      .get(updateIdentifier);
  } finally {
    database.close();
  }
}

function confirm(store, updateIdentifier, commitSha, notice) {
  return store.finishPreview(
    updateIdentifier,
    commitSha,
    previewStates.confirmed,
    previewOrigin,
    notice,
  );
}

test("records one row with a pending CI watch and an awaiting preview", (context) => {
  const path = fixture(context);
  let store = new PublicationStore(path, {
    now: () => new Date("2026-11-14T10:00:01Z"),
  });
  store.record(request);
  store.close();

  store = new PublicationStore(path);
  const [watch] = store.pendingCiWatches();
  const [preview] = store.awaitingPreviews();
  assert.deepEqual({ ...watch }, { ...preview });
  assert.equal(watch.commit_sha, request.commitSha);
  assert.equal(watch.session_key, request.sessionKey);
  assert.equal(watch.pull_request_number, 42);
  assert.equal(watch.author_identifier, 555);
  assert.equal(watch.created_at, "2026-11-14T10:00:01.000Z");
  assert.equal(watch.preview_updated_at, "2026-11-14T10:00:01.000Z");
  store.close();
});

test("each half ends on its own and only once", (context) => {
  const path = fixture(context);
  let moment = new Date("2026-11-14T10:05:00Z");
  const store = new PublicationStore(path, { now: () => moment });
  store.record(request);

  assert.equal(store.finishCiNotice(1, "failure"), true);
  assert.equal(store.finishCiNotice(1, "success"), false);
  assert.equal(
    readRow(path, 1).preview_updated_at,
    "2026-11-14T10:05:00.000Z",
    "the CI notice never moves the deadline of the preview",
  );
  moment = new Date("2026-11-14T10:20:00Z");
  assert.equal(confirm(store, 1, request.commitSha), true);
  assert.equal(
    store.finishPreview(1, request.commitSha, previewStates.timedOut),
    false,
  );

  const row = readRow(path, 1);
  assert.equal(row.ci_state, "sent");
  assert.equal(row.ci_result, "failure");
  assert.equal(row.preview_state, previewStates.confirmed);
  assert.equal(row.confirmed_origin, previewOrigin);
  assert.equal(row.preview_updated_at, "2026-11-14T10:20:00.000Z");
  store.close();
});

test("never stores an origin for a preview that did not end confirmed", (context) => {
  const path = fixture(context);
  const store = new PublicationStore(path);
  store.record(request);
  store.finishPreview(
    1,
    request.commitSha,
    previewStates.timedOut,
    previewOrigin,
    78,
  );

  assert.equal(readRow(path, 1).confirmed_origin, null);
  assert.equal(readRow(path, 1).notice_message_identifier, null);
  store.close();
});

test("ends a preview only in a terminal state and never without its origin", (context) => {
  const store = new PublicationStore(fixture(context));
  store.record(request);

  assert.throws(
    () => store.finishPreview(1, request.commitSha, previewStates.awaiting),
    /Invalid preview end state/u,
  );
  assert.throws(
    () => store.finishPreview(1, request.commitSha, previewStates.confirmed),
    /requires the origin/u,
  );
  assert.equal(store.previewState(1), previewStates.awaiting);
  assert.equal(confirm(store, 1, request.commitSha), true);
  store.close();
});

test("supersedes the older pending watch of the same pull request", (context) => {
  const store = new PublicationStore(fixture(context));
  store.record(request);
  store.record({ ...request, updateIdentifier: 2, commitSha: newerCommit });

  // The older commit is not the head any more: its CI notice is never sent,
  // while its preview is still followed.
  assert.deepEqual(
    store.pendingCiWatches().map((row) => row.update_identifier),
    [2],
  );
  assert.equal(store.ciState(1), "superseded");
  assert.equal(store.finishCiNotice(1, "success"), false);
  assert.equal(store.previewState(1), previewStates.awaiting);
  assert.equal(store.hasUnreportedWork(request.sessionKey), true);
  store.close();
});

test("keeps the pending watch of another pull request", (context) => {
  const store = new PublicationStore(fixture(context));
  store.record(request);
  store.record({
    ...request,
    updateIdentifier: 2,
    pullRequestNumber: 43,
    commitSha: newerCommit,
  });

  assert.deepEqual(
    store.pendingCiWatches().map((row) => row.update_identifier),
    [1, 2],
  );
  store.close();
});

test("ends the awaiting merge synchronization a newer publication replaces", (context) => {
  const store = new PublicationStore(fixture(context));
  store.record({ ...request, mergeSynchronization: true });
  store.record({ ...request, updateIdentifier: 2, commitSha: newerCommit });

  assert.equal(store.previewState(1), previewStates.failed);
  assert.deepEqual(
    store.awaitingPreviews().map((row) => row.update_identifier),
    [2],
  );
  store.close();
});

test("tells whether the topic has work newer than its last notice", (context) => {
  const store = new PublicationStore(fixture(context));
  assert.equal(store.hasUnreportedWork(request.sessionKey), false);

  store.record(request);
  assert.equal(store.hasUnreportedWork(request.sessionKey), true);
  assert.equal(store.hasUnreportedWork("-100123:8"), false);
  store.finishCiNotice(1, "failure");
  assert.equal(store.hasUnreportedWork(request.sessionKey), false);
  store.close();
});

test("recording the same commit again keeps its CI watch and arms the preview", (context) => {
  const path = fixture(context);
  let moment = new Date("2026-11-14T10:00:00Z");
  const store = new PublicationStore(path, { now: () => moment });
  store.record(request);
  store.finishCiNotice(1, "success");
  confirm(store, 1, request.commitSha, 77);

  moment = new Date("2026-11-14T11:00:00Z");
  store.record(request);

  const row = readRow(path, 1);
  assert.equal(row.ci_state, "sent");
  assert.equal(row.ci_result, "success");
  assert.equal(row.created_at, "2026-11-14T10:00:00.000Z");
  assert.equal(row.preview_state, previewStates.awaiting);
  assert.equal(row.confirmed_origin, null);
  assert.equal(row.notice_message_identifier, null);
  assert.equal(row.preview_updated_at, "2026-11-14T11:00:00.000Z");
  store.close();
});

test("another commit of the same update replaces its row", (context) => {
  const path = fixture(context);
  let moment = new Date("2026-11-14T10:00:00Z");
  const store = new PublicationStore(path, { now: () => moment });
  store.record(request);
  store.finishCiNotice(1, "success");
  confirm(store, 1, request.commitSha, 77);

  moment = new Date("2026-11-14T11:00:00Z");
  store.record({ ...request, commitSha: newerCommit });

  const row = readRow(path, 1);
  assert.equal(row.commit_sha, newerCommit);
  assert.equal(row.ci_state, "pending");
  assert.equal(row.ci_result, null);
  assert.equal(row.created_at, "2026-11-14T11:00:00.000Z");
  assert.equal(row.preview_state, previewStates.awaiting);
  assert.equal(row.notice_message_identifier, null);
  store.close();
});

test("a result read for an older commit never ends the row rewritten for a newer one", (context) => {
  const path = fixture(context);
  const store = new PublicationStore(path);
  store.record(request);
  store.record({ ...request, commitSha: newerCommit });

  assert.equal(confirm(store, 1, request.commitSha), false);
  assert.equal(store.previewState(1), previewStates.awaiting);
  assert.equal(
    store.finishPreview(1, newerCommit, previewStates.timedOut),
    true,
  );
  store.close();
});

test("delivers the confirmed preview of the latest publication across a restart", (context) => {
  const path = fixture(context);
  const store = new PublicationStore(path);
  store.record(request);
  confirm(store, 1, request.commitSha, 77);

  // The CI notice does not matter.
  assert.equal(
    store.deliveredPreview(request.sessionKey).notice_message_identifier,
    77,
  );
  store.close();

  const restarted = new PublicationStore(path);
  const delivered = restarted.deliveredPreview(request.sessionKey);
  assert.equal(delivered.update_identifier, 1);
  assert.equal(delivered.pull_request_number, 42);
  assert.equal(delivered.commit_sha, request.commitSha);
  assert.equal(restarted.deliveredPreview("-100123:8"), undefined);
  restarted.close();
});

test("never falls back from the latest publication to an earlier preview", (context) => {
  // The same instant: the newer update is the latest publication.
  const store = new PublicationStore(fixture(context), {
    now: () => new Date("2026-11-22T10:00:00Z"),
  });
  store.record(request);
  confirm(store, 1, request.commitSha, 77);
  store.record({ ...request, updateIdentifier: 2, commitSha: newerCommit });

  assert.equal(store.deliveredPreview(request.sessionKey), undefined);
  // A confirmation that kept no notice identifier is no delivered preview.
  confirm(store, 2, newerCommit);
  assert.equal(store.deliveredPreview(request.sessionKey), undefined);
  store.close();
});

test("a notice identifier a row cannot use never makes it a delivered preview", (context) => {
  const store = new PublicationStore(fixture(context));
  store.record(request);

  for (const identifier of [0, -1, 1.5, Number.NaN, "77"]) {
    assert.throws(
      () => confirm(store, 1, request.commitSha, identifier),
      /positive Telegram message id/u,
    );
  }
  assert.equal(store.previewState(1), previewStates.awaiting);
  assert.equal(confirm(store, 1, request.commitSha), true);
  assert.equal(store.deliveredPreview(request.sessionKey), undefined);
  store.close();
});

test("finds the pull request of the newest publishing update of a topic", (context) => {
  const store = new PublicationStore(fixture(context));
  context.after(() => store.close());
  assert.equal(store.topicPullRequestNumber(request.sessionKey), null);

  store.record({ ...request, updateIdentifier: 14, pullRequestNumber: 44 });
  // A reconciled publication is recorded late.
  store.record({ ...request, updateIdentifier: 13, pullRequestNumber: 43 });

  assert.equal(store.topicPullRequestNumber(request.sessionKey), 44);
});
