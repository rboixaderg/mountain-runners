import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyMembership } from "telegram-pi-bridge/telegram";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { GitHubResponseError } from "../repository/github.mjs";
import { PreviewRequestStore } from "../repository/preview-request-store.mjs";
import { requestSignal } from "../repository/request-signal.mjs";
import { createCiWatchRegistration, createCiWatchWorker } from "./ci-watch.mjs";
import { createPreviewRequests } from "./preview-request.mjs";

const repository = "rboixaderg/mountain-runners";
const groupIdentifier = "-1001234567890";
const commit = "a".repeat(40);
const sessionKey = "-1001234567890:7";
const origin = "https://pr-200.preview.mountainrunners.cat";
const confirmationTimeoutMilliseconds = 15 * 60 * 1000;

function fixture(context, now) {
  const directory = mkdtempSync(join(tmpdir(), "mr-preview-request-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const ciWatches = new CiWatchStore(join(directory, "ci-watch.sqlite"));
  const previews = new PreviewRequestStore(join(directory, "preview.sqlite"), {
    now,
  });
  context.after(() => {
    ciWatches.close();
    previews.close();
  });
  return { directory, ciWatches, previews };
}

function reportGreen(ciWatches, updateIdentifier = 10, commitSha = commit) {
  ciWatches.add({
    updateIdentifier,
    sessionKey,
    pullRequestNumber: 200,
    commitSha,
  });
  ciWatches.beginSend(updateIdentifier, "success");
  ciWatches.finishSend(updateIdentifier);
}

function publisherComment(overrides = {}) {
  return {
    user: { login: "github-actions[bot]" },
    body: `<!-- mountain-runners-preview -->\nPreview publicada: ${origin}\nCommit: \`${commit}\`.`,
    updated_at: "2026-11-14T10:05:00Z",
    ...overrides,
  };
}

function assertBoundPullRequest(number) {
  assert.equal(number, 200, "only the bound pull request may be used");
}

function fakeGithub(state = {}) {
  const github = {
    posts: [],
    pullRequest: {
      state: "open",
      headSha: commit,
      headRepository: repository,
    },
    checkRuns: [
      { name: "Validate", status: "completed", conclusion: "success" },
    ],
    statuses: [],
    comments: [],
    postError: null,
    readError: null,
    listError: null,
    listings: [],
    beforePost: null,
    ...state,
    async getPullRequest({ number }) {
      assertBoundPullRequest(number);
      if (github.readError) throw github.readError;
      return github.pullRequest;
    },
    async getCommitCheckRuns() {
      return github.checkRuns;
    },
    async getCommitStatuses() {
      return github.statuses;
    },
    async commentOnPullRequest({ number, body }) {
      assertBoundPullRequest(number);
      github.beforePost?.();
      if (github.postError) throw github.postError;
      github.posts.push({ number, body });
      return { createdAt: "2026-11-14T10:00:00Z" };
    },
    async listIssueComments({ number, since }) {
      assertBoundPullRequest(number);
      github.listings.push(since);
      if (github.listError) throw github.listError;
      return github.comments;
    },
  };
  return github;
}

function setup(context, { github = fakeGithub() } = {}) {
  let current = new Date("2026-11-14T10:00:01Z");
  const { ciWatches, previews } = fixture(context, () => current);
  const sent = [];
  const traces = [];
  const membership = {
    result: { verified: true, status: "member" },
    calls: [],
  };
  const telegram = {
    sendError: null,
    async sendMessage(message) {
      if (telegram.sendError) throw telegram.sendError;
      sent.push(message);
    },
  };
  function buildHandler(overrides = {}) {
    return createPreviewRequests({
      store: previews,
      reportedCommits: ciWatches,
      verifyMembership: async (authorIdentifier) => {
        membership.calls.push(authorIdentifier);
        return membership.result;
      },
      github,
      repository,
      requiredChecks: ["Validate"],
      telegram,
      pollIntervalMilliseconds: 1,
      confirmationTimeoutMilliseconds,
      recordTrace: (entry) => traces.push(entry),
      now: () => current,
      ...overrides,
    });
  }
  return {
    ciWatches,
    previews,
    github,
    telegram,
    membership,
    handler: buildHandler(),
    buildHandler,
    sent,
    traces,
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
    setClock(moment) {
      current = new Date(moment);
    },
  };
}

function request(updateIdentifier = 20) {
  return {
    updateIdentifier,
    sessionKey,
    authorIdentifier: 555,
    instruction: "obre la preview",
  };
}

function actions(traces) {
  return traces.map((entry) => entry.action);
}

test("posts exactly /preview once for the reported green commit", async (context) => {
  const { ciWatches, handler, github, membership, previews, traces } =
    setup(context);
  reportGreen(ciWatches);
  let stateDuringPost;
  github.beforePost = () => {
    stateDuringPost = previews.state(20);
  };

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /Preview demanada/u);
  assert.deepEqual(github.posts, [{ number: 200, body: "/preview" }]);
  assert.equal(stateDuringPost, "commenting");
  assert.equal(previews.state(20), "awaiting");
  assert.deepEqual(membership.calls, [555]);
  assert.deepEqual(actions(traces), [
    "preview_requested",
    "preview_membership_verified",
    "preview_commented",
  ]);
  assert.equal(traces[0].authorIdentifier, 555);
  assert.equal(traces[0].detail, "#200 aaaaaaa");
  assert.equal(traces[1].authorIdentifier, 555);
  assert.equal(traces[1].sessionKey, sessionKey);
  assert.equal(traces[1].detail, "#200 aaaaaaa");
  assert.equal(traces[2].authorIdentifier, 555);
  assert.equal(traces[2].detail, "#200 aaaaaaa");
});

test("refuses the older green notice while a newer publication is unknown", async (context) => {
  const { ciWatches, handler, github, membership, previews, traces } =
    setup(context);
  reportGreen(ciWatches);
  // A newer publication was pushed, but its notice ended unknown.
  ciWatches.add({
    updateIdentifier: 11,
    sessionKey,
    pullRequestNumber: 202,
    commitSha: "b".repeat(40),
  });
  ciWatches.beginSend(11, "success");
  ciWatches.markUncertain(11);

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /una publicació més nova que l'últim avís/u);
  assert.match(result.report, /PR #200/u);
  assert.match(result.report, /No s'ha demanat cap preview/u);
  assert.deepEqual(github.posts, []);
  assert.deepEqual(membership.calls, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_refused"]);
  assert.equal(traces[0].detail, "newer_work #200 aaaaaaa");
});

test("refuses even when the unknown notice is older than the delivered one", async (context) => {
  const { ciWatches, handler, github, previews, traces } = setup(context);
  // An earlier publication was never confirmed.
  ciWatches.add({
    updateIdentifier: 9,
    sessionKey,
    pullRequestNumber: 198,
    commitSha: "c".repeat(40),
  });
  ciWatches.beginSend(9, "success");
  ciWatches.markUncertain(9);
  reportGreen(ciWatches);

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /una publicació més nova que l'últim avís/u);
  assert.deepEqual(github.posts, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_refused"]);
  assert.equal(traces[0].detail, "newer_work #200 aaaaaaa");
});

test("refuses the preview when the author left the group before it ran", async (context) => {
  const { ciWatches, handler, github, membership, previews, traces } =
    setup(context);
  reportGreen(ciWatches);

  membership.result = { verified: false, reason: "not_a_group_member" };
  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /Ja no consten com a membre verificat/u);
  assert.match(result.report, /una preview necessita que l'autor/u);
  assert.deepEqual(membership.calls, [555]);
  assert.deepEqual(github.posts, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_requested", "preview_refused"]);
  assert.equal(traces[1].detail, "membership_revoked");
  assert.equal(traces[1].authorIdentifier, 555);
});

test("refuses the preview when the membership check fails", async (context) => {
  const { ciWatches, handler, github, membership, previews, traces } =
    setup(context);
  reportGreen(ciWatches);

  membership.result = { verified: false, reason: "membership_check_failed" };
  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /No s'ha pogut verificar la pertinença/u);
  assert.match(result.report, /torna-ho a demanar/u);
  assert.deepEqual(github.posts, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_requested", "preview_refused"]);
  assert.equal(traces[1].detail, "membership_unavailable");
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
  const { ciWatches, github, previews, traces, buildHandler } = setup(context);
  reportGreen(ciWatches);
  const controller = new AbortController();
  const handler = buildHandler({
    verifyMembership: boundedMembership(60_000),
  });

  const pending = handler.handle(request(), { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(github.posts, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_requested"]);
});

test("a membership read that runs out of its deadline refuses and asks to retry", async (context) => {
  const { ciWatches, github, previews, traces, buildHandler } = setup(context);
  reportGreen(ciWatches);
  const handler = buildHandler({ verifyMembership: boundedMembership(10) });

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /No s'ha pogut verificar la pertinença/u);
  assert.match(result.report, /torna-ho a demanar/u);
  assert.deepEqual(github.posts, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [
      ["preview_requested", "#200 aaaaaaa"],
      ["preview_refused", "membership_unavailable"],
    ],
  );
});

test("refuses without a commit reported green in the topic", async (context) => {
  const { ciWatches, handler, github, traces } = setup(context);

  const none = await handler.handle(request());
  assert.match(none.report, /no té cap commit informat/u);

  ciWatches.add({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  ciWatches.beginSend(10, "failure");
  ciWatches.finishSend(10);
  const failed = await handler.handle(request(21));
  assert.match(failed.report, /no té cap commit informat/u);

  assert.deepEqual(github.posts, []);
  assert.deepEqual(
    traces
      .filter((entry) => entry.action === "preview_refused")
      .map((entry) => entry.detail),
    ["no_reported_commit", "no_reported_commit"],
  );
  assert.ok(!actions(traces).includes("preview_requested"));
});

test("never accepts a PR or commit from the request text", async (context) => {
  const { ciWatches, handler, github } = setup(context);
  reportGreen(ciWatches);

  await handler.handle({
    ...request(),
    instruction: `preview de la PR #999 al commit ${"f".repeat(40)}`,
  });

  assert.deepEqual(github.posts, [{ number: 200, body: "/preview" }]);
});

const refusalCases = [
  [
    "red required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "failure" },
      ],
    },
    /no estan totes en verd/u,
  ],
  [
    "pending required check",
    {
      checkRuns: [
        { name: "Validate", status: "in_progress", conclusion: null },
      ],
    },
    /no estan totes en verd/u,
  ],
  ["missing required check", { checkRuns: [] }, /no estan totes en verd/u],
  [
    "ambiguous required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "success" },
        { name: "Validate", status: "completed", conclusion: "success" },
      ],
    },
    /no estan totes en verd/u,
  ],
  [
    "head moved",
    {
      pullRequest: {
        state: "open",
        headSha: "b".repeat(40),
        headRepository: repository,
      },
    },
    /ja no és el commit/u,
  ],
  [
    "closed pull request",
    {
      pullRequest: {
        state: "closed",
        headSha: commit,
        headRepository: repository,
      },
    },
    /ja no està oberta/u,
  ],
  [
    "fork",
    {
      pullRequest: {
        state: "open",
        headSha: commit,
        headRepository: "someone/mountain-runners",
      },
    },
    /repositori principal/u,
  ],
  [
    "deleted fork",
    { pullRequest: { state: "open", headSha: commit, headRepository: null } },
    /repositori principal/u,
  ],
  [
    "unreadable state",
    { readError: new Error("HTTP 500") },
    /No s'ha pogut llegir/u,
  ],
];

for (const [name, state, text] of refusalCases) {
  test(`refuses and posts nothing: ${name}`, async (context) => {
    const { ciWatches, handler, github, previews, traces } = setup(context, {
      github: fakeGithub(state),
    });
    reportGreen(ciWatches);

    const result = await handler.handle(request());

    assert.equal(result.outcome, "answered");
    assert.match(result.report, text);
    assert.deepEqual(github.posts, []);
    assert.equal(previews.state(20), undefined);
    assert.ok(actions(traces).includes("preview_refused"));
  });
}

test("does not post twice for a duplicate update", async (context) => {
  const { ciWatches, handler, github } = setup(context);
  reportGreen(ciWatches);

  await handler.handle(request());
  const duplicate = await handler.handle(request());

  assert.match(duplicate.report, /ja s'havia tramitat/u);
  assert.equal(github.posts.length, 1);
});

test("refuses a repeat while the request awaits confirmation", async (context) => {
  const { ciWatches, handler, github } = setup(context);
  reportGreen(ciWatches);

  await handler.handle(request(20));
  const repeated = await handler.handle(request(21));

  assert.match(repeated.report, /Ja hi ha una preview demanada/u);
  assert.equal(github.posts.length, 1);
});

test("allows a repeat for the same commit after the previous one was confirmed", async (context) => {
  const { ciWatches, handler, github, sent } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request(20));
  github.comments = [publisherComment()];
  await handler.runOnce();
  assert.equal(sent.length, 1);

  const repeated = await handler.handle(request(21));

  assert.match(repeated.report, /Preview demanada/u);
  assert.equal(github.posts.length, 2);
});

test("allows a repeat after the previous one was not confirmed in time", async (context) => {
  const { ciWatches, handler, github, advance } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request(20));
  advance(confirmationTimeoutMilliseconds);
  await handler.runOnce();

  await handler.handle(request(21));

  assert.equal(github.posts.length, 2);
});

test("a new green commit allows a new request while the old one waits", async (context) => {
  const { ciWatches, handler, github } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request(20));

  const newCommit = "c".repeat(40);
  github.pullRequest = { ...github.pullRequest, headSha: newCommit };
  reportGreen(ciWatches, 11, newCommit);
  await handler.handle(request(21));

  assert.equal(github.posts.length, 2);
});

test("an unknown post result is uncertain and never retried", async (context) => {
  const { ciWatches, handler, github, previews, traces } = setup(context, {
    github: fakeGithub({ postError: new Error("socket hang up") }),
  });
  reportGreen(ciWatches);

  const result = await handler.handle(request());

  assert.equal(result.outcome, "uncertain");
  assert.match(result.report, /bloquejat/u);
  assert.equal(previews.state(20), "uncertain");
  assert.equal(previews.uncertainCount(), 1);
  github.postError = null;
  const repeated = await handler.handle(request(21));
  assert.match(repeated.report, /Ja hi ha una preview demanada/u);
  assert.deepEqual(github.posts, []);
  assert.ok(actions(traces).includes("preview_uncertain"));
});

test("confirms through the publisher comment and reports URL, commit and PR", async (context) => {
  const { ciWatches, handler, github, sent, traces } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request());

  github.comments = [];
  await handler.runOnce();
  assert.deepEqual(sent, []);

  github.comments = [publisherComment()];
  await handler.runOnce();
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(
    sent[0].text,
    /https:\/\/pr-200\.preview\.mountainrunners\.cat/u,
  );
  assert.match(sent[0].text, /aaaaaaa/u);
  assert.match(sent[0].text, /PR #200/u);
  assert.deepEqual(github.listings, [
    "2026-11-14T10:00:01.000Z",
    "2026-11-14T10:00:01.000Z",
  ]);
  const confirmation = traces.find(
    (entry) => entry.action === "preview_confirmed",
  );
  assert.equal(confirmation.authorIdentifier, 555);
});

test("reports an unconfirmed preview at the deadline without guessing a URL", async (context) => {
  const { ciWatches, handler, previews, sent, traces, advance } =
    setup(context);
  reportGreen(ciWatches);
  await handler.handle(request());

  advance(confirmationTimeoutMilliseconds - 1);
  await handler.runOnce();
  assert.deepEqual(sent, []);

  advance(1);
  await handler.runOnce();
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /No s'ha pogut confirmar la preview/u);
  assert.doesNotMatch(sent[0].text, /preview\.mountainrunners\.cat/u);
  assert.equal(previews.state(20), "timed_out");
  assert.ok(actions(traces).includes("preview_unconfirmed"));
});

test("an unconfirmed report carries the requester and waits for a read", async (context) => {
  const { ciWatches, handler, github, sent, traces, previews, advance } =
    setup(context);
  reportGreen(ciWatches);
  await handler.handle(request());
  advance(confirmationTimeoutMilliseconds);

  github.listError = new Error("HTTP 502");
  await handler.runOnce();
  assert.deepEqual(sent, []);
  assert.equal(previews.state(20), "awaiting");

  github.listError = null;
  await handler.runOnce();
  assert.equal(sent.length, 1);
  assert.equal(previews.state(20), "timed_out");
  const unconfirmed = traces.find(
    (entry) => entry.action === "preview_unconfirmed",
  );
  assert.equal(unconfirmed.authorIdentifier, 555);
});

test("the deadline survives a restart and is not reset by it", async (context) => {
  const { ciWatches, buildHandler, handler, sent, advance } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request());
  advance(confirmationTimeoutMilliseconds);

  const restarted = buildHandler();
  await restarted.runOnce();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /No s'ha pogut confirmar la preview/u);
});

test("a failed report keeps the request awaiting and a later cycle sends it", async (context) => {
  const { ciWatches, handler, github, telegram, previews, sent } =
    setup(context);
  reportGreen(ciWatches);
  await handler.handle(request());
  github.comments = [publisherComment()];

  telegram.sendError = new Error("telegram down");
  await handler.runOnce();
  assert.equal(previews.state(20), "awaiting");
  assert.deepEqual(sent, []);

  telegram.sendError = null;
  await handler.runOnce();
  assert.equal(sent.length, 1);
  assert.equal(previews.state(20), "confirmed");
});

test("a failed timeout report is retried the same way", async (context) => {
  const { ciWatches, handler, telegram, previews, sent, advance } =
    setup(context);
  reportGreen(ciWatches);
  await handler.handle(request());
  advance(confirmationTimeoutMilliseconds);

  telegram.sendError = new Error("telegram down");
  await handler.runOnce();
  assert.equal(previews.state(20), "awaiting");

  telegram.sendError = null;
  await handler.runOnce();
  assert.equal(sent.length, 1);
  assert.equal(previews.state(20), "timed_out");
});

test("an aborted cycle reports and finishes nothing", async (context) => {
  const { ciWatches, handler, github, previews, sent } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request());
  const controller = new AbortController();
  github.comments = [publisherComment()];
  github.listIssueComments = async () => {
    controller.abort();
    return github.comments;
  };

  await handler.runOnce({ signal: controller.signal });

  assert.deepEqual(sent, []);
  assert.equal(previews.state(20), "awaiting");
});

test("aborting during the live preconditions rethrows instead of refusing", async (context) => {
  const { ciWatches, handler, github, previews } = setup(context);
  reportGreen(ciWatches);
  const controller = new AbortController();
  github.getPullRequest = async () => {
    controller.abort();
    throw new Error("aborted");
  };

  await assert.rejects(
    handler.handle(request(), { signal: controller.signal }),
  );
  assert.equal(previews.state(20), undefined);
});

for (const status of [403, 404, 422]) {
  test(`a definite ${status} rejection fails the request and allows a later one`, async (context) => {
    const { ciWatches, handler, github, previews, traces } = setup(context);
    reportGreen(ciWatches);
    github.postError = new GitHubResponseError("POST", "/x", status);

    const result = await handler.handle(request());

    assert.equal(result.outcome, "answered");
    assert.match(result.report, /no s'ha pogut demanar la preview/u);
    assert.match(result.report, /HTTP 4xx/u);
    assert.doesNotMatch(result.report, new RegExp(String(status), "u"));
    assert.equal(previews.state(20), "failed");
    assert.equal(previews.uncertainCount(), 0);
    const failure = traces.find((entry) => entry.action === "preview_failed");
    assert.equal(failure.authorIdentifier, 555);

    github.postError = null;
    const later = await handler.handle(request(21));
    assert.match(later.report, /Preview demanada/u);
  });
}

for (const [name, error] of [
  ["a 408 timeout", new GitHubResponseError("POST", "/x", 408)],
  ["a 429 rate limit", new GitHubResponseError("POST", "/x", 429)],
  ["a 502 server error", new GitHubResponseError("POST", "/x", 502)],
  ["a network error", new TypeError("fetch failed")],
]) {
  test(`${name} stays uncertain`, async (context) => {
    const { ciWatches, handler, previews } = setup(context, {
      github: fakeGithub({ postError: error }),
    });
    reportGreen(ciWatches);

    const result = await handler.handle(request());

    assert.equal(result.outcome, "uncertain");
    assert.equal(previews.state(20), "uncertain");
  });
}

test("the loop isolates a cycle error and stops when aborted", async (context) => {
  const { buildHandler } = setup(context);
  const controller = new AbortController();
  const logs = [];
  let cycles = 0;
  const loop = buildHandler({
    store: {
      awaiting() {
        cycles += 1;
        if (cycles === 1) throw new Error("secret detail");
        controller.abort();
        return [];
      },
    },
    pollIntervalMilliseconds: 0,
    logger: (event, detail) => logs.push([event, detail]),
  });

  await loop.run({ signal: controller.signal });

  assert.equal(cycles, 2);
  assert.deepEqual(logs, [["preview_worker_failed", "Error"]]);
});

test("never requests a preview when CI turns green or a pull request is published", async (context) => {
  const { ciWatches, github } = setup(context);
  const register = createCiWatchRegistration({ store: ciWatches });
  const sent = [];
  const worker = createCiWatchWorker({
    store: ciWatches,
    repairs: ciWatches,
    github,
    telegram: {
      async sendMessage(message) {
        sent.push(message);
      },
    },
    requiredChecks: ["Validate"],
    pollIntervalMilliseconds: 1,
    watchTimeoutMilliseconds: 60 * 60 * 1000,
    maximumAutomaticRepairs: 2,
  });

  register({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    commit,
  });
  await worker.runOnce();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /en verd/u);
  assert.deepEqual(github.posts, []);
});

test("confirms a reconciled request from a publisher comment written after it", async (context) => {
  const { ciWatches, previews, github, handler, sent, setClock, traces } =
    setup(context);
  reportGreen(ciWatches);
  setClock("2026-11-14T10:00:00Z");
  github.postError = new Error("synthetic network failure");
  await handler.handle(request());
  assert.equal(previews.state(20), "uncertain");

  github.postError = null;
  setClock("2026-11-14T11:00:00Z");
  previews.resolveUncertainCommented(20);
  assert.equal(previews.awaiting()[0].commented_at, "2026-11-14T11:00:00.000Z");

  github.comments = [
    publisherComment({
      created_at: "2026-11-14T10:05:00Z",
      updated_at: "2026-11-14T10:05:00Z",
    }),
  ];
  await handler.runOnce();

  assert.equal(previews.state(20), "confirmed");
  assert.equal(sent.length, 1);
  assert.match(
    sent[0].text,
    /https:\/\/pr-200\.preview\.mountainrunners\.cat/u,
  );
  assert.deepEqual(github.posts, []);
  assert.deepEqual(github.listings, ["2026-11-14T10:00:00.000Z"]);
  assert.ok(actions(traces).includes("preview_confirmed"));
});
