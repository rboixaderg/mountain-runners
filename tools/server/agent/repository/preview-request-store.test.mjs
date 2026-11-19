import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  store.finish(1, previewStates.confirmed);
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
  store.finish(1, previewStates.confirmed);
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
  assert.equal(store.finish(1, previewStates.confirmed), false);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  assert.equal(store.finish(1, previewStates.confirmed), true);
  assert.equal(store.finish(1, previewStates.timedOut), false);
  store.close();
});

test("keeps the comment time of every request that posted it", (context) => {
  const store = new PreviewRequestStore(fixture(context));
  assert.deepEqual(store.commented(), []);

  store.begin(request);
  store.markAwaiting(1, "2026-11-14T10:00:00Z");
  store.begin({ ...request, updateIdentifier: 2, commitSha: "b".repeat(40) });
  store.markAwaiting(2, "2026-11-14T10:00:00Z");
  // A request that ended still separates the runs of its neighbours.
  store.finish(1, previewStates.failed);

  assert.deepEqual(
    store.commented().map((row) => ({
      update_identifier: row.update_identifier,
      state: row.state,
      commented_at: row.commented_at,
    })),
    [
      {
        update_identifier: 1,
        state: "failed",
        commented_at: "2026-11-14T10:00:00Z",
      },
      {
        update_identifier: 2,
        state: "awaiting",
        commented_at: "2026-11-14T10:00:00Z",
      },
    ],
  );
  store.close();
});
