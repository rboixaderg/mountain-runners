import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyMembership } from "telegram-pi-bridge/telegram";
import { PreviewRequestStore } from "../repository/preview-request-store.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import { requestSignal } from "../repository/request-signal.mjs";
import { seedUncertainPreviewRequest } from "../repository/test-support/preview-requests.mjs";
import { previewConfirmationTimeoutMilliseconds } from "../policy/development.mjs";
import { createPreviewRequests } from "./preview-request.mjs";

const repository = "rboixaderg/mountain-runners";
const groupIdentifier = "-1001234567890";
const commit = "a".repeat(40);
const newerCommit = "b".repeat(40);
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
  const previewPath = join(directory, "preview.sqlite");
  const previews = new PreviewRequestStore(previewPath, { now });
  context.after(() => previews.close());
  return { previewPath, previews };
}

function openPullRequest(headSha = commit) {
  return {
    state: "open",
    headSha,
    headRepository: repository,
    previewLabeled: true,
    previewRevoked: false,
  };
}

function publisherComment(commitSha = commit, pullRequestNumber = 200) {
  return {
    user: { login: "github-actions[bot]" },
    body: `<!-- mountain-runners-preview -->\nPreview publicada: https://pr-${pullRequestNumber}.preview.mountainrunners.cat\nCommit: \`${commitSha}\`.`,
    updated_at: "2026-11-14T10:05:00Z",
  };
}

function fakeGithub() {
  // The fake has no operation to comment, to label or to read checks or
  // workflow runs: the handler must never post `/preview`, set a label or wait
  // for green checks, and such a call fails.
  const github = {
    pullRequests: { 200: openPullRequest() },
    comments: { 200: [] },
    readError: null,
    listError: null,
    listings: [],
    async getPullRequest({ number }) {
      if (github.readError) throw github.readError;
      assert.ok(number in github.pullRequests, `unexpected #${number}`);
      return github.pullRequests[number];
    },
    async listIssueComments({ number, since }) {
      github.listings.push(since);
      if (github.listError) throw github.listError;
      return github.comments[number] ?? [];
    },
  };
  return github;
}

function setup(context) {
  let current = new Date("2026-11-14T10:00:01Z");
  const { previewPath, previews } = fixture(context, () => current);
  const github = fakeGithub();
  const sent = [];
  const traces = [];
  const notes = [];
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
      findTopicPullRequest: () => 200,
      verifyMembership: async (authorIdentifier) => {
        membership.calls.push(authorIdentifier);
        return membership.result;
      },
      github,
      repository,
      telegram,
      pollIntervalMilliseconds: 1,
      confirmationTimeoutMilliseconds,
      recordTrace: (entry) => traces.push(entry),
      recordServiceNote: (note) => notes.push(note),
      now: () => current,
      ...overrides,
    });
  }
  return {
    previewPath,
    previews,
    github,
    telegram,
    membership,
    handler: buildHandler(),
    buildHandler,
    sent,
    traces,
    notes,
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

/** What the instruction runner hands over after the service pushed a commit. */
function publication(updateIdentifier, overrides = {}) {
  return {
    updateIdentifier,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commit,
    repair: false,
    ...overrides,
  };
}

function actions(traces) {
  return traces.map((entry) => entry.action);
}

function withdrawals(traces) {
  return traces
    .filter((entry) => entry.action === "preview_withdrawn")
    .map((entry) => [entry.updateIdentifier, entry.detail]);
}

test("waits for the publisher of the head without posting anything", async (context) => {
  const { handler, membership, previews, traces } = setup(context);

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /La preview d'aquest canvi s'està preparant/u);
  assert.match(
    result.report,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/200/u,
  );
  assert.equal(previews.state(20), "awaiting");
  assert.deepEqual(membership.calls, [555]);
  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [
      ["preview_requested", "#200"],
      ["preview_membership_verified", "#200"],
      ["preview_awaiting", "#200 aaaaaaa"],
    ],
  );
  for (const entry of traces) {
    assert.equal(entry.authorIdentifier, 555);
    assert.equal(entry.sessionKey, sessionKey);
  }
});

