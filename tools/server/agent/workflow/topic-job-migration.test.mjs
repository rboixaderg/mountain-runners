import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { TopicJobStore } from "../repository/topic-job-store.mjs";
import {
  createTopicJobMigration,
  topicJobMigrationReport,
} from "./topic-job-migration.mjs";

const sessionKey = "-100123:7";
const repositoryName = "example/project";

function fixture(context, states) {
  const directory = mkdtempSync(join(tmpdir(), "mr-job-migration-"));
  const topicJobs = new TopicJobStore(join(directory, "jobs.sqlite"));
  const ciWatches = new CiWatchStore(join(directory, "watches.sqlite"));
  context.after(() => {
    topicJobs.close();
    ciWatches.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const index of states.keys()) {
    ciWatches.add({
      updateIdentifier: index + 1,
      sessionKey,
      pullRequestNumber: index + 1,
      commitSha: "a".repeat(40),
    });
  }
  const github = {
    async getPullRequest({ number }) {
      if (states[number - 1] === "unreadable") throw new Error("unavailable");
      return {
        state: states[number - 1],
        headRef: `feat/agent-change-${number}`,
        headRepository: repositoryName,
        baseRef: "main",
      };
    },
  };
  return {
    topicJobs,
    migrate: createTopicJobMigration({
      topicJobs,
      ciWatches,
      github,
      repositoryName,
    }),
  };
}

test("binds the sole open service publication", async (context) => {
  const { topicJobs, migrate } = fixture(context, ["closed", "open"]);
  assert.equal(await migrate(sessionKey), null);
  assert.deepEqual(topicJobs.bindingOf(sessionKey), {
    branch: "feat/agent-change-2",
    pullRequestNumber: 2,
  });
  assert.equal(await migrate(sessionKey), null);
});

test("leaves a new topic unbound", async (context) => {
  const { topicJobs, migrate } = fixture(context, []);
  assert.equal(await migrate(sessionKey), null);
  assert.equal(topicJobs.bindingOf(sessionKey), null);
});

test("refuses ambiguous or unreadable publications without selecting work", async (context) => {
  for (const states of [
    ["open", "open"],
    ["open", "unreadable"],
    ["open", "unknown"],
  ]) {
    const { topicJobs, migrate } = fixture(context, states);
    assert.equal(await migrate(sessionKey), topicJobMigrationReport);
    assert.equal(topicJobs.bindingOf(sessionKey), null);
  }
});
