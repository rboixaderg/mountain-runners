import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TopicJobStore } from "./topic-job-store.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-topic-job-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "topic-jobs.sqlite");
}

const topicJob = {
  sessionKey: "-100123:7",
  branch: "feat/agent-first-1234",
  pullRequestNumber: 42,
};

test("keeps independent topic bindings across a restart", (context) => {
  const path = fixture(context);
  const first = new TopicJobStore(path);
  assert.equal(first.bindingOf(topicJob.sessionKey), null);
  assert.deepEqual(first.bind(topicJob), {
    branch: topicJob.branch,
    pullRequestNumber: 42,
  });
  first.bind({
    sessionKey: "-100123:8",
    branch: "feat/agent-second-5678",
    pullRequestNumber: 43,
  });
  first.close();

  const reopened = new TopicJobStore(path);
  context.after(() => reopened.close());
  assert.deepEqual(reopened.bindingOf(topicJob.sessionKey), {
    branch: topicJob.branch,
    pullRequestNumber: 42,
  });
  assert.deepEqual(reopened.bindingOf("-100123:8"), {
    branch: "feat/agent-second-5678",
    pullRequestNumber: 43,
  });
  assert.deepEqual(reopened.list(), [
    topicJob,
    {
      sessionKey: "-100123:8",
      branch: "feat/agent-second-5678",
      pullRequestNumber: 43,
    },
  ]);
});

test("repeated binding is idempotent and never replaces a topic's job", (context) => {
  const store = new TopicJobStore(fixture(context));
  context.after(() => store.close());
  store.bind(topicJob);
  assert.deepEqual(store.bind(topicJob), store.bindingOf(topicJob.sessionKey));
  assert.throws(() => store.bind({ ...topicJob, pullRequestNumber: 43 }));
  assert.throws(() => store.bind({ ...topicJob, branch: "feat/agent-other" }));
  assert.deepEqual(store.bindingOf(topicJob.sessionKey), {
    branch: topicJob.branch,
    pullRequestNumber: 42,
  });
});