test("refuses without a pull request published in the topic", async (context) => {
  const { buildHandler, github, membership, previews, traces } = setup(context);
  const handler = buildHandler({ findTopicPullRequest: () => null });

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /encara no hi ha cap proposta publicada/u);
  assert.deepEqual(membership.calls, []);
  assert.deepEqual(github.listings, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [["preview_refused", "no_pull_request"]],
  );
});

test("refuses the preview when the author left the group before it ran", async (context) => {
  const { handler, membership, previews, traces } = setup(context);

  membership.result = { verified: false, reason: "not_a_group_member" };
  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /Ara mateix no constes com a membre/u);
  assert.match(result.report, /Demana a la persona que gestiona el grup/u);
  assert.match(
    result.report,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/200/u,
  );
  assert.deepEqual(membership.calls, [555]);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_requested", "preview_refused"]);
  assert.equal(traces[1].detail, "membership_revoked");
  assert.equal(traces[1].authorIdentifier, 555);
});

test("refuses the preview when the membership check fails", async (context) => {
  const { handler, membership, previews, traces } = setup(context);

  membership.result = { verified: false, reason: "membership_check_failed" };
  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /No he pogut comprovar que siguis al grup/u);
  assert.match(result.report, /torna-ho a demanar/u);
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
  const { previews, traces, buildHandler } = setup(context);
  const controller = new AbortController();
  const handler = buildHandler({
    verifyMembership: boundedMembership(60_000),
  });

  const pending = handler.handle(request(), { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_requested"]);
});

test("a membership read that runs out of its deadline refuses and asks to retry", async (context) => {
  const { previews, traces, buildHandler } = setup(context);
  const handler = buildHandler({ verifyMembership: boundedMembership(10) });

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /No he pogut comprovar que siguis al grup/u);
  assert.match(result.report, /torna-ho a demanar/u);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [
      ["preview_requested", "#200"],
      ["preview_refused", "membership_unavailable"],
    ],
  );
});

test("never accepts a PR or commit from the request text", async (context) => {
  const { handler, previews } = setup(context);

  await handler.handle({
    ...request(),
    instruction: `preview de la PR #999 al commit ${"f".repeat(40)}`,
  });

  assert.equal(previews.awaiting()[0].pull_request_number, 200);
  assert.equal(previews.awaiting()[0].commit_sha, commit);
});

