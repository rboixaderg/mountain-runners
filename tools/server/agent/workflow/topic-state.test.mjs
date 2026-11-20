import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { openIdentifierNames } from "../repository/identifiers.mjs";
import { MergeRequestStore } from "../repository/merge-request-store.mjs";
import {
  PreviewRequestStore,
  previewStates,
} from "../repository/preview-request-store.mjs";
import {
  buildTopicStateText,
  topicStateHeader,
} from "../policy/development.mjs";
import { createProjectRunner } from "./project-runner.mjs";
import { createInstructionRunner } from "./run-instruction.mjs";
import {
  createTopicPullRequestFinder,
  createTopicStateReader,
  createLiveTopicStateReader,
} from "./topic-state.mjs";

const executeFile = promisify(execFile);
const sessionKey = "-1001234567890:7";
const otherSessionKey = "-1009999999999:3";
const repositoryName = "rboixaderg/mountain-runners";
const reportedCommit = "a".repeat(40);
const newerCommit = "d".repeat(40);
const olderCommit = "b".repeat(40);
const mergeCommit = "c".repeat(40);
const previewOrigin = "https://pr-239.preview.mountainrunners.cat";
const authorIdentifier = 987654321;

/** The durable stores of one topic: real SQLite in a temporary directory. */
function storeFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-topic-state-"));
  const ciWatches = new CiWatchStore(join(directory, "ci-watch.sqlite"));
  const previewRequests = new PreviewRequestStore(
    join(directory, "preview-request.sqlite"),
  );
  const mergeRequests = new MergeRequestStore(
    join(directory, "merge-request.sqlite"),
  );
  context.after(() => {
    mergeRequests.close();
    previewRequests.close();
    ciWatches.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const findTopicPullRequest = createTopicPullRequestFinder(ciWatches);
  return {
    directory,
    ciWatches,
    previewRequests,
    mergeRequests,
    findTopicPullRequest,
    readTopicState: createTopicStateReader({
      ciWatches,
      previewRequests,
      mergeRequests,
      findTopicPullRequest,
      repositoryName,
    }),
  };
}

/** The service reported the required checks of a commit to a topic. */
function reportChecks(
  ciWatches,
  {
    topic = sessionKey,
    updateIdentifier = 500,
    pullRequestNumber = 239,
    commit = reportedCommit,
    result = "success",
  } = {},
) {
  ciWatches.add({
    updateIdentifier,
    sessionKey: topic,
    pullRequestNumber,
    commitSha: commit,
  });
  ciWatches.beginSend(updateIdentifier, result);
  ciWatches.finishSend(updateIdentifier);
}

function beginPreview(
  previewRequests,
  {
    updateIdentifier = 600,
    topic = sessionKey,
    pullRequestNumber = 239,
    commit = reportedCommit,
  } = {},
) {
  previewRequests.begin({
    updateIdentifier,
    sessionKey: topic,
    authorIdentifier: 42,
    pullRequestNumber,
    commitSha: commit,
  });
  previewRequests.markAwaiting(updateIdentifier, "2026-11-18T10:00:00Z");
}

function confirmPreview(
  previewRequests,
  {
    updateIdentifier = 600,
    topic = sessionKey,
    pullRequestNumber = 239,
    commit = reportedCommit,
    origin = previewOrigin,
  } = {},
) {
  beginPreview(previewRequests, {
    updateIdentifier,
    topic,
    pullRequestNumber,
    commit,
  });
  previewRequests.finish(updateIdentifier, previewStates.confirmed, origin);
}

test("reports an empty state for a topic that has published nothing", (context) => {
  const { readTopicState } = storeFixture(context);
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState, {
    pullRequest: null,
    lastReported: null,
    hasUnreportedWork: false,
    preview: null,
    merge: null,
  });
  const text = buildTopicStateText(topicState);
  assert.ok(text.startsWith(topicStateHeader));
  assert.match(text, /^- Pull request this turn works on: none yet\.$/mu);
  assert.match(text, /^- Latest preview request for it: none yet\.$/mu);
});

test("reports the pull request and the green checks of the reported commit", (context) => {
  const { ciWatches, readTopicState } = storeFixture(context);
  reportChecks(ciWatches);
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.pullRequest, {
    url: "https://github.com/rboixaderg/mountain-runners/pull/239",
    fromAnotherTopic: false,
    isClosed: false,
    isMerged: false,
  });
  assert.deepEqual(topicState.lastReported, {
    commit: reportedCommit,
    description: "green",
  });
  assert.equal(topicState.hasUnreportedWork, false);
  const text = buildTopicStateText(topicState);
  assert.match(
    text,
    /^- Last commit reported for it: aaaaaaa; required checks: green\.$/mu,
  );
  assert.match(
    text,
    /^- Work newer than that report is still being checked: no\.$/mu,
  );
});

