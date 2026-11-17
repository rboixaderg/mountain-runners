import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyMembership } from "telegram-pi-bridge/telegram";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { GitHubResponseError } from "../repository/github.mjs";
import { MergeRequestStore } from "../repository/merge-request-store.mjs";
import { requestSignal } from "../repository/request-signal.mjs";
import { createMergeRequests, parseMergeCommand } from "./merge-request.mjs";

const repository = "rboixaderg/mountain-runners";
const groupIdentifier = "-1001234567890";
const commit = "a".repeat(40);
const mergeCommit = "b".repeat(40);
const sessionKey = "-1001234567890:7";

function fixture(context, { now } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mr-merge-request-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const ciWatches = new CiWatchStore(join(directory, "ci-watch.sqlite"), {
    now,
  });
  const merges = new MergeRequestStore(join(directory, "merge.sqlite"));
  context.after(() => {
    ciWatches.close();
    merges.close();
  });
  return { directory, ciWatches, merges };
}

function report(
  ciWatches,
  { updateIdentifier = 10, result = "success", commitSha = commit } = {},
) {
  ciWatches.add({
    updateIdentifier,
    sessionKey,
    pullRequestNumber: 200,
    commitSha,
  });
  ciWatches.beginSend(updateIdentifier, result);
  ciWatches.finishSend(updateIdentifier);
}

function fakeGithub(state = {}) {
  const github = {
    merges: [],
    reads: 0,
    checkReads: 0,
    pullRequest: openPullRequest(),
    pullRequestSequence: null,
    // The pull requests of a scenario with more than one published pull request.
    pullRequests: null,
    checkRuns: [
      { name: "Validate", status: "completed", conclusion: "success" },
    ],
    statuses: [],
    readError: null,
    mergeError: null,
    mergeResponse: { mergeCommitSha: mergeCommit },
    beforeMerge: null,
    ...state,
    async getPullRequest({ number }) {
      github.reads += 1;
      if (github.readError) throw github.readError;
      if (github.pullRequestSequence) {
        return github.pullRequestSequence.shift() ?? github.pullRequest;
      }
      if (github.pullRequests !== null) {
        return github.pullRequests[number];
      }
      assert.equal(number, 200, "only the bound pull request may be read");
      return github.pullRequest;
    },
    async getCommitCheckRuns() {
      github.checkReads += 1;
      return github.checkRuns;
    },
    async getCommitStatuses() {
      return github.statuses;
    },
    async mergePullRequest({ number, sha }) {
      if (github.pullRequests === null) {
        assert.equal(number, 200, "only the bound pull request may be merged");
      }
      github.beforeMerge?.();
      github.merges.push({ number, sha });
      if (github.mergeError) throw github.mergeError;
      return github.mergeResponse;
    },
  };
  return github;
}

function openPullRequest(overrides = {}) {
  return {
    state: "open",
    headSha: commit,
    headRepository: repository,
    draft: false,
    baseRef: "main",
    mergeableState: "clean",
    merged: false,
    mergeCommitSha: null,
    ...overrides,
  };
}

function mergedPullRequest() {
  return openPullRequest({
    state: "closed",
    merged: true,
    mergeCommitSha: mergeCommit,
  });
}

function setup(context, { github = fakeGithub(), now } = {}) {
  const { ciWatches, merges } = fixture(context, { now });
  const sent = [];
  const traces = [];
  const membership = {
    result: { verified: true, status: "member" },
    calls: [],
  };
  const newerWork = { value: false, calls: [] };
  const telegram = {
    sendError: null,
    async sendMessage(message) {
      if (telegram.sendError) throw telegram.sendError;
      sent.push(message);
    },
  };
  function buildHandler(overrides = {}) {
    return createMergeRequests({
      store: merges,
      reportedCommits: ciWatches,
      hasNewerWork: (query) => {
        newerWork.calls.push(query);
        return newerWork.value;
      },
      verifyMembership: async (authorIdentifier) => {
        membership.calls.push(authorIdentifier);
        return membership.result;
      },
      github,
      repository,
      requiredChecks: ["Validate"],
      telegram,
      retryDelayMilliseconds: 0,
      recordTrace: (entry) => traces.push(entry),
      ...overrides,
    });
  }
  return {
    ciWatches,
    merges,
    github,
    telegram,
    membership,
    newerWork,
    handler: buildHandler(),
    buildHandler,
    sent,
    traces,
  };
}

function request(updateIdentifier = 20) {
  return {
    updateIdentifier,
    sessionKey,
    authorIdentifier: 555,
    instruction: "/merge",
  };
}

const bareCommand = { valid: true };

function actions(traces) {
  return traces.map((entry) => entry.action);
}

