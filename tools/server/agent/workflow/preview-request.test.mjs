import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PreviewRequestStore } from "../repository/preview-request-store.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import {
  failedMaintainerNotice,
  previewConfirmationTimeoutMilliseconds,
} from "../policy/development.mjs";
import { createPreviewRequests } from "./preview-request.mjs";

const repository = "rboixaderg/mountain-runners";
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
  const previews = new PreviewRequestStore(join(directory, "preview.sqlite"), {
    now,
  });
  context.after(() => previews.close());
  return { previews };
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
    async listIssueComments({ number }) {
      github.listings.push(number);
      if (github.listError) throw github.listError;
      return github.comments[number] ?? [];
    },
  };
  return github;
}

function setup(context) {
  let current = new Date("2026-11-14T10:00:01Z");
  const { previews } = fixture(context, () => current);
  const github = fakeGithub();
  const sent = [];
  const traces = [];
  const notes = [];
  const telegram = {
    sendError: null,
    // What Telegram accepts with the text: the message whose identifier a later
    // reply points at. `answer` replaces it for a send that names no usable one.
    answer: null,
    nextMessageIdentifier: 900,
    async sendMessage(message) {
      if (telegram.sendError) throw telegram.sendError;
      sent.push(message);
      if (telegram.answer !== null) return telegram.answer;
      telegram.nextMessageIdentifier += 1;
      return { message_id: telegram.nextMessageIdentifier };
    },
  };
  function buildHandler(overrides = {}) {
    return createPreviewRequests({
      store: previews,
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
    previews,
    github,
    telegram,
    handler: buildHandler(),
    buildHandler,
    sent,
    traces,
    notes,
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
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
    ...overrides,
  };
}

function actions(traces) {
  return traces.map((entry) => entry.action);
}

/** The publication the topic followed, as a merge binds its delivered notice. */
function deliveredNotice(updateIdentifier = 10) {
  return {
    sessionKey,
    updateIdentifier,
    pullRequestNumber: 200,
    commitSha: commit,
  };
}

function withdrawals(traces) {
  return traces
    .filter((entry) => entry.action === "preview_withdrawn")
    .map((entry) => [entry.updateIdentifier, entry.detail]);
}

test("confirms a commit the publisher already published before it was followed", async (context) => {
  const { handler, github, previews, sent } = setup(context);
  github.comments[200] = [
    { ...publisherComment(), updated_at: "2026-11-14T09:00:00Z" },
  ];

  handler.followPublication(publication(20));
  await handler.runOnce();

  assert.equal(previews.state(20), "confirmed");
  assert.equal(sent.length, 1);
});

test("confirms through the publisher comment and reports the confirmed address", async (context) => {
  const { handler, github, sent, traces } = setup(context);
  handler.followPublication(publication(20));

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
  assert.deepEqual(github.listings, [200, 200]);
  const confirmation = traces.find(
    (entry) => entry.action === "preview_confirmed",
  );
  assert.equal(confirmation.authorIdentifier, 555);
  assert.equal(confirmation.detail, "#200 aaaaaaa");
});

test("a service publication reports its confirmed URL without a request or green checks", async (context) => {
  const { handler, github, previews, sent, notes } = setup(context);

  handler.followPublication(publication(10));
  github.comments[200] = [publisherComment()];
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.match(
    sent[0].text,
    /^Ja ho pots veure: https:\/\/pr-200\.preview\.mountainrunners\.cat\n/u,
  );
  assert.equal(previews.state(10), "confirmed");
  assert.deepEqual(
    notes.map((note) => note.effectKey),
    [`preview:10:${commit}:confirmed`],
  );
});

test("a confirmed notice keeps the identifier Telegram accepted as the delivered preview", async (context) => {
  const { handler, github, previews, telegram } = setup(context);
  handler.followPublication(publication(10));
  github.comments[200] = [publisherComment()];

  await handler.runOnce();

  assert.equal(telegram.nextMessageIdentifier, 901);
  const delivered = previews.deliveredPublicationPreview(deliveredNotice());
  assert.equal(delivered.pull_request_number, 200);
  assert.equal(delivered.commit_sha, commit);
  assert.equal(delivered.notice_message_identifier, 901);
});

test("a synchronized publication only asks to review again once its preview notice reaches the topic", async (context) => {
  const { handler, buildHandler, github, telegram, previews, sent } =
    setup(context);
  handler.followPublication({
    ...publication(10),
    mergeSynchronization: true,
  });
  github.comments[200] = [publisherComment()];

  telegram.sendError = new Error("telegram down");
  await handler.runOnce();

  assert.equal(previews.state(10), "awaiting");
  assert.equal(previews.deliveredPublicationPreview(deliveredNotice()), null);

  telegram.sendError = null;
  await buildHandler().runOnce();

  assert.match(sent[0].text, /Revisa-la i torna a demanar el merge/u);
  assert.equal(
    previews.deliveredPublicationPreview(deliveredNotice())
      .notice_message_identifier,
    901,
  );
});

test("revocation of a synchronized preview informs the topic without delivering an authorizing notice", async (context) => {
  const { handler, github, previews, sent } = setup(context);
  handler.followPublication({
    ...publication(10),
    mergeSynchronization: true,
  });
  github.comments[200] = [publisherComment()];
  github.pullRequests[200].previewRevoked = true;

  await handler.runOnce();

  assert.match(sent[0].text, /ja no és disponible/u);
  assert.equal(previews.state(10), "failed");
  assert.equal(previews.deliveredPublicationPreview(deliveredNotice()), null);
});

const unidentifiedAnswers = [
  ["no message identifier", {}],
  ["a zero identifier", { message_id: 0 }],
];

for (const [name, answer] of unidentifiedAnswers) {
  test(`a notice answered with ${name} is never a delivered preview`, async (context) => {
    const { buildHandler, github, previews, telegram } = setup(context);
    const logs = [];
    const handler = buildHandler({
      logger: (event, detail) => logs.push([event, detail]),
    });
    handler.followPublication(publication(10));
    github.comments[200] = [publisherComment()];

    telegram.answer = answer;
    await handler.runOnce();

    assert.equal(previews.state(10), "confirmed");
    assert.equal(previews.deliveredPublicationPreview(deliveredNotice()), null);
    assert.deepEqual(logs, [["preview_notice_unidentified", "#200 aaaaaaa"]]);
  });
}

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
  [
    "the branch belongs to a fork",
    { headRepository: "someone/mountain-runners" },
    "not_main_repository",
  ],
  ["the fork was deleted", { headRepository: null }, "not_main_repository"],
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
  handler.followPublication(publication(20));
  github.comments[200] = [publisherComment()];

  telegram.sendError = new Error("telegram is down");
  await handler.runOnce();
  telegram.sendError = null;
  await handler.runOnce();

  assert.equal(sent.length, 1, "the retry is the one that reaches the topic");
  const confirmedNote = `Preview de la PR #200 (commit aaaaaaa) publicada a ${origin}.`;
  assert.deepEqual(
    notes.claim(sessionKey).map((note) => note.text),
    [confirmedNote],
    "the session receives the retried effect once",
  );
});