test("says that newer work is still being checked", (context) => {
  const { ciWatches, readTopicState } = storeFixture(context);
  reportChecks(ciWatches);
  ciWatches.add({
    updateIdentifier: 501,
    sessionKey,
    pullRequestNumber: 239,
    commitSha: newerCommit,
  });
  const topicState = readTopicState(sessionKey);

  assert.equal(topicState.hasUnreportedWork, true);
  assert.deepEqual(topicState.lastReported, {
    commit: reportedCommit,
    description: "green",
  });
  assert.match(
    buildTopicStateText(topicState),
    /^- Work newer than that report is still being checked: yes\.$/mu,
  );
});

test("says the pull request is closed when the last report says so", (context) => {
  const { ciWatches, readTopicState } = storeFixture(context);
  reportChecks(ciWatches, { result: "pull-request-closed" });
  const topicState = readTopicState(sessionKey);

  assert.equal(topicState.pullRequest.isClosed, true);
  assert.deepEqual(topicState.lastReported, {
    commit: reportedCommit,
    description: "not reported, because the pull request is closed",
  });
  assert.match(
    buildTopicStateText(topicState),
    /\(the last report says it is closed\)/u,
  );
});

test("shows the preview URL the publisher confirmed for the reported commit", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches);
  confirmPreview(previewRequests);
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.preview, {
    description: "confirmed",
    origin: previewOrigin,
  });
  assert.match(
    buildTopicStateText(topicState),
    /^- Latest preview request for it: confirmed, URL https:\/\/pr-239\.preview\.mountainrunners\.cat\.$/mu,
  );
});

test("shows the confirmed URL while a newer request for the same commit waits", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches);
  confirmPreview(previewRequests);
  beginPreview(previewRequests, { updateIdentifier: 601 });
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.preview, {
    description: "confirmed",
    origin: previewOrigin,
  });
});

test("hides a preview URL confirmed before a newer publication of the topic", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches, { updateIdentifier: 500, commit: olderCommit });
  confirmPreview(previewRequests, {
    updateIdentifier: 600,
    commit: olderCommit,
  });
  // The topic publishes a newer commit afterwards: its notice is the one the
  // block prints, so the confirmed preview describes an earlier change.
  reportChecks(ciWatches, { updateIdentifier: 601, commit: reportedCommit });
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.preview, {
    description:
      "confirmed for an earlier change, so this block holds no URL for the reported commit",
    origin: null,
  });
  const text = buildTopicStateText(topicState);
  assert.doesNotMatch(text, /pr-239\.preview/u);
});

test("shows the URL of a preview pinned to a head newer than the reported commit", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches, { updateIdentifier: 500 });
  // A maintainer updated the pull request on GitHub, and the request was pinned
  // to that head: it belongs to the change the block prints.
  confirmPreview(previewRequests, {
    updateIdentifier: 600,
    commit: newerCommit,
  });
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.preview, {
    description: "confirmed",
    origin: previewOrigin,
  });
  assert.match(
    buildTopicStateText(topicState),
    /^- Latest preview request for it: confirmed, URL https:\/\/pr-239\.preview\.mountainrunners\.cat\.$/mu,
  );
});

test("reports a preview request that ran out of its deadline", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches);
  beginPreview(previewRequests);
  previewRequests.finish(600, previewStates.timedOut);
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.preview, {
    description: "not confirmed in time",
    origin: null,
  });
  assert.match(
    buildTopicStateText(topicState),
    /^- Latest preview request for it: not confirmed in time\.$/mu,
  );
});

test("reports a preview that a run ended as failed, without a URL", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches);
  // The preview workflow ran and failed: the worker ends the request as `failed`
  // and never stores an origin.
  beginPreview(previewRequests);
  previewRequests.finish(600, previewStates.failed);
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.preview, {
    description: "the preview failed",
    origin: null,
  });
  const text = buildTopicStateText(topicState);
  assert.match(
    text,
    /^- Latest preview request for it: the preview failed\.$/mu,
  );
  assert.equal(text.includes("preview.mountainrunners.cat"), false);
});

