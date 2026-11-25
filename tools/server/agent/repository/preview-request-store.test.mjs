import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  PreviewRequestStore,
  previewStates,
} from "./preview-request-store.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-preview-store-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "preview.sqlite");
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
function readRequest(path, updateIdentifier) {
  const database = new DatabaseSync(path);
  try {
    return database
      .prepare("SELECT * FROM preview_requests WHERE update_identifier = ?")
      .get(updateIdentifier);
  } finally {
    database.close();
  }
}

test("an awaiting row survives a restart with its deadline reference", (context) => {
  const path = fixture(context);
  let store = new PreviewRequestStore(path, {
    now: () => new Date("2026-11-14T10:00:01Z"),
  });
  store.track(request);
  store.close();

  store = new PreviewRequestStore(path);
  const [row] = store.awaiting();
  assert.equal(row.updated_at, "2026-11-14T10:00:01.000Z");
  store.close();
});

test("ends an awaiting request only once", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.track(request);
  assert.equal(
    store.finish(1, request.commitSha, previewStates.confirmed, previewOrigin),
    true,
  );
  assert.equal(
    store.finish(1, request.commitSha, previewStates.timedOut),
    false,
  );
  store.close();
});

test("ends a confirmed request with its origin at the moment it ended", (context) => {
  const path = fixture(context);
  let moment = new Date("2026-11-14T10:05:00Z");
  const store = new PreviewRequestStore(path, { now: () => moment });
  store.track(request);

  moment = new Date("2026-11-14T10:20:00Z");
  assert.equal(
    store.finish(1, request.commitSha, previewStates.confirmed, previewOrigin),
    true,
  );

  const row = readRequest(path, 1);
  assert.equal(row.state, previewStates.confirmed);
  assert.equal(row.confirmed_origin, previewOrigin);
  assert.equal(row.updated_at, "2026-11-14T10:20:00.000Z");
  store.close();
});

test("never stores an origin for a request that did not end confirmed", (context) => {
  const path = fixture(context);
  const store = new PreviewRequestStore(path);
  store.track(request);
  store.finish(1, request.commitSha, previewStates.timedOut, previewOrigin);

  assert.equal(readRequest(path, 1).confirmed_origin, null);
  store.close();
});

test("ends a request only in a terminal state and never without its origin", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.track(request);

  assert.throws(
    () => store.finish(1, request.commitSha, previewStates.awaiting),
    /Invalid preview end state/u,
  );
  assert.throws(
    () => store.finish(1, request.commitSha, previewStates.confirmed),
    /requires the origin/u,
  );
  assert.equal(store.state(1), previewStates.awaiting);
  assert.equal(
    store.finish(1, request.commitSha, previewStates.confirmed, previewOrigin),
    true,
  );
  store.close();
});

test("opens a deployed store that keeps an older column and state check", (context) => {
  const path = fixture(context);
  const deployed = new DatabaseSync(path);
  deployed.exec(`
    CREATE TABLE preview_requests (
      update_identifier INTEGER PRIMARY KEY,
      session_key TEXT NOT NULL,
      author_identifier INTEGER NOT NULL,
      pull_request_number INTEGER NOT NULL,
      commit_sha TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('commenting', 'awaiting', 'confirmed', 'timed_out', 'failed', 'uncertain')),
      commented_at TEXT,
      confirmed_origin TEXT,
      notice_message_identifier INTEGER,
      merge_synchronization INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX preview_requests_state_commented
      ON preview_requests (state, commented_at);
  `);
  deployed.close();

  const store = new PreviewRequestStore(path);
  context.after(() => store.close());
  store.track(request);
  store.track({ ...request, updateIdentifier: 2, commitSha: newerCommit });
  assert.equal(
    store.finish(1, request.commitSha, previewStates.confirmed, previewOrigin),
    true,
  );
  assert.deepEqual(
    store.awaiting().map((row) => row.update_identifier),
    [2],
  );
});

test("follows a publication of the service as an awaiting request", (context) => {
  const store = new PreviewRequestStore(fixture(context), {
    now: () => new Date("2026-11-14T10:00:00Z"),
  });
  store.track(request);

  const [row] = store.awaiting();
  assert.equal(row.update_identifier, 1);
  assert.equal(row.pull_request_number, 42);
  assert.equal(row.commit_sha, request.commitSha);
  assert.equal(row.updated_at, "2026-11-14T10:00:00.000Z");
  store.close();
});

test("a new publication of the same update replaces what its row reported", (context) => {
  const path = fixture(context);
  let moment = new Date("2026-11-14T10:00:00Z");
  const store = new PreviewRequestStore(path, { now: () => moment });
  store.track(request);
  store.finish(1, request.commitSha, previewStates.confirmed, previewOrigin);

  moment = new Date("2026-11-14T11:00:00Z");
  store.track({ ...request, commitSha: newerCommit });

  const row = readRequest(path, 1);
  assert.equal(row.state, previewStates.awaiting);
  assert.equal(row.commit_sha, newerCommit);
  assert.equal(row.confirmed_origin, null);
  assert.equal(row.created_at, "2026-11-14T11:00:00.000Z");
  assert.equal(row.updated_at, "2026-11-14T11:00:00.000Z");
  assert.equal(store.awaiting().length, 1);
  store.close();
});