test("keeps the preview confirmation as a service event of its session", async (context) => {
  const { handler, github, sent, notes } = setup(context);
  handler.followPublication(publication(20));
  github.comments[200] = [publisherComment()];
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(notes, [
    {
      sessionKey,
      text: `Preview de la PR #200 (commit aaaaaaa) publicada a ${origin}.`,
      effectKey: `preview:20:${commit}:confirmed`,
    },
  ]);
});

test("waits the 25 minutes the policy fixes for a confirmation", () => {
  assert.equal(previewConfirmationTimeoutMilliseconds, 25 * 60 * 1000);
});

test("reports an unconfirmed preview at the deadline without guessing a URL", async (context) => {
  const { handler, previews, sent, traces, advance } = setup(context);
  handler.followPublication(publication(20));

  advance(confirmationTimeoutMilliseconds - 1);
  await handler.runOnce();
  assert.deepEqual(sent, []);

  advance(1);
  await handler.runOnce();
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, failedMaintainerNotice);
  assert.doesNotMatch(sent[0].text, /preview\.mountainrunners\.cat/u);
  assert.deepEqual(
    traces
      .filter((entry) => entry.action === "maintainer_attention")
      .map((entry) => entry.detail),
    ["previewUnconfirmed"],
  );
  assert.equal(previews.state(20), "timed_out");
  assert.ok(actions(traces).includes("preview_unconfirmed"));
});