test("recognises exactly the three merge forms", () => {
  assert.deepEqual(parseMergeCommand("/merge"), { valid: true });
  assert.deepEqual(parseMergeCommand("  /merge  "), { valid: true });
  assert.deepEqual(parseMergeCommand("/merge 12"), {
    valid: true,
    pullRequestNumber: 12,
    commit: undefined,
  });
  assert.deepEqual(parseMergeCommand("/merge #12"), {
    valid: true,
    pullRequestNumber: 12,
    commit: undefined,
  });
  assert.deepEqual(parseMergeCommand(`/merge 12 ${commit}`), {
    valid: true,
    pullRequestNumber: 12,
    commit,
  });
  // The mention the bridge strips can leave a doubled space behind.
  assert.deepEqual(parseMergeCommand("/merge  12"), {
    valid: true,
    pullRequestNumber: 12,
    commit: undefined,
  });
});

test("never treats prose as a merge and rejects any other shape of the command", () => {
  for (const prose of [
    "fusiona-la",
    "ho pots fusionar?",
    "please /merge 12",
    "merge",
    "/preview",
  ]) {
    assert.equal(parseMergeCommand(prose), null, prose);
  }
  for (const invalid of [
    "/merge now",
    "/merge 12 please",
    "/merge 12\n13",
    "/merge\n12",
    "/merge 0",
    "/merge -3",
    "/merge 1.5",
    "/merge 99999999999999999999",
    "/merge 12 abc1234",
    `/merge 12 ${"a".repeat(41)}`,
    `/merge 12 ${"A".repeat(40)}`,
    `/merge ${commit}`,
    `/merge 12 ${commit} extra`,
    "/mergeall",
    "/merge #",
  ]) {
    assert.deepEqual(parseMergeCommand(invalid), { valid: false }, invalid);
  }
});

test("merges the reported green commit and records it before the call", async (context) => {
  const { ciWatches, handler, github, merges, traces, membership } =
    setup(context);
  report(ciWatches);
  let stateDuringMerge;
  github.beforeMerge = () => {
    stateDuringMerge = merges.state(20);
  };

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.equal(
    result.report,
    "PR #200 fusionada (squash). Commit de merge bbbbbbb.",
  );
  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
  assert.equal(stateDuringMerge, "merging");
  assert.equal(merges.state(20), "merged");
  assert.deepEqual(membership.calls, [555]);
  assert.deepEqual(actions(traces), [
    "merge_membership_verified",
    "merge_requested",
    "merge_completed",
  ]);
  assert.equal(traces[0].authorIdentifier, 555);
  assert.equal(traces[0].sessionKey, sessionKey);
  assert.equal(traces[0].detail, "#200 aaaaaaa");
  assert.equal(traces[1].detail, "#200 aaaaaaa");
  assert.equal(traces[2].authorIdentifier, 555);
  assert.equal(traces[2].updateIdentifier, 20);
  assert.equal(traces[2].detail, `#200 ${commit} squash ${mergeCommit}`);
});

for (const [name, command] of [
  ["the number", { valid: true, pullRequestNumber: 200 }],
  [
    "the number with the pinned commit",
    { valid: true, pullRequestNumber: 200, commit },
  ],
]) {
  test(`accepts ${name}`, async (context) => {
    const { ciWatches, handler, github } = setup(context);
    report(ciWatches);

    const result = await handler.handle(request(), command);

    assert.match(result.report, /fusionada/u);
    assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
  });
}

test("resolves the pull request from the last delivered notice of the topic", async (context) => {
  const { ciWatches, handler, github } = setup(context);
  report(ciWatches, { updateIdentifier: 10 });
  ciWatches.add({
    updateIdentifier: 11,
    sessionKey,
    pullRequestNumber: 200,
    commitSha: "c".repeat(40),
  });
  ciWatches.beginSend(11, "failure");
  ciWatches.finishSend(11);

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /no deia que les comprovacions/u);
  assert.deepEqual(github.merges, []);
});

test("refuses a command that is not one of the accepted forms", async (context) => {
  const { handler, github, traces, membership } = setup(context);

  const result = await handler.handle(request(), { valid: false });

  assert.match(result.report, /La comanda de merge és/u);
  assert.deepEqual(github.merges, []);
  assert.equal(github.reads, 0);
  assert.deepEqual(membership.calls, []);
  assert.deepEqual(actions(traces), ["merge_refused"]);
  assert.equal(traces[0].detail, "usage");
});

