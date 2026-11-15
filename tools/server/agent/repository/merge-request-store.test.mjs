import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MergeRequestStore,
  mergeBeginResults,
  mergeStates,
} from "./merge-request-store.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-merge-store-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "merge.sqlite");
}

const request = {
  updateIdentifier: 1,
  sessionKey: "-100123:7",
  authorIdentifier: 555,
  pullRequestNumber: 42,
  commitSha: "a".repeat(40),
};

test("records a request as merging before anything is merged", (context) => {
  const store = new MergeRequestStore(fixture(context));
  assert.equal(store.begin(request), mergeBeginResults.begun);
  assert.equal(store.state(1), mergeStates.merging);
  assert.deepEqual(store.uncertain(), []);
  store.close();
});

test("never begins the same update twice", (context) => {
  const store = new MergeRequestStore(fixture(context));
  store.begin(request);
  store.markFailed(1);
  assert.equal(store.begin(request), mergeBeginResults.duplicate);
  store.close();
});

test("a pull request has at most one request that has not ended", (context) => {
  const store = new MergeRequestStore(fixture(context));
  store.begin(request);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2 }),
    mergeBeginResults.open,
  );
  store.markUncertain(1);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2 }),
    mergeBeginResults.open,
  );
  assert.equal(
    store.begin({ ...request, updateIdentifier: 3, pullRequestNumber: 43 }),
    mergeBeginResults.begun,
  );
  store.close();
});

test("a failed request ends and allows a new one for the same pull request", (context) => {
  const store = new MergeRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.markFailed(1), true);
  assert.equal(store.state(1), mergeStates.failed);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2 }),
    mergeBeginResults.begun,
  );
  store.close();
});

test("a merged request keeps the merge commit and ends only once", (context) => {
  const store = new MergeRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.markMerged(1, "b".repeat(40)), true);
  assert.equal(store.state(1), mergeStates.merged);
  assert.equal(store.markMerged(1, "c".repeat(40)), false);
  assert.equal(store.markFailed(1), false);
  assert.equal(store.markUncertain(1), false);
  store.close();
});

test("an uncertain request can still be closed as merged by reading the pull request", (context) => {
  const store = new MergeRequestStore(fixture(context));
  store.begin(request);
  store.markUncertain(1);
  assert.equal(store.uncertain().length, 1);
  assert.equal(store.markMerged(1, "b".repeat(40)), true);
  assert.deepEqual(store.uncertain(), []);
  store.close();
});

test("restart marks an interrupted merge uncertain and keeps it across restarts", (context) => {
  const path = fixture(context);
  const first = new MergeRequestStore(path);
  first.begin(request);
  first.close();

  const second = new MergeRequestStore(path);
  const interrupted = second.recoverMerging();
  assert.deepEqual(
    interrupted.map((row) => [row.update_identifier, row.author_identifier]),
    [[1, 555]],
  );
  assert.equal(second.state(1), mergeStates.uncertain);
  assert.deepEqual(second.recoverMerging(), []);
  assert.equal(second.uncertain().length, 1);
  second.close();
});

test("a person's decision closes an uncertain request as not merged and allows a new one", (context) => {
  const store = new MergeRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.markNotMerged(1), false);
  store.markUncertain(1);
  assert.equal(store.markNotMerged(1), true);
  assert.equal(store.state(1), mergeStates.notMerged);
  assert.deepEqual(store.uncertain(), []);
  assert.equal(store.markMerged(1, "b".repeat(40)), false);
  assert.equal(
    store.begin({ ...request, updateIdentifier: 2 }),
    mergeBeginResults.begun,
  );
  store.close();
});

test("remembers that the topic was told about an unknown result", (context) => {
  const path = fixture(context);
  const first = new MergeRequestStore(path);
  first.begin(request);
  first.begin({ ...request, updateIdentifier: 2, pullRequestNumber: 43 });
  first.markUncertain(2);
  first.recoverMerging();
  const [interrupted, answered] = first.uncertain();
  assert.equal(interrupted.notified_at, null);
  assert.notEqual(answered.notified_at, null);
  first.markNotified(1);
  first.close();

  const second = new MergeRequestStore(path);
  assert.ok(second.uncertain().every((row) => row.notified_at !== null));
  second.close();
});

test("restart never reopens a request that ended", (context) => {
  const path = fixture(context);
  const first = new MergeRequestStore(path);
  first.begin(request);
  first.markMerged(1, "b".repeat(40));
  first.begin({ ...request, updateIdentifier: 2 });
  first.markFailed(2);
  first.begin({ ...request, updateIdentifier: 3 });
  first.markUncertain(3);
  first.markNotMerged(3);
  first.close();

  const second = new MergeRequestStore(path);
  assert.deepEqual(second.recoverMerging(), []);
  assert.equal(second.state(1), mergeStates.merged);
  assert.equal(second.state(2), mergeStates.failed);
  assert.equal(second.state(3), mergeStates.notMerged);
  assert.deepEqual(second.uncertain(), []);
  second.close();
});