test("reports a merge that already happened next to the pull request", (context) => {
  const { ciWatches, mergeRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches);
  mergeRequests.begin({
    updateIdentifier: 700,
    sessionKey,
    authorIdentifier: 42,
    pullRequestNumber: 239,
    commitSha: reportedCommit,
  });
  mergeRequests.markMerged(700, mergeCommit);
  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.merge, {
    description: "merged",
    mergeCommit,
  });
  assert.equal(topicState.pullRequest.isMerged, true);
  const text = buildTopicStateText(topicState);
  assert.match(text, /\(the merge request says it is merged\)/u);
  assert.match(
    text,
    /^- Latest merge request for it: merged \(merge commit ccccccc\)\.$/mu,
  );
});

test("reports another topic's pull request while a continuation has not taken it over", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  reportChecks(ciWatches, {
    topic: otherSessionKey,
    pullRequestNumber: 239,
  });
  confirmPreview(previewRequests, { topic: otherSessionKey });

  const continued = readTopicState(sessionKey, {
    continuedPullRequestNumber: 239,
  });
  assert.deepEqual(continued.pullRequest, {
    url: "https://github.com/rboixaderg/mountain-runners/pull/239",
    fromAnotherTopic: true,
    isClosed: false,
    isMerged: false,
  });
  assert.deepEqual(continued.lastReported, {
    commit: reportedCommit,
    description: "green",
  });
  assert.equal(continued.preview.origin, previewOrigin);
  assert.match(
    buildTopicStateText(continued),
    /\(it comes from another topic, which owns it until this topic publishes a commit\)/u,
  );

  const owned = readTopicState(otherSessionKey, {
    continuedPullRequestNumber: 239,
  });
  assert.equal(owned.pullRequest.fromAnotherTopic, false);
});

test("describes only the pull request it prints, never an earlier one of the topic", (context) => {
  const { ciWatches, previewRequests, mergeRequests, readTopicState } =
    storeFixture(context);
  // The topic closed, merged and previewed an earlier pull request.
  reportChecks(ciWatches, {
    updateIdentifier: 500,
    pullRequestNumber: 239,
    result: "pull-request-closed",
  });
  confirmPreview(previewRequests, { pullRequestNumber: 239 });
  mergeRequests.begin({
    updateIdentifier: 700,
    sessionKey,
    authorIdentifier: 42,
    pullRequestNumber: 239,
    commitSha: reportedCommit,
  });
  mergeRequests.markMerged(700, mergeCommit);
  // It later published another pull request with green checks.
  reportChecks(ciWatches, {
    updateIdentifier: 501,
    pullRequestNumber: 245,
    commit: newerCommit,
  });

  const topicState = readTopicState(sessionKey);

  assert.deepEqual(topicState.pullRequest, {
    url: "https://github.com/rboixaderg/mountain-runners/pull/245",
    fromAnotherTopic: false,
    isClosed: false,
    isMerged: false,
  });
  assert.deepEqual(topicState.lastReported, {
    commit: newerCommit,
    description: "green",
  });
  assert.equal(topicState.preview, null);
  assert.equal(topicState.merge, null);
  const text = buildTopicStateText(topicState);
  assert.match(
    text,
    /^- Pull request this turn works on: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/245\.$/mu,
  );
  assert.doesNotMatch(text, /pull\/239|pr-239\.preview|closed|merged/u);
});

test("says that the link of a confirmed preview is not stored", (context) => {
  const { ciWatches, previewRequests, readTopicState, directory } =
    storeFixture(context);
  reportChecks(ciWatches);
  // A confirmation stored before the origin was kept: the state is confirmed
  // for the reported commit, but the URL was never written. Ending a request as
  // confirmed now always carries its origin, so the legacy row is written
  // directly.
  beginPreview(previewRequests);
  const legacy = new DatabaseSync(join(directory, "preview-request.sqlite"));
  legacy
    .prepare(
      "UPDATE preview_requests SET state = ? WHERE update_identifier = ?",
    )
    .run(previewStates.confirmed, 600);
  legacy.close();

  const topicState = readTopicState(sessionKey);
  assert.deepEqual(topicState.preview, {
    description: "confirmed, but its link is not stored",
    origin: null,
  });
  assert.match(
    buildTopicStateText(topicState),
    /^- Latest preview request for it: confirmed, but its link is not stored\.$/mu,
  );
});

test("looks up only the newest publication of each topic", (context) => {
  const { ciWatches, findTopicPullRequest } = storeFixture(context);
  reportChecks(ciWatches, { updateIdentifier: 500, pullRequestNumber: 239 });
  reportChecks(ciWatches, { updateIdentifier: 501, pullRequestNumber: 245 });
  reportChecks(ciWatches, {
    topic: otherSessionKey,
    updateIdentifier: 502,
    pullRequestNumber: 246,
  });

  assert.equal(findTopicPullRequest(sessionKey), 245);
  assert.equal(findTopicPullRequest(otherSessionKey), 246);
  assert.equal(findTopicPullRequest("-1000000000000:1"), null);
});