test("refuses when the topic has no notice or the last notice is not green", async (context) => {
  const { ciWatches, handler, github, traces } = setup(context);

  const none = await handler.handle(request(20), bareCommand);
  assert.match(none.report, /no té cap avís de CI/u);

  report(ciWatches, { result: "failure" });
  const failed = await handler.handle(request(21), bareCommand);
  assert.match(failed.report, /PR #200/u);
  assert.match(failed.report, /no deia que les comprovacions/u);

  assert.deepEqual(github.merges, []);
  assert.deepEqual(actions(traces), ["merge_refused", "merge_refused"]);
  assert.equal(traces[0].detail, "no_reported_commit");
  assert.equal(traces[1].detail, "not_green #200 aaaaaaa");
});

test("refuses another pull request or another commit than the reported one", async (context) => {
  const { ciWatches, handler, github } = setup(context);
  report(ciWatches);

  const other = await handler.handle(request(20), {
    valid: true,
    pullRequestNumber: 201,
  });
  assert.match(other.report, /última PR informada en aquest tema és la #200/u);
  assert.match(other.report, /#201/u);

  const moved = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit: "c".repeat(40),
  });
  assert.match(moved.report, /no és el de l'últim avís de la PR #200/u);

  assert.deepEqual(github.merges, []);
});

test("refuses while the topic has newer work than its last notice", async (context) => {
  const { ciWatches, handler, github, newerWork, traces } = setup(context);
  report(ciWatches);
  newerWork.value = true;

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /feina més nova que l'últim avís/u);
  assert.match(result.report, /PR #200/u);
  assert.match(result.report, /torna a demanar `\/merge`/u);
  assert.deepEqual(newerWork.calls, [{ sessionKey, updateIdentifier: 20 }]);
  assert.deepEqual(github.merges, []);
  assert.equal(traces[0].detail, "newer_work #200 aaaaaaa");
});

test("refuses the older green notice while a newer publication is unknown", async (context) => {
  const greenCommit = "d".repeat(40);
  const newerCommit = "e".repeat(40);
  const github = fakeGithub();
  github.pullRequests = {
    200: openPullRequest({ headSha: greenCommit }),
    202: openPullRequest({ headSha: newerCommit }),
  };
  const { ciWatches, github: fake, buildHandler } = setup(context, { github });
  ciWatches.add({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    commitSha: greenCommit,
  });
  ciWatches.beginSend(10, "success");
  ciWatches.finishSend(10);
  // A newer publication was pushed, but its notice ended unknown.
  ciWatches.add({
    updateIdentifier: 11,
    sessionKey,
    pullRequestNumber: 202,
    commitSha: newerCommit,
  });
  ciWatches.beginSend(11, "success");
  ciWatches.markUncertain(11);
  const handler = buildHandler({
    hasNewerWork: ({ sessionKey: topic }) => ciWatches.hasUnreportedWork(topic),
  });

  const bare = await handler.handle(request(20), bareCommand);
  assert.match(bare.report, /feina més nova que l'últim avís/u);
  assert.match(bare.report, /PR #200/u);
  const withNumber = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
  });
  assert.match(withNumber.report, /feina més nova que l'últim avís/u);
  assert.deepEqual(fake.merges, []);

  // A person confirms the newer notice was delivered: it becomes the topic's
  // last report and the merge resolves from it.
  ciWatches.resolveUncertainNoticeDelivered(11);
  const resolved = await handler.handle(request(22), bareCommand);
  assert.match(resolved.report, /PR #202 fusionada/u);
  assert.deepEqual(fake.merges, [{ number: 202, sha: newerCommit }]);
});

test("refuses the last delivered notice while an out-of-order notice is unknown", async (context) => {
  let instant = Date.parse("2026-11-16T10:00:00Z");
  const tick = () => {
    instant += 1000;
  };
  const greenCommit = "d".repeat(40);
  const unknownCommit = "e".repeat(40);
  const laterCommit = "f".repeat(40);
  const github = fakeGithub();
  github.pullRequests = {
    200: openPullRequest({ headSha: greenCommit }),
    202: openPullRequest({ headSha: unknownCommit }),
    203: openPullRequest({ headSha: laterCommit }),
  };
  const {
    ciWatches,
    github: fake,
    buildHandler,
  } = setup(context, {
    github,
    now: () => new Date(instant),
  });
  // A, B and C are published in that order.
  ciWatches.add({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    commitSha: greenCommit,
  });
  ciWatches.add({
    updateIdentifier: 11,
    sessionKey,
    pullRequestNumber: 202,
    commitSha: unknownCommit,
  });
  ciWatches.add({
    updateIdentifier: 12,
    sessionKey,
    pullRequestNumber: 203,
    commitSha: laterCommit,
  });
  // C's notice arrives first, then A's; B's may or may not have arrived.
  tick();
  ciWatches.beginSend(12, "success");
  tick();
  ciWatches.finishSend(12);
  tick();
  ciWatches.beginSend(10, "success");
  tick();
  ciWatches.finishSend(10);
  tick();
  ciWatches.beginSend(11, "success");
  tick();
  ciWatches.markUncertain(11);

  const handler = buildHandler({
    hasNewerWork: ({ sessionKey: topic }) => ciWatches.hasUnreportedWork(topic),
  });
  assert.equal(ciWatches.lastReported(sessionKey).commit_sha, greenCommit);

  const bare = await handler.handle(request(20), bareCommand);
  assert.match(bare.report, /feina més nova que l'últim avís/u);
  assert.match(bare.report, /PR #200/u);
  const withNumber = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
  });
  assert.match(withNumber.report, /feina més nova que l'últim avís/u);
  assert.deepEqual(fake.merges, []);
});

test("verifies the membership again when the command runs", async (context) => {
  const { ciWatches, handler, github, membership, traces } = setup(context);
  report(ciWatches);

  membership.result = { verified: false, reason: "not_a_group_member" };
  const revoked = await handler.handle(request(20), bareCommand);
  assert.match(revoked.report, /Ja no consten com a membre verificat/u);

  membership.result = { verified: false, reason: "membership_check_failed" };
  const unavailable = await handler.handle(request(21), bareCommand);
  assert.match(unavailable.report, /No s'ha pogut verificar la pertinença/u);

  assert.deepEqual(github.merges, []);
  assert.equal(github.reads, 0);
  assert.deepEqual(
    traces.map((entry) => entry.detail),
    ["membership_revoked", "membership_unavailable"],
  );
});

/** A Telegram member read that only ends when its signal aborts. */
function hangingMemberTelegram() {
  return {
    async getChatMember({ signal }) {
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  };
}

/**
 * The membership check wired as `main.mjs` does, with a deadline the test can
 * shorten: the service signal stops the read, the read's own deadline fails it.
 */
function boundedMembership(timeoutMilliseconds) {
  const memberTelegram = hangingMemberTelegram();
  return (authorIdentifier, signal) =>
    verifyMembership({
      telegram: memberTelegram,
      groupIdentifier,
      authorIdentifier,
      signal: requestSignal(signal, timeoutMilliseconds),
    });
}

test("a service stop during the membership read aborts instead of refusing", async (context) => {
  const { ciWatches, github, merges, traces, buildHandler } = setup(context);
  report(ciWatches);
  const controller = new AbortController();
  const handler = buildHandler({
    verifyMembership: boundedMembership(60_000),
  });

  const pending = handler.handle(request(), bareCommand, {
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(github.merges, []);
  assert.equal(merges.state(20), undefined);
  assert.deepEqual(actions(traces), []);
});

test("a membership read that runs out of its deadline refuses and asks to retry", async (context) => {
  const { ciWatches, github, merges, traces, buildHandler } = setup(context);
  report(ciWatches);
  const handler = buildHandler({ verifyMembership: boundedMembership(10) });

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /No s'ha pogut verificar la pertinença/u);
  assert.match(result.report, /torna-ho a demanar/u);
  assert.deepEqual(github.merges, []);
  assert.equal(merges.state(20), undefined);
  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [["merge_refused", "membership_unavailable"]],
  );
});

const liveRefusals = [
  [
    "a closed pull request",
    { pullRequest: openPullRequest({ state: "closed" }) },
    "not_open",
    /ja no està oberta/u,
  ],
  [
    "a draft",
    { pullRequest: openPullRequest({ draft: true }) },
    "draft",
    /esborrany/u,
  ],
  [
    "another base branch",
    { pullRequest: openPullRequest({ baseRef: "release" }) },
    "not_main_base",
    /no apunta a la branca main/u,
  ],
  [
    "a fork",
    { pullRequest: openPullRequest({ headRepository: "someone/fork" }) },
    "not_main_repository",
    /repositori principal/u,
  ],
  [
    "a deleted fork",
    { pullRequest: openPullRequest({ headRepository: null }) },
    "not_main_repository",
    /repositori principal/u,
  ],
  [
    "a moved head",
    { pullRequest: openPullRequest({ headSha: "c".repeat(40) }) },
    "head_moved",
    /ja no és el commit validat/u,
  ],
  [
    "a red required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "failure" },
      ],
    },
    "checks_not_green",
    /no estan totes en verd/u,
  ],
  [
    "a pending required check",
    {
      checkRuns: [
        { name: "Validate", status: "in_progress", conclusion: null },
      ],
    },
    "checks_not_green",
    /no estan totes en verd/u,
  ],
  [
    "an absent required check",
    { checkRuns: [] },
    "checks_not_green",
    /no estan totes en verd/u,
  ],
  [
    "a skipped required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "skipped" },
      ],
    },
    "checks_not_green",
    /no estan totes en verd/u,
  ],
  [
    "a neutral required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "neutral" },
      ],
    },
    "checks_not_green",
    /no estan totes en verd/u,
  ],
  [
    "a pull request without a mergeable state",
    { pullRequest: openPullRequest({ mergeableState: undefined }) },
    "not_clean",
    /no considera la PR #200 a punt/u,
  ],
  [
    "a branch behind main",
    { pullRequest: openPullRequest({ mergeableState: "behind" }) },
    "behind",
    /actualitza la branca/u,
  ],
  [
    "a blocked pull request",
    { pullRequest: openPullRequest({ mergeableState: "blocked" }) },
    "not_clean",
    /no considera la PR #200 a punt/u,
  ],
  [
    "a conflicting pull request",
    { pullRequest: openPullRequest({ mergeableState: "dirty" }) },
    "not_clean",
    /no considera/u,
  ],
  [
    "unstable checks",
    { pullRequest: openPullRequest({ mergeableState: "unstable" }) },
    "not_clean",
    /no considera/u,
  ],
  [
    "pending hooks",
    { pullRequest: openPullRequest({ mergeableState: "has_hooks" }) },
    "not_clean",
    /no considera/u,
  ],
  [
    "an unreadable pull request",
    { readError: new Error("network down") },
    "unreadable",
    /No s'ha pogut llegir/u,
  ],
];

for (const [name, state, reason, text] of liveRefusals) {
  test(`refuses ${name} without merging`, async (context) => {
    const { ciWatches, handler, github, merges, traces } = setup(context, {
      github: fakeGithub(state),
    });
    report(ciWatches);

    const result = await handler.handle(request(), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.match(result.report, text);
    assert.match(result.report, /No s'ha fusionat res/u);
    assert.deepEqual(github.merges, []);
    assert.equal(merges.state(20), undefined);
    assert.equal(traces.at(-1).action, "merge_refused");
    assert.equal(traces.at(-1).detail, `${reason} #200 aaaaaaa`);
  });
}

test("reads a pull request again while mergeability is unknown and then refuses as unreadable", async (context) => {
  const { ciWatches, handler, github } = setup(context, {
    github: fakeGithub({
      pullRequest: openPullRequest({ mergeableState: "unknown" }),
    }),
  });
  report(ciWatches);

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /No s'ha pogut llegir/u);
  assert.equal(github.reads, 3);
  assert.equal(github.checkReads, 0);
  assert.deepEqual(github.merges, []);
});

test("merges once GitHub finishes computing the mergeability", async (context) => {
  const { ciWatches, handler, github } = setup(context, {
    github: fakeGithub({
      pullRequestSequence: [openPullRequest({ mergeableState: "unknown" })],
    }),
  });
  report(ciWatches);

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /fusionada/u);
  assert.equal(github.reads, 2);
  assert.equal(github.merges.length, 1);
});

test("stops while waiting to read the mergeability again", async (context) => {
  const controller = new AbortController();
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "unknown" }),
  });
  const { ciWatches, handler } = setup(context, { github });
  report(ciWatches);
  const read = github.getPullRequest;
  github.getPullRequest = async (options) => {
    const pullRequest = await read(options);
    if (github.reads === 2) controller.abort();
    return pullRequest;
  };

  await assert.rejects(
    handler.handle(request(), bareCommand, { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(github.reads, 2);
  assert.deepEqual(github.merges, []);
});

test("stops reading while the service is stopping", async (context) => {
  const controller = new AbortController();
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "unknown" }),
  });
  const { ciWatches, handler } = setup(context, { github });
  report(ciWatches);
  const read = github.getPullRequest;
  github.getPullRequest = async (options) => {
    controller.abort();
    return read(options);
  };

  await assert.rejects(
    handler.handle(request(), bareCommand, { signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.deepEqual(github.merges, []);
});

for (const status of [405, 409, 422]) {
  test(`a definite HTTP ${status} fails the request and allows a later one`, async (context) => {
    const github = fakeGithub({
      mergeError: new GitHubResponseError("PUT", "/merge", status),
    });
    const { ciWatches, handler, merges, traces } = setup(context, { github });
    report(ciWatches);

    const result = await handler.handle(request(20), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.match(result.report, /HTTP 4xx/u);
    assert.match(result.report, /no s'ha fusionat res/u);
    assert.equal(merges.state(20), "failed");
    assert.equal(traces.at(-1).action, "merge_failed");
    assert.equal(traces.at(-1).detail, "#200 aaaaaaa HTTP 4xx");
    assert.equal(traces.at(-1).authorIdentifier, 555);
    assert.equal(traces.at(-1).sessionKey, sessionKey);

    github.mergeError = null;
    const retry = await handler.handle(request(21), bareCommand);
    assert.match(retry.report, /fusionada/u);
    assert.deepEqual(github.merges, [
      { number: 200, sha: commit },
      { number: 200, sha: commit },
    ]);
  });
}

const unknownResults = [
  ["a server error", new GitHubResponseError("PUT", "/merge", 502)],
  ["a rate limit", new GitHubResponseError("PUT", "/merge", 429)],
  ["a timeout response", new GitHubResponseError("PUT", "/merge", 408)],
  ["a network failure", new TypeError("fetch failed")],
  [
    "a malformed response",
    new Error("GitHub returned an invalid merge response."),
  ],
];

for (const [name, error] of unknownResults) {
  test(`${name} leaves the result uncertain and never merges twice`, async (context) => {
    const github = fakeGithub({ mergeError: error });
    const { ciWatches, handler, merges, traces } = setup(context, { github });
    report(ciWatches);

    const result = await handler.handle(request(20), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.match(result.report, /No s'ha pogut confirmar si la PR #200/u);
    assert.equal(merges.state(20), "uncertain");
    assert.equal(traces.at(-1).action, "merge_uncertain");
    assert.equal(traces.at(-1).authorIdentifier, 555);
    assert.equal(traces.at(-1).sessionKey, sessionKey);

    // The pull request is still open: a person decides, nothing is repeated.
    github.mergeError = null;
    const again = await handler.handle(request(21), bareCommand);
    assert.match(again.report, /GitHub no la mostra fusionada: és oberta/u);
    assert.equal(github.merges.length, 1);
    assert.equal(merges.state(21), undefined);
    assert.equal(traces.at(-1).detail, "uncertain_pending #200 aaaaaaa");
  });
}

test("an aborted merge call is uncertain", async (context) => {
  const controller = new AbortController();
  const github = fakeGithub({
    mergeError: new DOMException("aborted", "AbortError"),
  });
  github.beforeMerge = () => controller.abort();
  const { ciWatches, handler, merges } = setup(context, { github });
  report(ciWatches);

  await handler.handle(request(20), bareCommand, { signal: controller.signal });

  assert.equal(merges.state(20), "uncertain");
});

test("an uncertain merge that GitHub shows as merged is closed and reported", async (context) => {
  const github = fakeGithub({ mergeError: new TypeError("fetch failed") });
  const { ciWatches, handler, merges, traces } = setup(context, { github });
  report(ciWatches);
  await handler.handle(request(20), bareCommand);

  github.mergeError = null;
  github.pullRequest = mergedPullRequest();
  const result = await handler.handle(request(21), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /GitHub mostra la PR #200 fusionada/u);
  assert.match(result.report, /bbbbbbb/u);
  assert.equal(merges.state(20), "merged");
  assert.equal(github.merges.length, 1);
  const reconciled = traces.at(-1);
  assert.equal(reconciled.action, "merge_reconciled");
  assert.equal(reconciled.updateIdentifier, 20);
  assert.equal(reconciled.authorIdentifier, 555);
  assert.equal(reconciled.detail, `#200 aaaaaaa ${mergeCommit}`);
});

test("an uncertain merge whose pull request cannot be read refuses as unreadable", async (context) => {
  const github = fakeGithub({ mergeError: new TypeError("fetch failed") });
  const { ciWatches, handler, merges } = setup(context, { github });
  report(ciWatches);
  await handler.handle(request(20), bareCommand);

  github.readError = new Error("network down");
  const result = await handler.handle(request(21), bareCommand);

  assert.match(result.report, /No s'ha pogut llegir/u);
  assert.equal(merges.state(20), "uncertain");
  assert.equal(github.merges.length, 1);
});

test("never merges the same update twice", async (context) => {
  const { ciWatches, handler, github, merges, traces } = setup(context);
  report(ciWatches);
  // The same update reaches the store again after a crash that lost the answer.
  merges.begin({
    updateIdentifier: 20,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  merges.markFailed(20);

  const result = await handler.handle(request(20), bareCommand);

  assert.match(result.report, /ja s'havia tramitat/u);
  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "already_handled #200 aaaaaaa");
});

test("refuses a second merge of a pull request that is already merging", async (context) => {
  const { ciWatches, handler, github, merges } = setup(context);
  report(ciWatches);
  merges.begin({
    updateIdentifier: 19,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });

  const result = await handler.handle(request(20), bareCommand);

  assert.match(result.report, /merge de la PR #200 en curs/u);
  assert.deepEqual(github.merges, []);
});

test("startup closes an uncertain merge that GitHub shows as merged and tells the topic", async (context) => {
  const github = fakeGithub({ pullRequest: mergedPullRequest() });
  const { handler, merges, sent, traces } = setup(context, { github });
  merges.begin({
    updateIdentifier: 20,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  merges.recoverMerging();

  await handler.reconcileUncertain();

  assert.equal(merges.state(20), "merged");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatIdentifier, -1001234567890);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(sent[0].text, /GitHub mostra la PR #200 fusionada/u);
  assert.ok(sent[0].signal instanceof AbortSignal);
  assert.match(sent[0].text, /bbbbbbb/u);
  assert.deepEqual(actions(traces), ["merge_reconciled"]);
  assert.deepEqual(github.merges, []);
});

function interruptedMerge(merges) {
  merges.begin({
    updateIdentifier: 20,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  merges.recoverMerging();
}

test("startup tells the topic once about an unknown result of an open pull request", async (context) => {
  const { handler, merges, sent, traces } = setup(context);
  interruptedMerge(merges);

  await handler.reconcileUncertain();
  await handler.reconcileUncertain();

  assert.equal(merges.state(20), "uncertain");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(sent[0].text, /GitHub no la mostra fusionada: és oberta/u);
  assert.ok(sent[0].text.includes(`/merge 200 ${commit}`));
  assert.ok(sent[0].signal instanceof AbortSignal);
  assert.deepEqual(traces, []);
});

test("startup tells the topic that an unmerged closed pull request cannot be merged", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ state: "closed" }),
  });
  const { handler, merges, sent } = setup(context, { github });
  interruptedMerge(merges);

  await handler.reconcileUncertain();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /tancada sense fusionar/u);
  assert.match(sent[0].text, /no es pot fusionar/u);
});

test("startup does not repeat the notice of a result the topic was already told", async (context) => {
  const github = fakeGithub({ mergeError: new TypeError("fetch failed") });
  const { ciWatches, handler, sent } = setup(context, { github });
  report(ciWatches);
  await handler.handle(request(20), bareCommand);

  await handler.reconcileUncertain();

  assert.deepEqual(sent, []);
});

test("startup keeps an uncertain merge when it cannot be read or the notice is not sent", async (context) => {
  const github = fakeGithub();
  const { handler, merges, sent, telegram } = setup(context, { github });
  interruptedMerge(merges);

  github.readError = new Error("network down");
  await handler.reconcileUncertain();
  assert.equal(merges.state(20), "uncertain");
  assert.deepEqual(sent, []);

  github.readError = null;
  telegram.sendError = new Error("telegram down");
  await handler.reconcileUncertain();
  assert.deepEqual(sent, []);

  // The failed send was not recorded as delivered: the next start tells again.
  telegram.sendError = null;
  await handler.reconcileUncertain();
  assert.equal(sent.length, 1);

  github.pullRequest = mergedPullRequest();
  telegram.sendError = new Error("telegram down");
  await handler.reconcileUncertain();
  assert.equal(merges.state(20), "uncertain");
  assert.equal(sent.length, 1);
});

async function uncertainOpenMerge(context, state = {}) {
  const github = fakeGithub({
    mergeError: new TypeError("fetch failed"),
    ...state,
  });
  const environment = setup(context, { github });
  report(environment.ciWatches);
  await environment.handler.handle(request(20), bareCommand);
  github.mergeError = null;
  return environment;
}

test("asks for the strict form while an unknown result is still open and merges nothing", async (context) => {
  const { handler, github, merges, traces } = await uncertainOpenMerge(context);

  for (const [updateIdentifier, command] of [
    [21, bareCommand],
    [22, { valid: true, pullRequestNumber: 200 }],
  ]) {
    const result = await handler.handle(request(updateIdentifier), command);
    assert.match(result.report, /GitHub no la mostra fusionada: és oberta/u);
    assert.ok(result.report.includes(`/merge 200 ${commit}`));
  }

  assert.equal(github.merges.length, 1);
  assert.equal(merges.state(20), "uncertain");
  assert.equal(traces.at(-1).detail, "uncertain_pending #200 aaaaaaa");
});

test("refuses a strict form with another commit while an unknown result is open", async (context) => {
  const { handler, github, merges } = await uncertainOpenMerge(context);

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit: "c".repeat(40),
  });

  assert.match(result.report, /no és el de l'últim avís/u);
  assert.equal(github.merges.length, 1);
  assert.equal(merges.state(20), "uncertain");
});

test("a person's strict form clears an unknown result and runs the full request", async (context) => {
  const { handler, github, merges, traces, membership, newerWork } =
    await uncertainOpenMerge(context);
  const membershipCalls = membership.calls.length;
  const newerWorkCalls = newerWork.calls.length;
  const checkReads = github.checkReads;

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });

  assert.match(result.report, /PR #200 fusionada/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(21), "merged");
  assert.equal(github.merges.length, 2);
  assert.equal(membership.calls.length, membershipCalls + 1);
  assert.equal(newerWork.calls.length, newerWorkCalls + 1);
  assert.equal(github.checkReads, checkReads + 1);
  const cleared = traces.find(
    (entry) => entry.action === "merge_uncertain_cleared",
  );
  assert.equal(cleared.authorIdentifier, 555);
  assert.equal(cleared.updateIdentifier, 21);
  assert.equal(cleared.sessionKey, sessionKey);
  assert.equal(cleared.detail, "#200 aaaaaaa");
});

test("a moved head is confirmed with its own commit, which the full request still binds", async (context) => {
  const movedCommit = "b".repeat(40);
  const { handler, github, merges, traces, ciWatches } =
    await uncertainOpenMerge(context);
  github.pullRequest = openPullRequest({ headSha: movedCommit });
  report(ciWatches, { updateIdentifier: 11, commitSha: movedCommit });

  const asked = await handler.handle(request(21), bareCommand);
  assert.ok(asked.report.includes(`/merge 200 ${movedCommit}`));
  assert.ok(!asked.report.includes(commit));

  const stale = await handler.handle(request(22), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });
  assert.match(stale.report, /no és el de l'últim avís/u);
  assert.equal(github.merges.length, 1);
  assert.equal(merges.state(20), "uncertain");

  const result = await handler.handle(request(23), {
    valid: true,
    pullRequestNumber: 200,
    commit: movedCommit,
  });

  assert.match(result.report, /PR #200 fusionada/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(23), "merged");
  assert.equal(github.merges.length, 2);
  assert.deepEqual(github.merges[1], { number: 200, sha: movedCommit });
  assert.ok(traces.some((entry) => entry.action === "merge_uncertain_cleared"));
});

test("a cleared unknown result is still refused when the live checks fail", async (context) => {
  const { handler, github, merges } = await uncertainOpenMerge(context);
  github.checkRuns = [];

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });

  assert.match(result.report, /no estan totes en verd/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(github.merges.length, 1);
});

test("an unknown result of a closed unmerged pull request cannot be cleared", async (context) => {
  const { handler, github, merges } = await uncertainOpenMerge(context);
  github.pullRequest = openPullRequest({ state: "closed" });

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });

  assert.match(result.report, /tancada sense fusionar/u);
  assert.equal(merges.state(20), "uncertain");
  assert.equal(github.merges.length, 1);
});

test("an unknown result that GitHub shows merged is reconciled even for the strict form", async (context) => {
  const { handler, github, merges } = await uncertainOpenMerge(context);
  github.pullRequest = mergedPullRequest();

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });

  assert.match(result.report, /GitHub mostra la PR #200 fusionada/u);
  assert.equal(merges.state(20), "merged");
  assert.equal(github.merges.length, 1);
});

test("answers that the pull request is already merged when the last notice is the closed one", async (context) => {
  const { ciWatches, handler, github, traces } = setup(context, {
    github: fakeGithub({ pullRequest: mergedPullRequest() }),
  });
  report(ciWatches, { result: "pull-request-closed" });

  for (const [updateIdentifier, command] of [
    [20, bareCommand],
    [21, { valid: true, pullRequestNumber: 200 }],
  ]) {
    const result = await handler.handle(request(updateIdentifier), command);
    assert.equal(
      result.report,
      "La PR #200 ja està fusionada (commit bbbbbbb). No s'ha fet res més.",
    );
  }

  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "already_merged #200 aaaaaaa");
});

test("keeps the refusal when the closed notice is not a merged or readable pull request", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ state: "closed" }),
  });
  const { ciWatches, handler } = setup(context, { github });
  report(ciWatches, { result: "pull-request-closed" });

  const closed = await handler.handle(request(20), bareCommand);
  assert.match(closed.report, /no deia que les comprovacions/u);

  github.readError = new Error("network down");
  const unreadable = await handler.handle(request(21), bareCommand);
  assert.match(unreadable.report, /no deia que les comprovacions/u);
  assert.deepEqual(github.merges, []);
});

