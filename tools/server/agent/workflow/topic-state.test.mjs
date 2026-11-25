import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { openIdentifierNames } from "../repository/identifiers.mjs";
import { MergeRequestStore } from "../repository/merge-request-store.mjs";
import {
  buildTopicStateText,
  topicStateHeader,
} from "../policy/development.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { createLiveTopicStateReader } from "./topic-state.mjs";

const executeFile = promisify(execFile);
const sessionKey = "-1001234567890:7";
const otherSessionKey = "-1009999999999:3";
const repositoryName = "rboixaderg/mountain-runners";
const reportedCommit = "a".repeat(40);
const newerCommit = "d".repeat(40);
const mergeCommit = "c".repeat(40);
const previewOrigin = "https://pr-239.preview.mountainrunners.cat";
const authorIdentifier = 987654321;

/** The durable stores of one topic: real SQLite in a temporary directory. */
function storeFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-topic-state-"));
  const ciWatches = new CiWatchStore(join(directory, "ci-watch.sqlite"));
  const mergeRequests = new MergeRequestStore(
    join(directory, "merge-request.sqlite"),
  );
  context.after(() => {
    mergeRequests.close();
    ciWatches.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    ciWatches,
    mergeRequests,
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
  ciWatches.finishSend(updateIdentifier, result);
}

function labeledPullRequest(headSha = reportedCommit) {
  return {
    state: "open",
    merged: false,
    headSha,
    previewLabeled: true,
    previewRevoked: false,
  };
}

function publisherComment(commit) {
  return {
    user: { login: "github-actions[bot]" },
    body: `<!-- mountain-runners-preview -->\nPreview publicada: ${previewOrigin}\nCommit: \`${commit}\`.`,
    updated_at: "2026-11-18T10:05:00Z",
  };
}

/**
 * GitHub as the live reader sees it: green checks, the publisher's comment for
 * the reported commit and every call recorded in order.
 */
function liveGithub({
  pullRequest,
  comments = [publisherComment(reportedCommit)],
}) {
  const calls = [];
  return {
    calls,
    async getPullRequest() {
      calls.push("getPullRequest");
      return pullRequest;
    },
    async getCommitCheckRuns() {
      return [{ name: "Validate", status: "completed", conclusion: "success" }];
    },
    async getCommitStatuses() {
      return [];
    },
    async listIssueComments() {
      calls.push("listIssueComments");
      return comments;
    },
  };
}

test("looks up only the newest publication of each topic", (context) => {
  const { ciWatches } = storeFixture(context);
  reportChecks(ciWatches, { updateIdentifier: 500, pullRequestNumber: 239 });
  reportChecks(ciWatches, { updateIdentifier: 501, pullRequestNumber: 245 });
  reportChecks(ciWatches, {
    topic: otherSessionKey,
    updateIdentifier: 502,
    pullRequestNumber: 246,
  });

  assert.equal(ciWatches.topicPullRequestNumber(sessionKey), 245);
  assert.equal(ciWatches.topicPullRequestNumber(otherSessionKey), 246);
  assert.equal(ciWatches.topicPullRequestNumber("-1000000000000:1"), null);
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
  const mergeRequests = new MergeRequestStore(
    join(directory, "merge-request.sqlite"),
  );
  context.after(() => {
    mergeRequests.close();
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
        providerEnvironment: {},
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
  "- Work newer than the last report is still being checked: no.",
  `- Preview: confirmed, URL ${previewOrigin}.`,
  "- Latest merge request for it: none yet.",
].join("\n");

test("a consultation and an implementation receive the state of the topic", async (context) => {
  const fixture = await turnFixture(context);
  // No preview request is stored: the label and the publisher's comment for
  // the head are the whole preview state.
  reportChecks(fixture.ciWatches);

  const prompts = [];
  const runner = createTestProjectRunner({
    config: fixture.config,
    ciWatches: fixture.ciWatches,
    mergeRequests: fixture.mergeRequests,
    github: liveGithub({ pullRequest: labeledPullRequest() }),
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
  const runner = createTestProjectRunner({
    config: fixture.config,
    github: liveGithub({ pullRequest: labeledPullRequest() }),
    ciWatches: {
      topicPullRequestNumber() {
        throw new TypeError("the state is unreadable");
      },
    },
    runModel: async (modelRequest) => {
      turns.push(modelRequest);
      return { text: "Resposta sintètica." };
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

const previewCases = [
  [
    "a closed pull request has no preview",
    { ...labeledPullRequest(), state: "closed" },
    { preview: "none: the pull request is not open", origin: null },
  ],
  [
    "a revoked preview keeps no address, even with the label",
    { ...labeledPullRequest(), previewRevoked: true },
    { preview: "revoked by a maintainer", origin: null },
  ],
  [
    "a pull request without the label has no preview",
    { ...labeledPullRequest(), previewLabeled: false },
    { preview: "none: the pull request has no preview label", origin: null },
  ],
  [
    "a head the publisher has not confirmed yet has no address",
    labeledPullRequest(newerCommit),
    { preview: "not confirmed by the publisher yet", origin: null },
  ],
];

for (const [name, pullRequest, expected] of previewCases) {
  test(`live topic state: ${name}`, async (context) => {
    const { ciWatches, mergeRequests } = storeFixture(context);
    reportChecks(ciWatches);
    const read = createLiveTopicStateReader({
      ciWatches,
      mergeRequests,
      repositoryName,
      github: liveGithub({ pullRequest }),
      requiredChecks: ["Validate"],
    });

    const { liveState } = await read(sessionKey);

    assert.equal(liveState.preview, expected.preview);
    assert.equal(liveState.origin, expected.origin);
  });
}

test("live topic state confirms the preview of a head pushed outside the service", async (context) => {
  const { ciWatches, mergeRequests } = storeFixture(context);
  reportChecks(ciWatches);
  // A maintainer pushed a newer head to the labeled pull request: no request of
  // the topic exists, and the publisher's comment for that head is the source.
  const github = liveGithub({
    pullRequest: labeledPullRequest(newerCommit),
    comments: [publisherComment(reportedCommit), publisherComment(newerCommit)],
  });
  const read = createLiveTopicStateReader({
    ciWatches,
    mergeRequests,
    repositoryName,
    github,
    requiredChecks: ["Validate"],
  });

  const state = await read(sessionKey);

  assert.equal(state.liveState.preview, "confirmed");
  assert.equal(state.liveState.origin, previewOrigin);
  assert.match(
    buildTopicStateText(state),
    /Current head: ddddddd[^\n]*\n[^\n]*\n- Preview: confirmed, URL https:\/\/pr-239\.preview\.mountainrunners\.cat\./u,
  );
  assert.deepEqual(
    github.calls,
    ["getPullRequest", "getPullRequest", "listIssueComments", "getPullRequest"],
    "the comments are read before the confirming read of the pull request",
  );
});

test("live topic state recovers from stale reports and fails closed on a read error", async (context) => {
  const { ciWatches, mergeRequests } = storeFixture(context);
  reportChecks(ciWatches, { result: "repairing" });
  let unavailable = false;
  const events = [];
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
    async listIssueComments() {
      return [];
    },
  };
  const read = createLiveTopicStateReader({
    ciWatches,
    mergeRequests,
    repositoryName,
    github,
    requiredChecks: ["Validate"],
    logger: (event) => events.push(event),
  });
  const state = await read(sessionKey);
  assert.equal(state.liveState.head, newerCommit);
  assert.equal(state.liveState.checks, "success");
  assert.match(
    buildTopicStateText(state),
    /Current head: ddddddd; required checks: success/u,
  );
  ciWatches.add({
    updateIdentifier: 501,
    sessionKey,
    pullRequestNumber: 239,
    commitSha: newerCommit,
  });
  mergeRequests.begin({
    updateIdentifier: 700,
    sessionKey,
    authorIdentifier: 42,
    pullRequestNumber: 239,
    commitSha: reportedCommit,
  });
  mergeRequests.markMerged(700, mergeCommit);
  const withWork = await read(sessionKey);
  assert.equal(withWork.liveState.hasUnreportedWork, true);
  assert.deepEqual(withWork.liveState.merge, {
    description: "merged",
    mergeCommit,
  });
  assert.match(
    buildTopicStateText(withWork),
    /Work newer than the last report is still being checked: yes/u,
  );
  assert.match(
    buildTopicStateText(withWork),
    /Latest merge request for it: merged \(merge commit ccccccc\)/u,
  );
  unavailable = true;
  const failed = await read(sessionKey);
  assert.deepEqual(failed, { liveState: { unavailable: true } });
  assert.match(buildTopicStateText(failed), /cannot check right now/u);
  assert.deepEqual(events, ["topic_state_failed"]);
});