test("reports an unconfirmed preview at the deadline even when GitHub keeps failing", async (context) => {
  const { handler, previews, sent, github, advance } = setup(context);
  handler.followPublication(publication(20));
  github.listError = new Error("GitHub failed");

  advance(confirmationTimeoutMilliseconds - 1);
  await handler.runOnce();
  assert.deepEqual(sent, []);
  assert.equal(previews.state(20), "awaiting");

  advance(1);
  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, failedMaintainerNotice);
  assert.equal(previews.state(20), "timed_out");
});

test("an unconfirmed report carries the requester", async (context) => {
  const { handler, sent, traces, previews, advance } = setup(context);
  handler.followPublication(publication(20));
  advance(confirmationTimeoutMilliseconds);

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
  handler.followPublication(publication(20));
  advance(confirmationTimeoutMilliseconds);

  const restarted = buildHandler();
  await restarted.runOnce();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, failedMaintainerNotice);
});

test("an unconfirmed note keeps the facts of the session", async (context) => {
  const { handler, advance, sent, notes } = setup(context);
  handler.followPublication(publication(20));
  advance(confirmationTimeoutMilliseconds);

  await handler.runOnce();

  assert.equal(sent.length, 1);
  assert.deepEqual(notes, [
    {
      sessionKey,
      text: "Preview de la PR #200 (commit aaaaaaa) sense confirmació dins del termini: no hi ha cap adreça confirmada.",
      effectKey: `preview:20:${commit}:unconfirmed`,
    },
  ]);
});

test("a failed report keeps the request awaiting and a later cycle sends it", async (context) => {
  const { handler, github, telegram, previews, sent } = setup(context);
  handler.followPublication(publication(20));
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
  handler.followPublication(publication(20));
  advance(confirmationTimeoutMilliseconds);

  telegram.sendError = new Error("telegram down");
  await handler.runOnce();
  assert.equal(previews.state(20), "awaiting");

  telegram.sendError = null;
  await handler.runOnce();
  assert.equal(sent.length, 1);
  assert.equal(previews.state(20), "timed_out");
});

test("a synchronization the service is replacing is not reported as withdrawn", async (context) => {
  const { buildHandler, github, previews, sent } = setup(context);
  let working = true;
  const handler = buildHandler({ hasWorkInProgress: () => working });
  handler.followPublication(publication(10, { mergeSynchronization: true }));
  github.pullRequests[200].headSha = newerCommit;

  // The newer commit is pushed but its publication is not followed yet.
  await handler.runOnce();
  assert.equal(previews.state(10), "awaiting");

  // It is followed while the older row is being read.
  const listComments = github.listIssueComments;
  github.listIssueComments = async (options) => {
    handler.followPublication(publication(11, { commit: newerCommit }));
    working = false;
    github.listIssueComments = listComments;
    return listComments(options);
  };
  await handler.runOnce();

  assert.equal(previews.state(10), "failed");
  assert.deepEqual(sent, []);
});

test("an aborted cycle reports and finishes nothing", async (context) => {
  const { handler, github, previews, sent } = setup(context);
  handler.followPublication(publication(20));
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

test("a poll of an older commit never ends the row rewritten for a newer one", async (context) => {
  const { handler, github, previews, sent } = setup(context);
  handler.followPublication(publication(10));
  github.comments[200] = [publisherComment()];
  // While the poll of the first commit waits for GitHub, a later publication of
  // the same update writes the row again for the newer commit.
  const listComments = github.listIssueComments;
  github.listIssueComments = async (options) => {
    const comments = await listComments(options);
    handler.followPublication(publication(10, { commit: newerCommit }));
    return comments;
  };

  await handler.runOnce();

  assert.equal(previews.state(10), "awaiting");
  assert.equal(previews.awaiting()[0].commit_sha, newerCommit);
  assert.equal(previews.awaiting()[0].confirmed_origin, null);
  assert.equal(sent.length, 1);
});
