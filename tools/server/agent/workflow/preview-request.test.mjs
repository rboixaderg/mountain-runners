import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyMembership } from "telegram-pi-bridge/telegram";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { PreviewRequestStore } from "../repository/preview-request-store.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import { requestSignal } from "../repository/request-signal.mjs";
import { previewConfirmationTimeoutMilliseconds } from "../policy/development.mjs";
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
  // The fake has no operation to comment or to label: the handler must never
  // post `/preview`, set a label or read workflow runs, and a call fails.
  const github = {
    pullRequest: {
      state: "open",
      headSha: commit,
      headRepository: repository,
      previewLabeled: true,
      htmlUrl: `https://github.com/${repository}/pull/200`,
    },
    // The CI watch reads the required checks of the same fake.
    checkRuns: [
      { name: "Validate", status: "completed", conclusion: "success" },
    ],
    statuses: [],
    comments: [],
    readError: null,
    listError: null,
    listings: [],
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

test("waits for the publisher of the reported commit without posting anything", async (context) => {
  const { ciWatches, handler, membership, previews, traces } = setup(context);
  reportGreen(ciWatches);

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /La preview d'aquest canvi s'està preparant/u);
  assert.match(
    result.report,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/200/u,
  );
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
  const { ciWatches, handler, membership, previews, traces } = setup(context);
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
  assert.match(result.report, /hi ha un canvi pendent de comprovar/u);
  assert.match(
    result.report,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/202/u,
  );
  assert.doesNotMatch(result.report, /pull\/200/u);
  assert.match(result.report, /No s'ha demanat cap preview/u);
  assert.deepEqual(membership.calls, []);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_refused"]);
  assert.equal(traces[0].detail, "newer_work #202 bbbbbbb");
});

test("refuses even when the unknown notice is older than the delivered one", async (context) => {
  const { ciWatches, handler, previews, traces } = setup(context);
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
  assert.match(result.report, /hi ha un canvi pendent de comprovar/u);
  assert.match(
    result.report,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/198/u,
  );
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), ["preview_refused"]);
  assert.equal(traces[0].detail, "newer_work #198 ccccccc");
});

test("refuses while an automatic repair is preparing the newer change", async (context) => {
  const { ciWatches, handler, previews, traces } = setup(context);
  reportGreen(ciWatches);
  // The newer work is a repair: its new commit does not exist yet.
  ciWatches.requestRepair({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    failureFingerprint: "Validate",
    failedChecks: ["Validate"],
    evidence: "synthetic",
    commitSha: commit,
    maximumAttempts: 2,
  });

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(
    result.report,
    /s'està preparant un canvi pendent de comprovar/u,
  );
  assert.doesNotMatch(result.report, /aaaaaa/u);
  assert.equal(previews.state(20), undefined);
  assert.equal(traces[0].detail, "newer_work #200 repair");
});

test("refuses the preview when the author left the group before it ran", async (context) => {
  const { ciWatches, handler, membership, previews, traces } = setup(context);
  reportGreen(ciWatches);

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
  const { ciWatches, handler, membership, previews, traces } = setup(context);
  reportGreen(ciWatches);

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
  const { ciWatches, previews, traces, buildHandler } = setup(context);
  reportGreen(ciWatches);
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
  const { ciWatches, previews, traces, buildHandler } = setup(context);
  reportGreen(ciWatches);
  const handler = buildHandler({ verifyMembership: boundedMembership(10) });

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /No he pogut comprovar que siguis al grup/u);
  assert.match(result.report, /torna-ho a demanar/u);
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [
      ["preview_requested", "#200 aaaaaaa"],
      ["preview_refused", "membership_unavailable"],
    ],
  );
});

test("refuses without a pull request reported in the topic", async (context) => {
  const { handler, traces } = setup(context);

  const result = await handler.handle(request());
  assert.match(
    result.report,
    /no hi ha cap canvi amb totes les comprovacions/u,
  );
  assert.equal(traces[0].detail, "no_reported_commit");
});