test("accepts a head with red or pending checks without reading them", async (context) => {
  const { handler, github, previews } = setup(context);
  // The build of the preview validates the head itself: a red head is never
  // published, so the request does not wait for green checks.
  const checkReads = [];
  github.getCommitCheckRuns = async () => {
    checkReads.push("check runs");
    return [{ name: "Validate", status: "completed", conclusion: "failure" }];
  };
  github.getCommitStatuses = async () => {
    checkReads.push("statuses");
    return [{ context: "Validate", state: "pending" }];
  };

  const result = await handler.handle(request());

  assert.match(result.report, /s'està preparant/u);
  assert.equal(previews.state(20), "awaiting");
  assert.deepEqual(checkReads, []);
});

const refusalCases = [
  [
    "closed pull request",
    { state: "closed" },
    /Aquesta proposta ja està tancada, així que no se'n pot fer la preview/u,
    "not_applicable #200 aaaaaaa",
  ],
  [
    "fork",
    { headRepository: "someone/mountain-runners" },
    /no ve del repositori del club/u,
    "not_main_repository #200 aaaaaaa",
  ],
  [
    "deleted fork",
    { headRepository: null },
    /no ve del repositori del club/u,
    "not_main_repository #200 aaaaaaa",
  ],
  [
    "pull request without the preview label",
    { previewLabeled: false },
    /no té la preview activada/u,
    "no_preview_label #200 aaaaaaa",
  ],
  [
    "preview revoked by a maintainer, even with the label",
    { previewRevoked: true },
    /La preview d'aquesta proposta s'ha retirat/u,
    "preview_revoked #200 aaaaaaa",
  ],
];

for (const [name, changes, text, detail] of refusalCases) {
  test(`refuses and waits for nothing: ${name}`, async (context) => {
    const { handler, github, previews, traces } = setup(context);
    Object.assign(github.pullRequests[200], changes);

    const result = await handler.handle(request());

    assert.equal(result.outcome, "answered");
    assert.match(result.report, text);
    assert.equal(previews.state(20), undefined);
    assert.deepEqual(
      traces.map((entry) => [entry.action, entry.detail]),
      [
        ["preview_requested", "#200"],
        ["preview_membership_verified", "#200"],
        ["preview_refused", detail],
      ],
    );
  });
}

test("refuses and waits for nothing: unreadable state", async (context) => {
  const { handler, github, previews, traces } = setup(context);
  github.readError = new Error("HTTP 500");

  const result = await handler.handle(request());

  assert.match(result.report, /No he pogut llegir/u);
  assert.equal(previews.state(20), undefined);
  assert.equal(traces.at(-1).detail, "unreadable #200");
});

test("does not handle a duplicate update twice", async (context) => {
  const { handler, previews } = setup(context);

  await handler.handle(request());
  const duplicate = await handler.handle(request());

  assert.match(duplicate.report, /ja s'havia atès/u);
  assert.equal(previews.awaiting().length, 1);
});

test("refuses a repeat while the request awaits confirmation", async (context) => {
  const { handler, previews } = setup(context);

  await handler.handle(request(20));
  const repeated = await handler.handle(request(21));

  assert.match(repeated.report, /ja està demanada i encara no ha acabat/u);
  assert.equal(previews.awaiting().length, 1);
});

test("a legacy uncertain request blocks a new request for its commit", async (context) => {
  const { handler, previewPath, previews, sent } = setup(context);
  // A request written while the service still posted `/preview`, whose result
  // a restart could not know.
  seedUncertainPreviewRequest(previewPath, {
    updateIdentifier: 19,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
    createdAt: "2026-11-14T09:00:00.000Z",
  });

  const repeated = await handler.handle(request(20));
  await handler.runOnce();

  assert.match(repeated.report, /ja està demanada i encara no ha acabat/u);
  assert.equal(previews.state(20), undefined);
  assert.equal(previews.state(19), "uncertain");
  assert.equal(previews.uncertainCount(), 1);
  assert.deepEqual(sent, []);
});

test("allows a repeat for the same commit after the previous one was confirmed", async (context) => {
  const { handler, github, previews, sent } = setup(context);
  await handler.handle(request(20));
  github.comments[200] = [publisherComment()];
  await handler.runOnce();
  assert.equal(sent.length, 1);

  const repeated = await handler.handle(request(21));

  assert.match(repeated.report, /s'està preparant/u);
  assert.equal(previews.state(21), "awaiting");
});

test("allows a repeat after the previous one was not confirmed in time", async (context) => {
  const { handler, previews, advance } = setup(context);
  await handler.handle(request(20));
  advance(confirmationTimeoutMilliseconds);
  await handler.runOnce();

  await handler.handle(request(21));

  assert.equal(previews.state(21), "awaiting");
});

test("confirms a commit the publisher already published before the request", async (context) => {
  const { handler, github, previews, sent } = setup(context);
  github.comments[200] = [
    { ...publisherComment(), updated_at: "2026-11-14T09:00:00Z" },
  ];

  await handler.handle(request());
  await handler.runOnce();

  assert.equal(previews.state(20), "confirmed");
  assert.equal(sent.length, 1);
});

test("confirms through the publisher comment and reports the confirmed address", async (context) => {
  const { handler, github, sent, traces } = setup(context);
  await handler.handle(request());

  await handler.runOnce();
  assert.deepEqual(sent, []);

  github.comments[200] = [publisherComment()];
  await handler.runOnce();
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(
    sent[0].text,
    /https:\/\/pr-200\.preview\.mountainrunners\.cat/u,
  );
  assert.match(
    sent[0].text,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/200/u,
  );
  assert.doesNotMatch(sent[0].text, /commit/u);
  // Every comment is read: the label starts the build when the head is pushed,
  // so the publisher can confirm it before the request began.
  assert.deepEqual(github.listings, [undefined, undefined]);
  const confirmation = traces.find(
    (entry) => entry.action === "preview_confirmed",
  );
  assert.equal(confirmation.authorIdentifier, 555);
  assert.equal(confirmation.detail, "#200 aaaaaaa");
});

test("a service publication reports its confirmed URL without a request or green checks", async (context) => {
  const { handler, github, membership, previews, sent, notes } = setup(context);

  handler.followPublication(publication(10));
  github.comments[200] = [publisherComment()];
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /La preview ja està a punt: https:\/\/pr-200/u);
  assert.equal(previews.state(10), "confirmed");
  assert.deepEqual(membership.calls, [], "the publication is the request");
  assert.deepEqual(
    notes.map((note) => note.effectKey),
    [`preview:10:${commit}:confirmed`],
  );
});

test("two publications in a row report only the final head, once", async (context) => {
  const { handler, github, previews, sent, notes, traces } = setup(context);
  handler.followPublication(publication(10));
  handler.followPublication(publication(11, { commit: newerCommit }));
  github.pullRequests[200].headSha = newerCommit;
  // The publisher confirmed both heads: only the final one is announced.
  github.comments[200] = [publisherComment(), publisherComment(newerCommit)];

  await handler.runOnce();
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(
    notes.map((note) => note.text),
    [`Preview de la PR #200 (commit bbbbbbb) publicada a ${origin}.`],
  );
  assert.equal(previews.state(10), "failed");
  assert.equal(previews.state(11), "confirmed");
  assert.deepEqual(withdrawals(traces), [[10, "superseded #200 aaaaaaa"]]);
});

test("a repair follows its new commit in the row of the publication it continues", async (context) => {
  const { handler, github, previews, sent, notes } = setup(context);
  handler.followPublication(publication(10));
  handler.followPublication({
    ...publication(10, { commit: newerCommit }),
    repair: true,
  });
  github.pullRequests[200].headSha = newerCommit;
  github.comments[200] = [publisherComment(), publisherComment(newerCommit)];

  await handler.runOnce();
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(
    notes.map((note) => note.effectKey),
    [`preview:10:${newerCommit}:confirmed`],
  );
  assert.equal(previews.state(10), "confirmed");
});

test("a repair without a publication to continue follows nothing", async (context) => {
  const { handler, previews, sent } = setup(context);

  handler.followPublication({ ...publication(10), repair: true });
  await handler.runOnce();

  assert.equal(previews.state(10), undefined);
  assert.deepEqual(sent, []);
});

test("a failure to follow a publication is only logged", async (context) => {
  const { buildHandler } = setup(context);
  const logs = [];
  const handler = buildHandler({
    store: {
      track() {
        throw new TypeError("secret detail");
      },
    },
    logger: (event, detail) => logs.push([event, detail]),
  });

  handler.followPublication(publication(10));

  assert.deepEqual(logs, [["preview_follow_failed", "TypeError"]]);
});

test("a request after a maintainer's push previews the new head and drops the old one silently", async (context) => {
  const { handler, github, previews, sent, traces } = setup(context);
  handler.followPublication(publication(10));
  github.pullRequests[200].headSha = newerCommit;

  const result = await handler.handle(request(20));
  github.comments[200] = [publisherComment(), publisherComment(newerCommit)];
  await handler.runOnce();

  assert.match(result.report, /s'està preparant/u);
  assert.equal(sent.length, 1);
  assert.equal(previews.state(10), "failed");
  assert.equal(previews.state(20), "confirmed");
  assert.deepEqual(withdrawals(traces), [[10, "superseded #200 aaaaaaa"]]);
});

const withdrawalCases = [
  [
    "the preview label was removed",
    { previewLabeled: false },
    "no_preview_label",
  ],
  [
    "a maintainer revoked the preview",
    { previewRevoked: true },
    "preview_revoked",
  ],
  ["the pull request was closed", { state: "closed" }, "not_applicable"],
];

for (const [name, changes, reason] of withdrawalCases) {
  test(`ends silently when ${name}, even with a confirmation for the head`, async (context) => {
    const { handler, github, previews, sent, notes, traces, advance } =
      setup(context);
    handler.followPublication(publication(10));
    github.comments[200] = [publisherComment()];
    Object.assign(github.pullRequests[200], changes);

    await handler.runOnce();
    advance(confirmationTimeoutMilliseconds);
    await handler.runOnce();

    assert.deepEqual(sent, []);
    assert.deepEqual(notes, []);
    assert.equal(previews.state(10), "failed");
    assert.deepEqual(withdrawals(traces), [[10, `${reason} #200 aaaaaaa`]]);
  });
}

test("previews of two pull requests awaiting together never supersede each other", async (context) => {
  const { handler, github, previews, sent } = setup(context);
  github.pullRequests[201] = openPullRequest(newerCommit);
  handler.followPublication(publication(10));
  handler.followPublication(
    publication(11, { pullRequestNumber: 201, commit: newerCommit }),
  );
  github.comments[200] = [publisherComment()];
  github.comments[201] = [publisherComment(newerCommit, 201)];

  await handler.runOnce();

  assert.equal(previews.state(10), "confirmed");
  assert.equal(previews.state(11), "confirmed");
  assert.deepEqual(
    sent.map((message) => message.text.match(/https:\/\/pr-\d+/u)[0]),
    ["https://pr-200", "https://pr-201"],
  );
});

test("records one note for a preview notice that is retried", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-preview-notes-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  const { buildHandler, github, telegram, sent } = setup(context);
  const handler = buildHandler({
    recordServiceNote: ({ sessionKey: key, text: noteText, effectKey }) =>
      notes.addNote({ sessionKey: key, text: noteText, effectKey }),
  });
  await handler.handle(request());
  github.comments[200] = [publisherComment()];

  telegram.sendError = new Error("telegram is down");
  await handler.runOnce();
  telegram.sendError = null;
  await handler.runOnce();

  assert.equal(sent.length, 1, "the retry is the one that reaches the topic");
  const confirmedNote = `Preview de la PR #200 (commit aaaaaaa) publicada a ${origin}.`;
  assert.equal(notes.lastReply(sessionKey), confirmedNote);
  assert.deepEqual(
    notes.claim(sessionKey).map((note) => note.text),
    [confirmedNote],
    "the session receives the retried effect once",
  );
});

test("keeps the preview confirmation as a service event of its session", async (context) => {
  const { handler, github, sent, notes } = setup(context);
  await handler.handle(request());
  assert.deepEqual(
    notes,
    [],
    "the synchronous report is the instruction result",
  );

  github.comments[200] = [publisherComment()];
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(notes, [
    {
      sessionKey,
      text: `Preview de la PR #200 (commit aaaaaaa) publicada a ${origin}.`,
      receivedText: sent[0].text,
      effectKey: `preview:20:${commit}:confirmed`,
    },
  ]);
});

test("keeps the plain reply as the last text of the topic", async (context) => {
  const { handler, github, notes } = setup(context);
  await handler.handle(request());
  github.comments[200] = [publisherComment()];

  await handler.runOnce();

  const note = notes.at(-1);
  assert.match(note.text, /publicada a/u);
  assert.match(note.receivedText, /La preview ja està a punt/u);
  assert.notEqual(note.receivedText, note.text);
});

test("waits the 25 minutes the policy fixes for a confirmation", () => {
  assert.equal(previewConfirmationTimeoutMilliseconds, 25 * 60 * 1000);
});

test("reports an unconfirmed preview at the deadline without guessing a URL", async (context) => {
  const { handler, previews, sent, traces, advance } = setup(context);
  await handler.handle(request());

  advance(confirmationTimeoutMilliseconds - 1);
  await handler.runOnce();
  assert.deepEqual(sent, []);

  advance(1);
  await handler.runOnce();
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /No he pogut confirmar que la preview/u);
  assert.match(sent[0].text, /Si vols, digues-m'ho i ho miro/u);
  assert.doesNotMatch(sent[0].text, /preview\.mountainrunners\.cat/u);
  assert.equal(previews.state(20), "timed_out");
  assert.ok(actions(traces).includes("preview_unconfirmed"));
});

test("an unconfirmed report carries the requester and waits for a read", async (context) => {
  const { handler, github, sent, traces, previews, advance } = setup(context);
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
  const { buildHandler, handler, sent, advance } = setup(context);
  await handler.handle(request());
  advance(confirmationTimeoutMilliseconds);

  const restarted = buildHandler();
  await restarted.runOnce();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /No he pogut confirmar que la preview/u);
});

test("an unconfirmed note keeps the facts of the session", async (context) => {
  const { handler, advance, sent, notes } = setup(context);
  await handler.handle(request());
  advance(confirmationTimeoutMilliseconds);

  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(notes, [
    {
      sessionKey,
      text: "Preview de la PR #200 (commit aaaaaaa) sense confirmació dins del termini: no hi ha cap adreça confirmada.",
      receivedText: sent[0].text,
      effectKey: `preview:20:${commit}:unconfirmed`,
    },
  ]);
});

test("a failed report keeps the request awaiting and a later cycle sends it", async (context) => {
  const { handler, github, telegram, previews, sent } = setup(context);
  await handler.handle(request());
  github.comments[200] = [publisherComment()];

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
  const { handler, telegram, previews, sent, advance } = setup(context);
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
  const { handler, github, previews, sent } = setup(context);
  await handler.handle(request());
  const controller = new AbortController();
  github.comments[200] = [publisherComment()];
  github.listIssueComments = async () => {
    controller.abort();
    return github.comments[200];
  };

  await handler.runOnce({ signal: controller.signal });

  assert.deepEqual(sent, []);
  assert.equal(previews.state(20), "awaiting");
});

test("aborting during the live preconditions rethrows instead of refusing", async (context) => {
  const { handler, github, previews } = setup(context);
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

test("confirms a reconciled request from a publisher comment written after it", async (context) => {
  const { previewPath, previews, github, handler, sent, setClock, traces } =
    setup(context);
  // A request written while the service still posted `/preview`, whose result
  // was unknown and that a person reconciled later.
  seedUncertainPreviewRequest(previewPath, {
    updateIdentifier: 20,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
    createdAt: "2026-11-14T10:00:00.000Z",
  });

  setClock("2026-11-14T11:00:00Z");
  previews.resolveUncertainCommented(20);

  github.comments[200] = [
    { ...publisherComment(), created_at: "2026-11-14T10:05:00Z" },
  ];
  await handler.runOnce();

  assert.equal(previews.state(20), "confirmed");
  assert.equal(sent.length, 1);
  assert.match(
    sent[0].text,
    /https:\/\/pr-200\.preview\.mountainrunners\.cat/u,
  );
  assert.deepEqual(github.listings, [undefined]);
  assert.ok(actions(traces).includes("preview_confirmed"));
});
