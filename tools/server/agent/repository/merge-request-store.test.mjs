import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mergeBeginResults, mergeStates } from "./merge-request-store.mjs";
import { InspectableMergeRequestStore } from "./test-support/merge-request-state.mjs";

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
  const store = new InspectableMergeRequestStore(fixture(context));
  assert.equal(store.begin(request), mergeBeginResults.begun);
  assert.equal(store.state(1), mergeStates.merging);
  assert.deepEqual(store.uncertain(), []);
  store.close();
});

test("never begins the same update twice", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  store.begin(request);
  store.markFailed(1);
  assert.equal(store.begin(request), mergeBeginResults.duplicate);
  store.close();
});

test("a pull request has at most one request that has not ended", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
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
  const store = new InspectableMergeRequestStore(fixture(context));
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
  const store = new InspectableMergeRequestStore(fixture(context));
  store.begin(request);
  assert.equal(store.markMerged(1, "b".repeat(40)), true);
  assert.equal(store.state(1), mergeStates.merged);
  assert.equal(store.markMerged(1, "c".repeat(40)), false);
  assert.equal(store.markFailed(1), false);
  assert.equal(store.markUncertain(1), false);
  store.close();
});

test("an uncertain request can still be closed as merged by reading the pull request", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  store.begin(request);
  store.markUncertain(1);
  assert.equal(store.uncertain().length, 1);
  assert.equal(store.markMerged(1, "b".repeat(40)), true);
  assert.deepEqual(store.uncertain(), []);
  store.close();
});

test("restart marks an interrupted merge uncertain and keeps it across restarts", (context) => {
  const path = fixture(context);
  const first = new InspectableMergeRequestStore(path);
  first.begin(request);
  first.close();

  const second = new InspectableMergeRequestStore(path);
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
  const store = new InspectableMergeRequestStore(fixture(context));
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
  const first = new InspectableMergeRequestStore(path);
  first.begin(request);
  first.begin({ ...request, updateIdentifier: 2, pullRequestNumber: 43 });
  first.markUncertain(2);
  first.recoverMerging();
  const [interrupted, answered] = first.uncertain();
  assert.equal(interrupted.notified_at, null);
  assert.notEqual(answered.notified_at, null);
  first.markNotified(1);
  first.close();

  const second = new InspectableMergeRequestStore(path);
  assert.ok(second.uncertain().every((row) => row.notified_at !== null));
  second.close();
});

test("restart never reopens a request that ended", (context) => {
  const path = fixture(context);
  const first = new InspectableMergeRequestStore(path);
  first.begin(request);
  first.markMerged(1, "b".repeat(40));
  first.begin({ ...request, updateIdentifier: 2 });
  first.markFailed(2);
  first.begin({ ...request, updateIdentifier: 3 });
  first.markUncertain(3);
  first.markNotMerged(3);
  first.close();

  const second = new InspectableMergeRequestStore(path);
  assert.deepEqual(second.recoverMerging(), []);
  assert.equal(second.state(1), mergeStates.merged);
  assert.equal(second.state(2), mergeStates.failed);
  assert.equal(second.state(3), mergeStates.notMerged);
  assert.deepEqual(second.uncertain(), []);
  second.close();
});

test("reports the newest request of one pull request, never of another", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  store.begin(request);
  store.markMerged(1, "b".repeat(40));
  store.begin({ ...request, updateIdentifier: 2, pullRequestNumber: 43 });

  const merged = store.latest({
    sessionKey: request.sessionKey,
    pullRequestNumber: request.pullRequestNumber,
  });
  assert.equal(merged.update_identifier, 1);
  assert.equal(merged.state, mergeStates.merged);
  assert.equal(merged.merge_commit_sha, "b".repeat(40));
  const second = store.latest({
    sessionKey: request.sessionKey,
    pullRequestNumber: 43,
  });
  assert.equal(second.update_identifier, 2);
  assert.equal(second.state, mergeStates.merging);
  store.markFailed(2);
  assert.equal(
    store.latest({ sessionKey: request.sessionKey, pullRequestNumber: 43 })
      .state,
    mergeStates.failed,
  );
  assert.equal(
    store.latest({ sessionKey: "-100999:4", pullRequestNumber: 42 }),
    undefined,
  );
  store.close();
});

const question = {
  sessionKey: request.sessionKey,
  questionMessageIdentifier: 900,
  noticeMessageIdentifier: 800,
  publicationUpdateIdentifier: 12,
  validationUpdateIdentifier: 20,
  authorIdentifier: request.authorIdentifier,
  pullRequestNumber: request.pullRequestNumber,
  commitSha: request.commitSha,
};

