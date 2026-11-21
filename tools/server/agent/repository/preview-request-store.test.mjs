import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  PreviewRequestStore,
  previewBeginResults,
  previewStates,
} from "./preview-request-store.mjs";
import {
  seedLegacyPreviewRequest,
  seedUncertainPreviewRequest,
} from "./test-support/preview-requests.mjs";

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

test("records a request directly as awaiting the publisher", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  assert.equal(store.begin(request), previewBeginResults.begun);
  assert.equal(store.state(1), previewStates.awaiting);
  const [row] = store.awaiting();
  assert.equal(row.author_identifier, 555);
  assert.equal(row.commit_sha, request.commitSha);
  assert.equal(store.uncertainCount(), 0);
  store.close();
});

test("never begins the same update twice", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  store.finish(1, previewStates.confirmed, previewOrigin);
  assert.equal(store.begin(request), previewBeginResults.duplicate);
  store.close();
});

test("blocks a new request for the commit until the previous one ended", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  const repeated = { ...request, updateIdentifier: 2 };
  assert.equal(store.begin(repeated), previewBeginResults.open);
  store.finish(1, previewStates.confirmed, previewOrigin);
  assert.equal(store.begin(repeated), previewBeginResults.begun);
  store.finish(2, previewStates.timedOut);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 3 }),
    previewBeginResults.begun,
  );
  store.close();
});

test("allows a new request for a new commit or another pull request", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2, commitSha: newerCommit }),
    previewBeginResults.begun,
  );
  assert.equal(
    store.begin({ ...request, updateIdentifier: 3, pullRequestNumber: 43 }),
    previewBeginResults.begun,
  );
  store.close();
});

test("a legacy uncertain request survives a restart and keeps blocking its commit", (context) => {
  const path = fixture(context);
  new PreviewRequestStore(path).close();
  seedUncertainPreviewRequest(path, {
    ...request,
    createdAt: "2026-11-14T10:00:00.000Z",
  });

  const store = new PreviewRequestStore(path);
  assert.equal(store.uncertainCount(), 1);
  assert.deepEqual(
    store.uncertain().map((row) => row.update_identifier),
    [1],
  );
  assert.deepEqual(store.awaiting(), []);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2 }),
    previewBeginResults.open,
  );
  store.close();
});

test("a legacy interrupted comment becomes uncertain on restart and is not posted", (context) => {
  const path = fixture(context);
  new PreviewRequestStore(path).close();
  seedLegacyPreviewRequest(path, {
    ...request,
    state: previewStates.commenting,
    createdAt: "2026-11-14T10:00:00.000Z",
  });

  const store = new PreviewRequestStore(path);
  assert.deepEqual(
    store.recoverCommenting().map((row) => row.update_identifier),
    [1],
  );
  assert.equal(store.state(1), previewStates.uncertain);
  assert.deepEqual(store.recoverCommenting(), []);
  assert.deepEqual(store.awaiting(), []);
  store.close();
});

test("an awaiting request survives a restart with its deadline reference", (context) => {
  const path = fixture(context);
  let store = new PreviewRequestStore(path, {
    now: () => new Date("2026-11-14T10:00:01Z"),
  });
  store.begin(request);
  store.close();

  store = new PreviewRequestStore(path);
  assert.deepEqual(store.recoverCommenting(), []);
  const [row] = store.awaiting();
  assert.equal(row.commented_at, null);
  assert.equal(row.updated_at, "2026-11-14T10:00:01.000Z");
  store.close();
});

test("ends an awaiting request only once", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.finish(1, previewStates.confirmed, previewOrigin), true);
  assert.equal(store.finish(1, previewStates.timedOut), false);
  store.close();
});

test("ends a confirmed request with its origin at the moment it ended", (context) => {
  const path = fixture(context);
  let moment = new Date("2026-11-14T10:05:00Z");
  const store = new PreviewRequestStore(path, { now: () => moment });
  store.begin(request);

  moment = new Date("2026-11-14T10:20:00Z");
  assert.equal(store.finish(1, previewStates.confirmed, previewOrigin), true);

  const row = readRequest(path, 1);
  assert.equal(row.state, previewStates.confirmed);
  assert.equal(row.confirmed_origin, previewOrigin);
  assert.equal(row.updated_at, "2026-11-14T10:20:00.000Z");
  store.close();
});