test("reports a merge that happened even when its end cannot be saved", async (context) => {
  const { ciWatches, handler, merges, traces } = setup(context);
  report(ciWatches);
  merges.markMerged = () => {
    throw new Error("disk full");
  };

  const result = await handler.handle(request(20), bareCommand);

  assert.match(
    result.report,
    /PR #200 fusionada \(squash\)\. Commit de merge bbbbbbb\./u,
  );
  assert.match(result.report, /No s'ha pogut desar l'estat/u);
  assert.equal(merges.state(20), "merging");
  assert.equal(traces.at(-1).action, "merge_completed");

  // A restart closes it from what GitHub shows.
  merges.recoverMerging();
  assert.equal(merges.state(20), "uncertain");
});

for (const [name, method, error] of [
  ["a rejection", "markFailed", new GitHubResponseError("PUT", "/merge", 405)],
  ["an unknown result", "markUncertain", new TypeError("fetch failed")],
]) {
  test(`answers with the unknown-result text when the end of ${name} cannot be saved`, async (context) => {
    const github = fakeGithub({ mergeError: error });
    const { ciWatches, handler, merges } = setup(context, { github });
    report(ciWatches);
    merges[method] = () => {
      throw new Error("disk full");
    };

    const result = await handler.handle(request(20), bareCommand);

    assert.match(result.report, /No s'ha pogut confirmar si la PR #200/u);
    assert.doesNotMatch(result.report, /No s'ha fet cap push/u);
    assert.equal(merges.state(20), "merging");
  });
}

test("a failing trace never stops a merge", async (context) => {
  const failures = [];
  const { buildHandler, ciWatches, github } = setup(context);
  report(ciWatches);
  const handler = buildHandler({
    recordTrace: () => {
      throw new Error("disk full");
    },
    logger: (event) => failures.push(event),
  });

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /fusionada/u);
  assert.equal(github.merges.length, 1);
  assert.ok(failures.includes("merge_trace_failed"));
});