const deliveredPublication = {
  sessionKey: request.sessionKey,
  updateIdentifier: 1,
  pullRequestNumber: request.pullRequestNumber,
  commitSha: request.commitSha,
};

test("binds a delivered preview to its exact publication and commit", (context) => {
  const path = fixture(context);
  const moment = new Date("2026-11-14T10:00:00Z");
  const store = new PreviewRequestStore(path, { now: () => moment });
  store.track(request);
  store.finish(
    1,
    request.commitSha,
    previewStates.confirmed,
    previewOrigin,
    77,
  );

  const delivered = store.deliveredPublicationPreview(deliveredPublication);
  assert.equal(delivered.update_identifier, 1);
  assert.equal(delivered.pull_request_number, 42);
  assert.equal(delivered.commit_sha, request.commitSha);
  assert.equal(delivered.notice_message_identifier, 77);
  assert.equal(delivered.created_at, "2026-11-14T10:00:00.000Z");
  store.close();

  const restarted = new PreviewRequestStore(path);
  assert.equal(
    restarted.deliveredPublicationPreview(deliveredPublication)
      .notice_message_identifier,
    77,
  );
  restarted.close();
});

test("never binds a preview of another publication, commit, topic or state", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.track(request);
  store.finish(
    1,
    request.commitSha,
    previewStates.confirmed,
    previewOrigin,
    77,
  );

  for (const expected of [
    { ...deliveredPublication, commitSha: newerCommit },
    { ...deliveredPublication, pullRequestNumber: 43 },
    { ...deliveredPublication, sessionKey: "-100123:8" },
    { ...deliveredPublication, updateIdentifier: 2 },
  ]) {
    assert.equal(store.deliveredPublicationPreview(expected), null);
  }

  const pending = {
    ...deliveredPublication,
    updateIdentifier: 2,
    commitSha: newerCommit,
  };
  store.track({ ...request, ...pending });
  assert.equal(store.deliveredPublicationPreview(pending), null);

  // A confirmation that kept no notice identifier is no delivered preview.
  store.finish(2, newerCommit, previewStates.confirmed, previewOrigin);
  assert.equal(store.deliveredPublicationPreview(pending), null);
  store.close();
});

test("a notice identifier a row cannot use never makes it a delivered preview", (context) => {
  const path = fixture(context);
  const store = new PreviewRequestStore(path);
  store.track(request);

  for (const identifier of [0, -1, 1.5, Number.NaN, "77"]) {
    assert.throws(
      () =>
        store.finish(
          1,
          request.commitSha,
          previewStates.confirmed,
          previewOrigin,
          identifier,
        ),
      /positive Telegram message id/u,
    );
  }
  assert.equal(store.state(1), previewStates.awaiting);

  assert.equal(
    store.finish(1, request.commitSha, previewStates.confirmed, previewOrigin),
    true,
  );
  assert.equal(store.state(1), previewStates.confirmed);
  assert.equal(store.deliveredPublicationPreview(deliveredPublication), null);

  // A request that ended another way keeps none.
  store.track({ ...request, updateIdentifier: 2, commitSha: newerCommit });
  store.finish(2, newerCommit, previewStates.timedOut, null, 78);
  assert.equal(readRequest(path, 2).notice_message_identifier, null);
  store.close();
});

test("a new publication clears the delivered notice of the row", (context) => {
  const path = fixture(context);
  const store = new PreviewRequestStore(path);
  store.track(request);
  store.finish(
    1,
    request.commitSha,
    previewStates.confirmed,
    previewOrigin,
    77,
  );

  store.track({ ...request, commitSha: newerCommit });

  assert.equal(readRequest(path, 1).notice_message_identifier, null);
  assert.equal(
    store.deliveredPublicationPreview({
      ...deliveredPublication,
      commitSha: newerCommit,
    }),
    null,
  );

  const repaired = {
    ...deliveredPublication,
    updateIdentifier: 2,
    commitSha: newerCommit,
  };
  store.track({ ...request, ...repaired });
  store.finish(2, newerCommit, previewStates.confirmed, previewOrigin, 78);
  assert.equal(
    store.deliveredPublicationPreview(repaired).notice_message_identifier,
    78,
  );

  store.close();
});

test("a result read for an older commit never ends the row rewritten for a newer one", (context) => {
  const path = fixture(context);
  const store = new PreviewRequestStore(path);
  store.track(request);
  store.track({ ...request, commitSha: newerCommit });

  assert.equal(
    store.finish(1, request.commitSha, previewStates.confirmed, previewOrigin),
    false,
  );
  assert.equal(store.state(1), previewStates.awaiting);
  assert.equal(readRequest(path, 1).confirmed_origin, null);
  assert.equal(store.finish(1, newerCommit, previewStates.timedOut), true);
  store.close();
});