test("stores the question after a confirmed send and reads it within its topic", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  assert.equal(store.saveQuestion(question), true);

  const stored = store.question({
    sessionKey: question.sessionKey,
    questionMessageIdentifier: question.questionMessageIdentifier,
  });
  assert.equal(
    stored.notice_message_identifier,
    question.noticeMessageIdentifier,
  );
  assert.equal(stored.pull_request_number, question.pullRequestNumber);
  assert.equal(stored.commit_sha, question.commitSha);
  assert.equal(stored.author_identifier, question.authorIdentifier);
  assert.equal(stored.consumed_at, null);

  assert.equal(
    store.question({
      sessionKey: "-100999:4",
      questionMessageIdentifier: question.questionMessageIdentifier,
    }),
    undefined,
  );
  store.close();
});

test("one validation offers at most one question", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  store.saveQuestion(question);
  assert.equal(
    store.saveQuestion({ ...question, questionMessageIdentifier: 901 }),
    false,
  );
  assert.equal(
    store.question({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: 901,
    }),
    undefined,
  );
  assert.equal(
    store.saveQuestion({
      ...question,
      questionMessageIdentifier: 901,
      validationUpdateIdentifier: 21,
      noticeMessageIdentifier: question.noticeMessageIdentifier + 1,
    }),
    true,
  );
  store.close();
});

test("keeps one unanswered question per notice and person until it is retired", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  store.saveQuestion(question);
  const next = {
    ...question,
    questionMessageIdentifier: 901,
    validationUpdateIdentifier: 21,
  };
  assert.equal(store.saveQuestion(next), false);

  for (const other of [
    { authorIdentifier: question.authorIdentifier + 1 },
    { noticeMessageIdentifier: question.noticeMessageIdentifier + 1 },
    { sessionKey: "-100999:4" },
  ]) {
    store.retireQuestion({ ...question, ...other });
  }
  assert.notEqual(store.question(question), undefined);
  store.retireQuestion(question);
  assert.equal(store.question(question), undefined);
  assert.equal(store.saveQuestion(next), true);

  assert.equal(store.consumeQuestion(next), true);
  store.retireQuestion(next);
  assert.notEqual(store.question(next), undefined);
  store.close();
});

test("consumes the question once, for the person it was fixed to", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  store.saveQuestion(question);

  assert.equal(
    store.consumeQuestion({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: question.questionMessageIdentifier,
      authorIdentifier: question.authorIdentifier + 1,
    }),
    false,
  );
  assert.equal(
    store.question({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: question.questionMessageIdentifier,
    }).consumed_at,
    null,
  );

  assert.equal(
    store.consumeQuestion({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: question.questionMessageIdentifier,
      authorIdentifier: question.authorIdentifier,
    }),
    true,
  );
  assert.notEqual(
    store.question({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: question.questionMessageIdentifier,
    }).consumed_at,
    null,
  );
  assert.equal(
    store.consumeQuestion({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: question.questionMessageIdentifier,
      authorIdentifier: question.authorIdentifier,
    }),
    false,
  );
  store.close();
});

test("a restart keeps a consumed question consumed and a fresh one usable", (context) => {
  const path = fixture(context);
  const first = new InspectableMergeRequestStore(path);
  first.saveQuestion(question);
  first.consumeQuestion({
    sessionKey: question.sessionKey,
    questionMessageIdentifier: question.questionMessageIdentifier,
    authorIdentifier: question.authorIdentifier,
  });
  first.close();

  const second = new InspectableMergeRequestStore(path);
  const stored = second.question({
    sessionKey: question.sessionKey,
    questionMessageIdentifier: question.questionMessageIdentifier,
  });
  assert.notEqual(stored.consumed_at, null);
  assert.equal(
    second.consumeQuestion({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: question.questionMessageIdentifier,
      authorIdentifier: question.authorIdentifier,
    }),
    false,
  );
  assert.equal(
    second.saveQuestion({
      ...question,
      questionMessageIdentifier: 902,
      validationUpdateIdentifier: 22,
    }),
    true,
  );
  assert.equal(
    second.consumeQuestion({
      sessionKey: question.sessionKey,
      questionMessageIdentifier: 902,
      authorIdentifier: question.authorIdentifier,
    }),
    true,
  );
  second.close();
});

test("reports whether a merge of the pull request is open", (context) => {
  const store = new InspectableMergeRequestStore(fixture(context));
  assert.equal(store.hasOpenRequest(request.pullRequestNumber), false);
  store.begin(request);
  assert.equal(store.hasOpenRequest(request.pullRequestNumber), true);
  assert.equal(store.hasOpenRequest(request.pullRequestNumber + 1), false);
  store.markFailed(1);
  assert.equal(store.hasOpenRequest(request.pullRequestNumber), false);
  store.begin({ ...request, updateIdentifier: 2 });
  store.markUncertain(2);
  assert.equal(store.hasOpenRequest(request.pullRequestNumber), true);
  store.markNotMerged(2);
  assert.equal(store.hasOpenRequest(request.pullRequestNumber), false);
  store.close();
});