test("describes a state that was added after this block was written", (context) => {
  const { ciWatches, readTopicState } = storeFixture(context);
  reportChecks(ciWatches, { result: "a-state-from-a-later-change" });

  const topicState = readTopicState(sessionKey);
  assert.equal(
    topicState.lastReported.description,
    "reported as a-state-from-a-later-change",
  );
});

async function git(directory, argumentsList) {
  const { stdout } = await executeFile("git", [
    "-C",
    directory,
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.test",
    ...argumentsList,
  ]);
  return stdout.trim();
}

/**
 * One temporary repository plus the durable stores of the service: the state a
 * real turn reads, without GitHub, Telegram or a model.
 */
async function turnFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-topic-state-turn-"));
  const origin = join(directory, "origin.git");
  const repository = join(directory, "repository");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  const paths = {
    repository: realpathSync(repository),
    worktrees: join(directory, "worktrees"),
    state: join(directory, "state"),
  };

  const ciWatches = new CiWatchStore(join(directory, "ci-watch.sqlite"));
  const previewRequests = new PreviewRequestStore(
    join(directory, "preview-request.sqlite"),
  );
  const mergeRequests = new MergeRequestStore(
    join(directory, "merge-request.sqlite"),
  );
  context.after(() => {
    mergeRequests.close();
    previewRequests.close();
    ciWatches.close();
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  return {
    paths,
    identifiers: openIdentifierNames(paths.state),
    config: {
      telegram: { botToken: "telegram-synthetic-token" },
      github: {
        token: "github-synthetic-token",
        repository: repositoryName,
        requiredChecks: ["Validate"],
      },
      model: {
        sandboxImage: "mountain-agent-pi:1.5.0",
        providerEnvironmentVariables: [],
      },
      paths,
      limits: {
        executionTimeoutMs: 60000,
        sandboxProcessLimit: 64,
        sandboxMemoryMegabytes: 256,
        sandboxCpuCount: 1,
      },
    },
    ciWatches,
    previewRequests,
    mergeRequests,
  };
}

/** The prompt the injected runtime would send, in the order the adapter does. */
function promptOf(options) {
  const serviceNotes = options.claimServiceNotes();
  options.onPromptSent();
  return options.buildMessage(serviceNotes);
}

/** The state block a turn of the fixture receives, written out by hand. */
const expectedStateBlock = [
  topicStateHeader,
  "- Pull request: https://github.com/rboixaderg/mountain-runners/pull/239; open.",
  "- Current head: aaaaaaa; required checks: success.",
  `- Preview: confirmed, URL ${previewOrigin}.`,
].join("\n");

test("a consultation and an implementation receive the state of the topic", async (context) => {
  const fixture = await turnFixture(context);
  reportChecks(fixture.ciWatches);
  confirmPreview(fixture.previewRequests);

  const prompts = [];
  let kind = "consultation";
  const runner = createProjectRunner({
    config: fixture.config,
    ciWatches: fixture.ciWatches,
    previewRequests: fixture.previewRequests,
    mergeRequests: fixture.mergeRequests,
    github: {
      async getPullRequest() {
        return { state: "open", merged: false, headSha: reportedCommit };
      },
      async getCommitCheckRuns() {
        return [
          { name: "Validate", status: "completed", conclusion: "success" },
        ];
      },
      async getCommitStatuses() {
        return [];
      },
      async listIssueComments() {
        return [
          {
            user: { login: "github-actions[bot]" },
            body: `<!-- mountain-runners-preview -->\nPreview publicada: ${previewOrigin}\nCommit: \`${reportedCommit}\`.`,
            updated_at: "2026-11-18T10:05:00Z",
          },
        ];
      },
    },
    classifyRequest: async () => ({ kind }),
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      prompts.push(promptOf(options));
      return { text: "Resposta sintètica." };
    },
  });

  await runner({
    updateIdentifier: 1101,
    messageIdentifier: 2101,
    sessionKey,
    authorIdentifier,
    instruction: "què ha passat amb la preview?",
  });
  kind = "implementation";
  await runner({
    updateIdentifier: 1102,
    messageIdentifier: 2102,
    sessionKey,
    authorIdentifier,
    instruction: "afegeix una prova sintètica",
  });

  assert.equal(prompts.length, 2);
  for (const prompt of prompts) {
    assert.ok(
      prompt.includes(expectedStateBlock),
      "the prompt carries the state block",
    );
    assert.ok(
      prompt.indexOf(topicStateHeader) < prompt.indexOf("Request:"),
      "the state block comes before the request",
    );
    assert.equal(prompt.includes(sessionKey), false);
    assert.equal(prompt.includes("-1001234567890"), false);
    assert.equal(prompt.includes(String(authorIdentifier)), false);
  }
});