test("requests a preview after a human rerun makes a repairing watch green", async (context) => {
  const { ciWatches, handler, previews } = setup(context);
  ciWatches.add({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  ciWatches.beginSend(10, "repairing");
  ciWatches.finishSend(10);

  const result = await handler.handle(request());

  assert.match(result.report, /s'està preparant/u);
  assert.equal(previews.state(20), "awaiting");
});

test("never accepts a PR or commit from the request text", async (context) => {
  const { ciWatches, handler, previews } = setup(context);
  reportGreen(ciWatches);

  await handler.handle({
    ...request(),
    instruction: `preview de la PR #999 al commit ${"f".repeat(40)}`,
  });

  assert.equal(previews.awaiting()[0].pull_request_number, 200);
  assert.equal(previews.awaiting()[0].commit_sha, commit);
});

const refusalCases = [
  [
    "closed pull request",
    {
      pullRequest: {
        state: "closed",
        headSha: commit,
        headRepository: repository,
      },
    },
    /Aquesta proposta ja està tancada/u,
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
    /no ve del repositori del club/u,
  ],
  [
    "deleted fork",
    { pullRequest: { state: "open", headSha: commit, headRepository: null } },
    /no ve del repositori del club/u,
  ],
  [
    "pull request without the preview label",
    {
      pullRequest: {
        state: "open",
        headSha: commit,
        headRepository: repository,
        previewLabeled: false,
      },
    },
    /no té la preview activada/u,
  ],
  [
    "unreadable state",
    { readError: new Error("HTTP 500") },
    /No he pogut llegir/u,
  ],
];

for (const [name, state, text] of refusalCases) {
  test(`refuses and waits for nothing: ${name}`, async (context) => {
    const { ciWatches, handler, previews, traces } = setup(context, {
      github: fakeGithub(state),
    });
    reportGreen(ciWatches);

    const result = await handler.handle(request());

    assert.equal(result.outcome, "answered");
    assert.match(result.report, text);
    assert.equal(previews.state(20), undefined);
    assert.ok(actions(traces).includes("preview_refused"));
  });
}

test("previews the current head when a maintainer updated it outside the agent", async (context) => {
  const { ciWatches, handler, github, previews, sent, traces } = setup(context);
  reportGreen(ciWatches);
  // The maintainer merged main into the pull request branch after the reported
  // notice: the head is newer.
  const movedCommit = "b".repeat(40);
  github.pullRequest = { ...github.pullRequest, headSha: movedCommit };

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /s'està preparant/u);
  assert.equal(previews.state(20), "awaiting");
  assert.equal(
    previews.awaiting()[0].commit_sha,
    movedCommit,
    "the stored request is bound to the head",
  );
  assert.deepEqual(
    traces.map((entry) => entry.detail),
    ["#200 aaaaaaa", "#200 aaaaaaa", "#200 bbbbbbb"],
    "the request and the membership name the reported commit; the preview names the head",
  );

  // The publisher builds and names the head, so only that comment confirms it.
  github.comments = [
    publisherComment({
      body: `<!-- mountain-runners-preview -->\nPreview publicada: ${origin}\nCommit: \`${movedCommit}\`.`,
    }),
  ];
  await handler.runOnce();

  assert.equal(previews.state(20), "confirmed");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /pr-200\.preview\.mountainrunners\.cat/u);
  const confirmation = traces.find(
    (entry) => entry.action === "preview_confirmed",
  );
  assert.equal(confirmation.detail, "#200 bbbbbbb");
});

test("refuses a closed proposal without waiting for anything", async (context) => {
  const { ciWatches, handler, previews, traces } = setup(context, {
    github: fakeGithub({
      pullRequest: {
        state: "closed",
        headSha: commit,
        headRepository: repository,
      },
    }),
  });
  reportGreen(ciWatches);

  const result = await handler.handle(request());

  assert.equal(result.outcome, "answered");
  assert.match(
    result.report,
    /Aquesta proposta ja està tancada, així que no se'n pot fer la preview/u,
  );
  assert.equal(previews.state(20), undefined);
  assert.deepEqual(actions(traces), [
    "preview_requested",
    "preview_membership_verified",
    "preview_refused",
  ]);
  assert.equal(traces[2].detail, "not_applicable #200 aaaaaaa");
});

test("does not handle a duplicate update twice", async (context) => {
  const { ciWatches, handler, previews } = setup(context);
  reportGreen(ciWatches);

  await handler.handle(request());
  const duplicate = await handler.handle(request());

  assert.match(duplicate.report, /ja s'havia atès/u);
  assert.equal(previews.awaiting().length, 1);
});

test("refuses a repeat while the request awaits confirmation", async (context) => {
  const { ciWatches, handler, previews } = setup(context);
  reportGreen(ciWatches);

  await handler.handle(request(20));
  const repeated = await handler.handle(request(21));

  assert.match(repeated.report, /ja està demanada i encara no ha acabat/u);
  assert.equal(previews.awaiting().length, 1);
});

test("allows a repeat for the same commit after the previous one was confirmed", async (context) => {
  const { ciWatches, handler, github, previews, sent } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request(20));
  github.comments = [publisherComment()];
  await handler.runOnce();
  assert.equal(sent.length, 1);

  const repeated = await handler.handle(request(21));

  assert.match(repeated.report, /s'està preparant/u);
  assert.equal(previews.state(21), "awaiting");
});

test("allows a repeat after the previous one was not confirmed in time", async (context) => {
  const { ciWatches, handler, previews, advance } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request(20));
  advance(confirmationTimeoutMilliseconds);
  await handler.runOnce();

  await handler.handle(request(21));

  assert.equal(previews.state(21), "awaiting");
});

test("two pushes in a row report only the address of the final head", async (context) => {
  const { ciWatches, handler, github, previews, sent, traces } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request(20));
  const finalCommit = "c".repeat(40);
  github.pullRequest = { ...github.pullRequest, headSha: finalCommit };
  reportGreen(ciWatches, 11, finalCommit);
  await handler.handle(request(21));

  // The publisher comment still names the first head: it is never reported.
  github.comments = [publisherComment()];
  await handler.runOnce();
  assert.deepEqual(sent, []);
  assert.equal(previews.state(20), "failed");
  assert.equal(previews.state(21), "awaiting");

  github.comments = [
    publisherComment({
      body: `<!-- mountain-runners-preview -->\nPreview publicada: ${origin}\nCommit: \`${finalCommit}\`.`,
    }),
  ];
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /pr-200\.preview\.mountainrunners\.cat/u);
  assert.equal(previews.state(21), "confirmed");
  assert.ok(actions(traces).includes("preview_superseded"));
});