test("never stores an origin for a request that did not end confirmed", (context) => {
  const path = fixture(context);
  const store = new PreviewRequestStore(path);
  store.begin(request);
  store.finish(1, previewStates.timedOut, previewOrigin);

  assert.equal(readRequest(path, 1).confirmed_origin, null);
  store.close();
});

test("ends a request only in a terminal state and never without its origin", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);

  assert.throws(
    () => store.finish(1, previewStates.awaiting),
    /Invalid preview end state/u,
  );
  assert.throws(
    () => store.finish(1, previewStates.confirmed),
    /requires the origin/u,
  );
  assert.equal(store.state(1), previewStates.awaiting);
  assert.equal(store.finish(1, previewStates.confirmed, previewOrigin), true);
  store.close();
});

test("adds the confirmed origin to a store created before it was kept", (context) => {
  const path = fixture(context);
  const previous = new DatabaseSync(path);
  previous.exec(`
    CREATE TABLE preview_requests (
      update_identifier INTEGER PRIMARY KEY,
      session_key TEXT NOT NULL,
      author_identifier INTEGER NOT NULL,
      pull_request_number INTEGER NOT NULL,
      commit_sha TEXT NOT NULL,
      state TEXT NOT NULL,
      commented_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO preview_requests
      (update_identifier, session_key, author_identifier, pull_request_number,
       commit_sha, state, created_at, updated_at)
    VALUES (1, '-100123:7', 555, 42, '${"a".repeat(40)}', 'confirmed',
            '2026-11-14T10:00:00Z', '2026-11-14T10:00:00Z');
  `);
  previous.close();

  const store = new PreviewRequestStore(path);
  assert.equal(readRequest(path, 1).confirmed_origin, null);
  store.close();
});

test("keeps the request moment as the comment of a reconciled post", (context) => {
  const path = fixture(context);
  new PreviewRequestStore(path).close();
  seedUncertainPreviewRequest(path, {
    ...request,
    createdAt: "2026-11-14T10:00:00.000Z",
  });

  // The person confirms the comment much later: the attribution window of the
  // request still starts when the request did, not when it was reconciled.
  const store = new PreviewRequestStore(path, {
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  const resolved = store.resolveUncertainCommented(1);
  assert.equal(resolved.update_identifier, 1);
  assert.equal(store.state(1), previewStates.awaiting);
  assert.equal(store.awaiting()[0].commented_at, "2026-11-14T10:00:00.000Z");
  assert.equal(store.awaiting()[0].updated_at, "2026-11-14T12:00:00.000Z");
  store.close();
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
  store.finish(1, previewStates.confirmed, previewOrigin);

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

test("a repair reopens the row of its publication for the new commit", (context) => {
  const path = fixture(context);
  let moment = new Date("2026-11-14T10:00:00Z");
  const store = new PreviewRequestStore(path, { now: () => moment });
  store.track(request);
  store.finish(1, previewStates.timedOut);

  moment = new Date("2026-11-14T11:00:00Z");
  const repair = { updateIdentifier: 1, commitSha: newerCommit };
  assert.equal(store.reopen({ ...repair, pullRequestNumber: 43 }), false);
  assert.equal(store.reopen({ ...repair, pullRequestNumber: 42 }), true);

  const row = readRequest(path, 1);
  assert.equal(row.state, previewStates.awaiting);
  assert.equal(row.commit_sha, newerCommit);
  assert.equal(row.author_identifier, 555);
  assert.equal(row.updated_at, "2026-11-14T11:00:00.000Z");
  store.close();
});

test("a repair without a publication to continue creates nothing", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  assert.equal(
    store.reopen({
      updateIdentifier: 1,
      pullRequestNumber: 42,
      commitSha: newerCommit,
    }),
    false,
  );
  assert.equal(store.state(1), undefined);
  assert.deepEqual(store.awaiting(), []);
  store.close();
});