test("a turn continues without the block when the state cannot be read", async (context) => {
  const fixture = await turnFixture(context);
  const events = [];
  const turns = [];
  const runner = createInstructionRunner({
    repositoryPath: fixture.paths.repository,
    worktreeRoot: fixture.paths.worktrees,
    identifiers: fixture.identifiers,
    classifyRequest: async () => ({ kind: "consultation" }),
    runModel: async (modelRequest) => {
      turns.push(modelRequest);
      return { text: "Resposta sintètica." };
    },
    readTopicState: () => {
      throw new TypeError("the state is unreadable");
    },
    logger: (event, detail) => events.push({ event, detail }),
  });

  const result = await runner({
    updateIdentifier: 1201,
    messageIdentifier: 2201,
    sessionKey,
    authorIdentifier: 42,
    instruction: "què ha passat amb la preview?",
  });

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "Resposta sintètica.");
  assert.deepEqual(events, [
    { event: "topic_state_failed", detail: "TypeError" },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(
    turns[0].topicState,
    null,
    "the turn runs without the state block",
  );
});

test("never reports the preview of an earlier change as the state of the report", (context) => {
  const { ciWatches, previewRequests, readTopicState } = storeFixture(context);
  // The previous commit of the pull request was previewed and is still awaiting
  // the publisher; a newer publication of the topic is reported afterwards.
  reportChecks(ciWatches, { updateIdentifier: 500, commit: olderCommit });
  beginPreview(previewRequests, { updateIdentifier: 600, commit: olderCommit });
  reportChecks(ciWatches, { updateIdentifier: 601, commit: reportedCommit });

  assert.equal(readTopicState(sessionKey).preview, null);
});

test("gives the classifier only a pull request the topic can continue", (context) => {
  const { ciWatches, mergeRequests } = storeFixture(context);
  reportChecks(ciWatches, { result: "pull-request-closed" });
  const openOnly = createTopicPullRequestFinder(ciWatches, {
    includeEnded: false,
    mergeRequests,
  });

  // The state block still describes the change; the classifier does not receive
  // a closed pull request as the topic's active one.
  assert.equal(openOnly(sessionKey), null);
  assert.equal(
    createTopicPullRequestFinder(ciWatches)(sessionKey),
    ciWatches.latestPublications()[0].pull_request_number,
  );
});

test("gives the classifier no pull request that is already merged", (context) => {
  const { ciWatches, mergeRequests } = storeFixture(context);
  reportChecks(ciWatches);
  mergeRequests.begin({
    updateIdentifier: 700,
    sessionKey,
    authorIdentifier: 42,
    pullRequestNumber: 239,
    commitSha: reportedCommit,
  });
  mergeRequests.markMerged(700, mergeCommit);
  const openOnly = createTopicPullRequestFinder(ciWatches, {
    includeEnded: false,
    mergeRequests,
  });

  assert.equal(openOnly(sessionKey), null);
});

test("live topic state recovers from stale reports and fails closed on a read error", async (context) => {
  const { ciWatches, previewRequests, findTopicPullRequest } =
    storeFixture(context);
  reportChecks(ciWatches, { result: "repairing" });
  let unavailable = false;
  const github = {
    async getPullRequest() {
      if (unavailable) throw new Error("network");
      return { state: "open", merged: false, headSha: newerCommit };
    },
    async getCommitCheckRuns() {
      return [{ name: "Validate", status: "completed", conclusion: "success" }];
    },
    async getCommitStatuses() {
      return [];
    },
  };
  const read = createLiveTopicStateReader({
    ciWatches,
    previewRequests,
    findTopicPullRequest,
    repositoryName,
    github,
    requiredChecks: ["Validate"],
  });
  const state = await read(sessionKey);
  assert.equal(state.liveState.head, newerCommit);
  assert.equal(state.liveState.checks, "success");
  assert.match(
    buildTopicStateText(state),
    /Current head: ddddddd; required checks: success/u,
  );
  unavailable = true;
  const failed = await read(sessionKey);
  assert.deepEqual(failed, { liveState: { unavailable: true } });
  assert.match(buildTopicStateText(failed), /cannot check right now/u);
});