test("confirms a commit the publisher already published before the request", async (context) => {
  const { ciWatches, handler, github, previews, sent } = setup(context);
  reportGreen(ciWatches);
  github.comments = [publisherComment({ updated_at: "2026-11-14T09:00:00Z" })];

  await handler.handle(request());
  await handler.runOnce();

  assert.equal(previews.state(20), "confirmed");
  assert.equal(sent.length, 1);
});

test("a new green commit allows a new request while the old one waits", async (context) => {
  const { ciWatches, handler, github, previews } = setup(context);
  reportGreen(ciWatches);
  await handler.handle(request(20));

  const newCommit = "c".repeat(40);
  github.pullRequest = { ...github.pullRequest, headSha: newCommit };
  reportGreen(ciWatches, 11, newCommit);
  await handler.handle(request(21));

  assert.equal(previews.awaiting().length, 2);
});

test("confirms through the publisher comment and reports the confirmed address", async (context) => {
  const { ciWatches, handler, github, previews, sent, traces } = setup(context);
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
  assert.equal(
    previews.latest({ sessionKey, pullRequestNumber: 200 }).confirmed_origin,
    "https://pr-200.preview.mountainrunners.cat",
    "the confirmed URL is kept for the next turn of the topic",
  );
});

test("records one note for a preview notice that is retried", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-preview-notes-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  const { ciWatches, buildHandler, github, telegram, sent } = setup(context);
  const handler = buildHandler({
    recordServiceNote: ({ sessionKey: key, text: noteText, effectKey }) =>
      notes.addNote({ sessionKey: key, text: noteText, effectKey }),
  });
  reportGreen(ciWatches);
  await handler.handle(request());
  github.comments = [publisherComment()];

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
  assert.equal(ciWatches.lastReported(sessionKey).result, "success");
});

