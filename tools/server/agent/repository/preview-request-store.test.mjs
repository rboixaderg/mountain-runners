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

const previewOrigin = "https://pr-42.preview.mountainrunners.cat";

test("records a request as commenting before anything is posted", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  assert.equal(store.begin(request), previewBeginResults.begun);
  assert.equal(store.state(1), previewStates.commenting);
  assert.deepEqual(store.awaiting(), []);
  store.close();
});

test("a failed request is not open and keeps its author", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.markFailed(1), true);
  assert.equal(store.state(1), previewStates.failed);
  assert.equal(store.uncertainCount(), 0);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2 }),
    previewBeginResults.begun,
  );
  store.markAwaiting(2, "2026-11-14T10:00:00Z");
  assert.equal(store.awaiting()[0].author_identifier, 555);
  store.close();
});

test("never begins the same update twice", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  store.finish(1, previewStates.confirmed, previewOrigin);
  assert.equal(store.begin(request), previewBeginResults.duplicate);
  store.close();
});

test("blocks a new request for the commit until the previous one ended", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  const repeated = { ...request, updateIdentifier: 2 };
  assert.equal(store.begin(repeated), previewBeginResults.open);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  assert.equal(store.begin(repeated), previewBeginResults.open);
  store.finish(1, previewStates.confirmed, previewOrigin);
  assert.equal(store.begin(repeated), previewBeginResults.begun);
  store.markAwaiting(2, "2026-11-14T11:00:00Z");
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
    store.begin({
      ...request,
      updateIdentifier: 2,
      commitSha: "b".repeat(40),
    }),
    previewBeginResults.begun,
  );
  assert.equal(
    store.begin({ ...request, updateIdentifier: 3, pullRequestNumber: 43 }),
    previewBeginResults.begun,
  );
  store.close();
});

test("an uncertain request keeps blocking the commit", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.markUncertain(1), true);
  assert.equal(store.uncertainCount(), 1);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2 }),
    previewBeginResults.open,
  );
  store.close();
});

test("an interrupted comment becomes uncertain on restart and is not posted", (context) => {
  const path = fixture(context);
  let store = new PreviewRequestStore(path);
  store.begin(request);
  store.close();

  store = new PreviewRequestStore(path);
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
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  store.close();

  store = new PreviewRequestStore(path);
  assert.deepEqual(store.recoverCommenting(), []);
  const [row] = store.awaiting();
  assert.equal(row.commented_at, "2026-11-14T10:00:00Z");
  assert.equal(row.updated_at, "2026-11-14T10:00:01.000Z");
  store.close();
});

test("ends an awaiting request only once", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.finish(1, previewStates.confirmed, previewOrigin), false);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  assert.equal(store.finish(1, previewStates.confirmed, previewOrigin), true);
  assert.equal(store.finish(1, previewStates.timedOut), false);
  store.close();
});

test("ends a confirmed request with the origin the publisher confirmed", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  const origin = "https://pr-42.preview.mountainrunners.cat";
  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  assert.equal(store.finish(1, previewStates.confirmed, origin), true);

  const latest = store.latest({
    sessionKey: request.sessionKey,
    pullRequestNumber: request.pullRequestNumber,
  });
  assert.equal(latest.update_identifier, 1);
  assert.equal(latest.state, previewStates.confirmed);
  assert.equal(latest.confirmed_origin, origin);
  assert.equal(latest.commented_at, "2026-11-14T10:00:00Z");
  assert.equal(
    store.latest({ sessionKey: "-100999:4", pullRequestNumber: 42 }),
    undefined,
  );
  store.close();
});

test("keeps the end of the request as its updated moment", (context) => {
  let moment = new Date("2026-11-14T10:05:00Z");
  const store = new PreviewRequestStore(fixture(context), {
    now: () => moment,
  });
  const latestMoment = () =>
    store.latest({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
    }).updated_at;
  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  assert.equal(
    latestMoment(),
    "2026-11-14T10:05:00.000Z",
    "an awaiting request keeps the reference of its deadline",
  );

  moment = new Date("2026-11-14T10:20:00Z");
  store.finish(
    1,
    previewStates.confirmed,
    "https://pr-42.preview.mountainrunners.cat",
  );
  assert.equal(latestMoment(), "2026-11-14T10:20:00.000Z");
  store.close();
});

test("never stores an origin for a request that did not end confirmed", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  store.finish(
    1,
    previewStates.timedOut,
    "https://pr-42.preview.mountainrunners.cat",
  );

  assert.equal(
    store.latest({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
    }).confirmed_origin,
    null,
  );
  assert.equal(
    store.confirmedOrigin({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
      commitSha: request.commitSha,
    }),
    null,
  );
  store.close();
});

test("finds the confirmed origin of a commit after a newer request started", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  const origin = "https://pr-42.preview.mountainrunners.cat";
  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  store.finish(1, previewStates.confirmed, origin);
  store.begin({ ...request, updateIdentifier: 2 });
  store.markAwaiting(2, "2026-11-14T10:10:00Z");

  assert.equal(
    store.latest({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
    }).state,
    previewStates.awaiting,
  );
  assert.equal(
    store.confirmedOrigin({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
      commitSha: request.commitSha,
    }),
    origin,
  );
  assert.equal(
    store.confirmedOrigin({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
      commitSha: "b".repeat(40),
    }),
    null,
  );
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
  assert.equal(
    store.latest({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
    }).confirmed_origin,
    null,
  );
  assert.equal(
    store.confirmedOrigin({
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
      commitSha: request.commitSha,
    }),
    null,
  );
  store.close();
});

test("reports the newest request of one pull request, never of another", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  store.finish(
    1,
    previewStates.confirmed,
    "https://pr-42.preview.mountainrunners.cat",
  );
  store.begin({ ...request, updateIdentifier: 2, pullRequestNumber: 43 });
  store.markAwaiting(2, "2026-11-14T10:10:00Z");

  assert.equal(
    store.latest({ sessionKey: request.sessionKey, pullRequestNumber: 42 })
      .state,
    previewStates.confirmed,
  );
  assert.equal(
    store.latest({ sessionKey: request.sessionKey, pullRequestNumber: 43 })
      .state,
    previewStates.awaiting,
  );
  store.close();
});

test("ends a request only in a terminal state and never without its origin", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");

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

test("keeps the request moment as the comment of a reconciled post", (context) => {
  const path = fixture(context);
  let store = new PreviewRequestStore(path, {
    now: () => new Date("2026-11-14T10:00:00Z"),
  });
  store.begin(request);
  store.markUncertain(1);
  store.close();

  // The person confirms the comment much later: the attribution window of the
  // request still starts when the request did, not when it was reconciled.
  store = new PreviewRequestStore(path, {
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  const resolved = store.resolveUncertainCommented(1);
  assert.equal(resolved.update_identifier, 1);
  assert.equal(store.state(1), previewStates.awaiting);
  assert.equal(store.awaiting()[0].commented_at, "2026-11-14T10:00:00.000Z");
  assert.equal(store.awaiting()[0].updated_at, "2026-11-14T12:00:00.000Z");
  store.close();
});