test("keeps the preview confirmation as a service event of its session", async (context) => {
  const { ciWatches, buildHandler, github, sent } = setup(context);
  const notes = [];
  const handler = buildHandler({
    recordServiceNote: (note) => notes.push(note),
  });
  reportGreen(ciWatches);
  await handler.handle(request());
  assert.deepEqual(
    notes,
    [],
    "the synchronous report is the instruction result",
  );

  github.comments = [publisherComment()];
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(notes, [
    {
      sessionKey,
      text: `Preview de la PR #200 (commit aaaaaaa) publicada a ${origin}.`,
      receivedText: sent[0].text,
      effectKey: "preview:20:confirmed",
    },
  ]);
});

test("waits the 25 minutes the policy fixes for a confirmation", () => {
  assert.equal(previewConfirmationTimeoutMilliseconds, 25 * 60 * 1000);
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
  assert.match(sent[0].text, /No he pogut confirmar que la preview/u);
  assert.match(sent[0].text, /Si vols, digues-m'ho i ho miro/u);
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
  assert.match(sent[0].text, /No he pogut confirmar que la preview/u);
});

test("an unconfirmed note keeps the facts of the session", async (context) => {
  const { ciWatches, buildHandler, advance, sent } = setup(context);
  const notes = [];
  const handler = buildHandler({
    recordServiceNote: (note) => notes.push(note),
  });
  reportGreen(ciWatches);
  await handler.handle(request());
  advance(confirmationTimeoutMilliseconds);

  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(notes, [
    {
      sessionKey,
      text: "Preview de la PR #200 (commit aaaaaaa) sense confirmació dins del termini: no hi ha cap adreça confirmada.",
      receivedText: sent[0].text,
      effectKey: "preview:20:unconfirmed",
    },
  ]);
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

test("never requests a preview for a change that did not ask for it", async (context) => {
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
  assert.match(sent[0].text, /La proposta està llesta/u);
  assert.match(
    sent[0].text,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/200/u,
  );
  assert.doesNotMatch(sent[0].text, /Validate|bbbbbbb|PR #/u);
});

test("a green watch that asked for the preview waits for it once, even when handled again", async (context) => {
  const { ciWatches, github, handler } = setup(context);
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
    requestPreview: handler.handle,
  });
  createCiWatchRegistration({ store: ciWatches })({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    commit,
    previewAuthorIdentifier: 555,
  });

  await worker.runOnce();
  assert.match(sent[0].text, /Ara demano la preview/u);
  assert.match(sent[1].text, /La preview d'aquest canvi s'està preparant/u);
  assert.deepEqual(github.listings, [], "nothing awaits a confirmation yet");

  // A restart that finds the same publication green handles the watch again:
  // the preview store already knows that update, so it is not handled twice.
  ciWatches.reopen({
    updateIdentifier: 10,
    sessionKey,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  await worker.runOnce();

  assert.match(sent.at(-1).text, /Aquesta petició de preview ja s'havia atès/u);
});

test("confirms a reconciled request from a publisher comment written after it", async (context) => {
  const { ciWatches, previews, github, handler, sent, setClock, traces } =
    setup(context);
  reportGreen(ciWatches);
  setClock("2026-11-14T10:00:00Z");
  // A request written while the service still posted `/preview`, whose result
  // was unknown and that a person reconciled later.
  previews.begin({
    updateIdentifier: 20,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  previews.markUncertain(20);

  setClock("2026-11-14T11:00:00Z");
  previews.resolveUncertainCommented(20);

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
  assert.deepEqual(github.listings, [undefined]);
  assert.ok(actions(traces).includes("preview_confirmed"));
});

test("keeps the plain reply as the last text of the topic", async (context) => {
  const { ciWatches, handler, github, notes } = (() => {
    const environment = setup(context);
    const collected = [];
    return {
      ...environment,
      notes: collected,
      handler: environment.buildHandler({
        recordServiceNote: (note) => collected.push(note),
      }),
    };
  })();
  reportGreen(ciWatches);
  await handler.handle(request());
  github.comments = [publisherComment()];

  await handler.runOnce();

  const note = notes.at(-1);
  assert.match(note.text, /publicada a/u);
  assert.match(note.receivedText, /La preview ja està a punt/u);
  assert.notEqual(note.receivedText, note.text);
});
