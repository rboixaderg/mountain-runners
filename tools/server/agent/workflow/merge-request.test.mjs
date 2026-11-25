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

/** A preview notice the service delivered, which is the merge's only source. */
function deliveredPreviewRow({
  pullRequestNumber = 200,
  commitSha = commit,
  noticeMessageIdentifier = 90,
} = {}) {
  return {
    pull_request_number: pullRequestNumber,
    commit_sha: commitSha,
    notice_message_identifier: noticeMessageIdentifier,
  };
}

function deliveredPreviews() {
  const rows = new Map();
  return {
    deliver(topicSessionKey, row = deliveredPreviewRow()) {
      rows.set(topicSessionKey, row);
    },
    clear(topicSessionKey) {
      rows.delete(topicSessionKey);
    },
    find(topicSessionKey) {
      return rows.get(topicSessionKey);
    },
  };
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
    changedPaths: ["apps/web/src/content/posts/la-cursa.yaml"],
    changedPathsError: null,
    changedPathsCommits: [],
    // Entries that differ from a regular file, by path.
    treeModes: {},
    treeModesError: null,
    removedPaths: [],
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
    async getChangedPaths({ commit: pinnedCommit }) {
      github.changedPathsCommits.push(pinnedCommit);
      if (github.changedPathsError) throw github.changedPathsError;
      return {
        paths: github.changedPaths,
        presentPaths: github.changedPaths.filter(
          (path) => !github.removedPaths.includes(path),
        ),
      };
    },
    async getTreeModes({ commit: pinnedCommit }) {
      assert.equal(pinnedCommit, github.changedPathsCommits.at(-1));
      if (github.treeModesError) throw github.treeModesError;
      return new Map(
        github.changedPaths
          .filter((path) => !github.removedPaths.includes(path))
          .map((path) => [path, github.treeModes[path] ?? "100644"]),
      );
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
    htmlUrl: `https://github.com/${repository}/pull/200`,
    headSha: commit,
    headRepository: repository,
    draft: false,
    baseRef: "main",
    mergeableState: "clean",
    merged: false,
    mergeCommitSha: null,
    previewLabeled: true,
    previewRevoked: false,
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

function setup(
  context,
  { github = fakeGithub(), now, synchronize = false } = {},
) {
  const { ciWatches, merges } = fixture(context, { now });
  const previews = deliveredPreviews();
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
  // Records every synchronisation the handler asks for; `error` makes it fail.
  const synchronization = {
    calls: [],
    error: null,
    result: { outcome: "answered", report: "Preparant la branca." },
    async callback(requestArgument, target, options) {
      synchronization.calls.push({ requestArgument, target, options });
      if (synchronization.error) throw synchronization.error;
      return synchronization.result;
    },
  };
  function buildHandler(overrides = {}) {
    return createMergeRequests({
      store: merges,
      findDeliveredPreview: (topicSessionKey) => previews.find(topicSessionKey),
      hasNewerWork: (query) => {
        newerWork.calls.push(query);
        return newerWork.value;
      },
      verifyMembership: async (authorIdentifier) => {
        membership.calls.push(authorIdentifier);
        return membership.result;
      },
      synchronizeBehind: synchronize ? synchronization.callback : undefined,
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
    previews,
    deliverPreview: (row) => previews.deliver(sessionKey, row),
    merges,
    github,
    telegram,
    membership,
    newerWork,
    synchronization,
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
    // Newer than the delivered notice (90) by default.
    messageIdentifier: 100,
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

test("merges the delivered preview commit and records it before the call", async (context) => {
  const { deliverPreview, handler, github, merges, traces, membership } =
    setup(context);
  deliverPreview();
  let stateDuringMerge;
  github.beforeMerge = () => {
    stateDuringMerge = merges.state(20);
  };

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.equal(
    result.report,
    [
      "La proposta #200 ja està fusionada i el canvi és al projecte.",
      `Enllaç per a revisió: https://github.com/${repository}/pull/200 (canvi fusionat bbbbbbb)`,
    ].join("\n"),
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

const infrastructureReport = [
  "Aquest canvi toca les eines o la configuració del projecte, i ho ha de revisar la persona que manté el servei. No s'ha publicat res.",
  `Enllaç per a revisió: https://github.com/${repository}/pull/200`,
].join("\n");

test("merges a pull request without infrastructure changes, read at the pinned commit", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: fakeGithub({
      changedPaths: [
        "apps/web/src/components/Header.astro",
        "apps/web/src/styles/global.css",
        "apps/web/src/pages/index.astro",
        "apps/web/src/content/posts/la-cursa.yaml",
        "apps/web/src/content-assets/posts/la-cursa.webp",
        "apps/web/messages/ca.json",
        "apps/web/public/favicon.svg",
        "apps/web/e2e/home.spec.ts",
        "docs/architecture.md",
      ],
    }),
  });
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(github.changedPathsCommits, [commit]);
  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
});

for (const [name, changedPaths] of [
  ["a file at the repository root", ["pnpm-lock.yaml"]],
  ["a workflow", [".github/workflows/artifact.yml"]],
  ["a project skill", [".agents/skills/seo/SKILL.md"]],
  ["a Claude skill link", [".claude/skills/seo"]],
  ["a Git hook", [".husky/pre-push"]],
  ["an OpenCode agent", [".opencode/agent/development.md"]],
  ["a project tool", ["tools/server/agent/workflow/merge-request.mjs"]],
  ["a package", ["packages/telegram-pi-bridge/src/index.mjs"]],
  ["the web manifest", ["apps/web/package.json"]],
  ["the Astro configuration", ["apps/web/astro.config.mjs"]],
  ["a file directly in the web application", ["apps/web/build-mode.mjs"]],
  ["a web build script", ["apps/web/scripts/build.mjs"]],
  ["the translation project", ["apps/web/project.inlang/settings.json"]],
  ["a nested package manifest", ["apps/web/src/content/package.json"]],
  ["a nested TypeScript configuration", ["docs/tsconfig.build.json"]],
  ["a nested configuration file", ["apps/web/src/content.config.ts"]],
  ["a hidden file", ["apps/web/src/content/.prettierrc.cjs"]],
  ["a file in a hidden directory", ["apps/web/public/.well-known/a.txt"]],
  [
    "allowed files and infrastructure",
    ["apps/web/src/pages/index.astro", "tools/a.mjs"],
  ],
  [
    "a file renamed into infrastructure",
    ["tools/a.ts", "apps/web/src/lib/a.ts"],
  ],
  ["no file at all", []],
]) {
  test(`refuses a pull request that changes ${name} without merging`, async (context) => {
    const { deliverPreview, handler, github, merges, traces } = setup(context, {
      github: fakeGithub({ changedPaths }),
    });
    deliverPreview();

    const result = await handler.handle(request(), bareCommand);

    assert.equal(result.report, infrastructureReport);
    assert.deepEqual(github.merges, []);
    assert.equal(merges.state(20), undefined);
    assert.equal(traces.at(-1).action, "merge_refused");
    assert.equal(traces.at(-1).detail, "infrastructure_changes #200 aaaaaaa");
  });
}

for (const [name, mode] of [
  ["a symbolic link", "120000"],
  ["a submodule", "160000"],
  ["an executable file", "100755"],
]) {
  test(`refuses ${name} without merging`, async (context) => {
    const path = "apps/web/src/content/posts/la-cursa.yaml";
    const { deliverPreview, handler, github, traces } = setup(context, {
      github: fakeGithub({ treeModes: { [path]: mode } }),
    });
    deliverPreview();

    await handler.handle(request(), bareCommand);

    assert.deepEqual(github.merges, []);
    assert.equal(traces.at(-1).detail, "infrastructure_changes #200 aaaaaaa");
  });
}

test("merges a pull request that removes a file", async (context) => {
  const path = "apps/web/src/content/posts/la-cursa.yaml";
  const { deliverPreview, handler, github } = setup(context, {
    github: fakeGithub({ removedPaths: [path] }),
  });
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
});

test("refuses as unreadable when the commit tree cannot be read", async (context) => {
  const { deliverPreview, handler, github, traces } = setup(context, {
    github: fakeGithub({ treeModesError: new Error("truncated") }),
  });
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "unreadable #200 aaaaaaa");
});

for (const mergeableState of ["behind", "dirty"]) {
  test(`refuses a ${mergeableState} branch that changes infrastructure without synchronising it`, async (context) => {
    const { deliverPreview, handler, synchronization, traces } = setup(
      context,
      {
        github: fakeGithub({
          pullRequest: openPullRequest({ mergeableState }),
          changedPaths: ["apps/web/package.json"],
        }),
        synchronize: true,
      },
    );
    deliverPreview();

    await handler.handle(request(), bareCommand);

    assert.deepEqual(synchronization.calls, []);
    assert.equal(traces.at(-1).detail, "infrastructure_changes #200 aaaaaaa");
  });
}

test("refuses as unreadable when the changed files cannot be read", async (context) => {
  const { deliverPreview, handler, github, traces } = setup(context, {
    github: fakeGithub({ changedPathsError: new Error("network down") }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /No he pogut llegir com està la proposta/u);
  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "unreadable #200 aaaaaaa");
});

for (const [name, command] of [
  ["the number", { valid: true, pullRequestNumber: 200 }],
  [
    "the number with the pinned commit",
    { valid: true, pullRequestNumber: 200, commit },
  ],
]) {
  test(`accepts ${name}`, async (context) => {
    const { deliverPreview, handler, github } = setup(context);
    deliverPreview();

    const result = await handler.handle(request(), command);

    assert.match(result.report, /fusionada/u);
    assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
  });
}

test("the merge handler checks live CI instead of a delivered CI notice", async (context) => {
  const { ciWatches, deliverPreview, handler, github } = setup(context);
  deliverPreview();
  report(ciWatches, { result: "failure" });

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /fusionada/u);
  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
});

test("refuses a command that is not one of the accepted forms", async (context) => {
  const { handler, github, traces, membership } = setup(context);

  const result = await handler.handle(request(), { valid: false });

  assert.match(result.report, /Per fusionar, escriu/u);
  assert.deepEqual(github.merges, []);
  assert.equal(github.reads, 0);
  assert.deepEqual(membership.calls, []);
  assert.deepEqual(actions(traces), ["merge_refused"]);
  assert.equal(traces[0].detail, "usage");
});

test("refuses when no preview confirmation was delivered", async (context) => {
  const { handler, github, traces } = setup(context);

  const result = await handler.handle(request(), bareCommand);

  assert.match(
    result.report,
    /no hi ha cap avís vigent de preview confirmada/u,
  );
  assert.match(result.report, /No s'ha fusionat res/u);
  assert.equal(github.reads, 0);
  assert.deepEqual(github.merges, []);
  assert.deepEqual(actions(traces), ["merge_refused"]);
  assert.equal(traces[0].detail, "no_delivered_preview");
});

test("a delivered CI notice alone never authorizes the merge", async (context) => {
  const { ciWatches, handler, github, traces } = setup(context);
  report(ciWatches);

  const result = await handler.handle(request(20), bareCommand);

  assert.match(
    result.report,
    /no hi ha cap avís vigent de preview confirmada/u,
  );
  assert.match(result.report, /No s'ha fusionat res/u);
  assert.equal(github.reads, 0);
  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "no_delivered_preview");
});

test("refuses another pull request or another commit than the delivered one", async (context) => {
  const { deliverPreview, handler, github } = setup(context);
  deliverPreview();

  const other = await handler.handle(request(20), {
    valid: true,
    pullRequestNumber: 201,
  });
  assert.match(other.report, /l'última proposta informada és la #200/u);
  assert.match(other.report, /#201/u);

  const moved = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit: "c".repeat(40),
  });
  assert.match(
    moved.report,
    /no és el de l'última proposta informada \(#200\)/u,
  );

  assert.deepEqual(github.merges, []);
});

test("refuses while the topic has newer work than its last notice", async (context) => {
  const { deliverPreview, handler, github, newerWork, traces } = setup(context);
  deliverPreview();
  newerWork.value = true;

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /feina més nova que l'últim avís/u);
  assert.match(result.report, /proposta #200/u);
  assert.match(result.report, /torna a demanar `\/merge`/u);
  assert.deepEqual(newerWork.calls, [{ sessionKey, updateIdentifier: 20 }]);
  assert.deepEqual(github.merges, []);
  assert.equal(traces[0].detail, "newer_work #200 aaaaaaa");
});

test("refuses the delivered preview while a newer publication is unknown", async (context) => {
  const newerCommit = "e".repeat(40);
  const github = fakeGithub();
  github.pullRequests = {
    200: openPullRequest(),
    202: openPullRequest({ headSha: newerCommit }),
  };
  const {
    ciWatches,
    deliverPreview,
    github: fake,
    buildHandler,
  } = setup(context, { github });
  deliverPreview();
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
  assert.match(bare.report, /proposta #200/u);
  const withNumber = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
  });
  assert.match(withNumber.report, /feina més nova que l'últim avís/u);
  assert.deepEqual(fake.merges, []);

  // The newer preview is delivered: it replaces the previous one and the merge
  // resolves from it.
  ciWatches.resolveUncertainNoticeDelivered(11);
  deliverPreview(
    deliveredPreviewRow({ pullRequestNumber: 202, commitSha: newerCommit }),
  );
  const resolved = await handler.handle(request(22), bareCommand);
  assert.match(resolved.report, /proposta #202 ja està fusionada/u);
  assert.deepEqual(fake.merges, [{ number: 202, sha: newerCommit }]);
});

test("refuses the delivered preview while an out-of-order notice is unknown", async (context) => {
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
    deliverPreview,
    github: fake,
    buildHandler,
  } = setup(context, {
    github,
    now: () => new Date(instant),
  });
  // The newest delivered preview is C, the newest publication.
  deliverPreview(
    deliveredPreviewRow({ pullRequestNumber: 203, commitSha: laterCommit }),
  );
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

  const bare = await handler.handle(request(20), bareCommand);
  assert.match(bare.report, /feina més nova que l'últim avís/u);
  assert.match(bare.report, /proposta #203/u);
  const withNumber = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 203,
  });
  assert.match(withNumber.report, /feina més nova que l'últim avís/u);
  assert.deepEqual(fake.merges, []);
});

test("verifies the membership before any pull request is read", async (context) => {
  const { deliverPreview, handler, github, membership } = setup(context, {
    github: fakeGithub({ pullRequest: mergedPullRequest() }),
  });
  deliverPreview();
  membership.result = { verified: false, reason: "not_a_group_member" };

  const result = await handler.handle(request(20), bareCommand);

  assert.match(result.report, /Ja no constes com a membre del grup/u);
  assert.equal(github.reads, 0, "no GitHub read for a revoked member");
  assert.deepEqual(github.merges, []);
});

test("verifies the membership again when the command runs", async (context) => {
  const { deliverPreview, handler, github, membership, traces } =
    setup(context);
  deliverPreview();

  membership.result = { verified: false, reason: "not_a_group_member" };
  const revoked = await handler.handle(request(20), bareCommand);
  assert.match(revoked.report, /Ja no constes com a membre del grup/u);

  membership.result = { verified: false, reason: "membership_check_failed" };
  const unavailable = await handler.handle(request(21), bareCommand);
  assert.match(
    unavailable.report,
    /Ara mateix no he pogut comprovar que siguis membre del grup/u,
  );

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
  const { deliverPreview, github, merges, traces, buildHandler } =
    setup(context);
  deliverPreview();
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
  const { deliverPreview, github, merges, traces, buildHandler } =
    setup(context);
  deliverPreview();
  const handler = buildHandler({ verifyMembership: boundedMembership(10) });

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.match(
    result.report,
    /Ara mateix no he pogut comprovar que siguis membre/u,
  );
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
    /no apunta a la branca principal del projecte/u,
  ],
  [
    "a fork",
    { pullRequest: openPullRequest({ headRepository: "someone/fork" }) },
    "not_main_repository",
    /no és d'aquest projecte/u,
  ],
  [
    "a deleted fork",
    { pullRequest: openPullRequest({ headRepository: null }) },
    "not_main_repository",
    /no és d'aquest projecte/u,
  ],
  [
    "a pull request without the preview label",
    { pullRequest: openPullRequest({ previewLabeled: false }) },
    "no_preview_label",
    /preview/u,
  ],
  [
    "a pull request whose preview was revoked",
    {
      pullRequest: openPullRequest({
        previewLabeled: true,
        previewRevoked: true,
      }),
    },
    "preview_revoked",
    /preview/u,
  ],
  [
    "a moved head",
    { pullRequest: openPullRequest({ headSha: "c".repeat(40) }) },
    "head_moved",
    /ha canviat des que te la vaig informar/u,
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
    /no considera la proposta #200 a punt/u,
  ],
  [
    "a branch behind main",
    { pullRequest: openPullRequest({ mergeableState: "behind" }) },
    "behind",
    /no està al dia amb la resta del projecte/u,
  ],
  [
    "a blocked pull request",
    { pullRequest: openPullRequest({ mergeableState: "blocked" }) },
    "not_clean",
    /no considera la proposta #200 a punt/u,
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
    /No he pogut llegir com està la proposta/u,
  ],
];

for (const [name, state, reason, text] of liveRefusals) {
  test(`refuses ${name} without merging`, async (context) => {
    const { deliverPreview, handler, github, merges, traces } = setup(context, {
      github: fakeGithub(state),
    });
    deliverPreview();

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

test("refuses if the live head changes during the check read", async (context) => {
  const github = fakeGithub();
  const { deliverPreview, handler } = setup(context, { github });
  deliverPreview();
  github.getCommitCheckRuns = async () => {
    github.pullRequest = openPullRequest({ headSha: "c".repeat(40) });
    return github.checkRuns;
  };
  const result = await handler.handle(request(), bareCommand);
  assert.match(result.report, /No he pogut llegir com està la proposta/u);
  assert.deepEqual(github.merges, []);
});

for (const [name, mutate, detail] of [
  [
    "the delivered preview is replaced",
    ({ previews }) =>
      previews.deliver(
        sessionKey,
        deliveredPreviewRow({ noticeMessageIdentifier: 91 }),
      ),
    "no_delivered_preview",
  ],
  [
    "newer work appears",
    ({ newerWork }) => {
      newerWork.value = true;
    },
    "newer_work #200 aaaaaaa",
  ],
]) {
  test(`refuses when ${name} while the live checks are read`, async (context) => {
    const github = fakeGithub();
    const environment = setup(context, { github });
    environment.deliverPreview();
    github.getCommitCheckRuns = async () => {
      mutate(environment);
      return github.checkRuns;
    };

    const result = await environment.handler.handle(request(), bareCommand);

    assert.match(result.report, /No s'ha fusionat res/u);
    assert.deepEqual(github.merges, []);
    assert.equal(environment.traces.at(-1).detail, detail);
  });
}

test("refuses when live checks turn red or their read fails", async (context) => {
  const github = fakeGithub();
  const { deliverPreview, handler } = setup(context, { github });
  deliverPreview();
  github.checkRuns = [
    { name: "Validate", status: "completed", conclusion: "failure" },
  ];
  const red = await handler.handle(request(), bareCommand);
  assert.match(red.report, /no estan totes en verd/u);
  github.getCommitCheckRuns = async () => {
    throw new Error("network");
  };
  const unreadable = await handler.handle(request(21), bareCommand);
  assert.match(unreadable.report, /No he pogut llegir com està la proposta/u);
  assert.deepEqual(github.merges, []);
});

test("reads a pull request again while mergeability is unknown and then refuses as unreadable", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: fakeGithub({
      pullRequest: openPullRequest({ mergeableState: "unknown" }),
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /No he pogut llegir com està la proposta/u);
  assert.equal(github.reads, 3);
  assert.equal(github.checkReads, 0);
  assert.deepEqual(github.merges, []);
});

test("answers already merged when GitHub reports unknown mergeability for a merged pull request", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: fakeGithub({
      pullRequest: { ...mergedPullRequest(), mergeableState: "unknown" },
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /proposta #200 ja està fusionada/u);
  assert.deepEqual(github.merges, []);
});

test("answers not open when GitHub reports unknown mergeability for a closed pull request", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: fakeGithub({
      pullRequest: openPullRequest({
        state: "closed",
        mergeableState: "unknown",
      }),
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.doesNotMatch(result.report, /No he pogut llegir/u);
  assert.match(result.report, /proposta #200 ja no està oberta/u);
  assert.deepEqual(github.merges, []);
});

test("merges once GitHub finishes computing the mergeability", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: fakeGithub({
      pullRequestSequence: [openPullRequest({ mergeableState: "unknown" })],
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /fusionada/u);
  assert.equal(github.reads, 4);
  assert.equal(github.merges.length, 1);
});

test("stops while waiting to read the mergeability again", async (context) => {
  const controller = new AbortController();
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "unknown" }),
  });
  const { deliverPreview, handler } = setup(context, { github });
  deliverPreview();
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
  const { deliverPreview, handler } = setup(context, { github });
  deliverPreview();
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
    const { deliverPreview, handler, merges, traces } = setup(context, {
      github,
    });
    deliverPreview();

    const result = await handler.handle(request(20), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.match(
      result.report,
      /GitHub ha refusat el merge de la proposta #200/u,
    );
    assert.match(result.report, /No s'ha fusionat res/u);
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
    const { deliverPreview, handler, merges, traces } = setup(context, {
      github,
    });
    deliverPreview();

    const result = await handler.handle(request(20), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.match(result.report, /No sé si la proposta #200 s'ha fusionat/u);
    assert.equal(merges.state(20), "uncertain");
    assert.equal(traces.at(-1).action, "merge_uncertain");
    assert.equal(traces.at(-1).authorIdentifier, 555);
    assert.equal(traces.at(-1).sessionKey, sessionKey);

    // The pull request is still open: a person decides, nothing is repeated.
    github.mergeError = null;
    const again = await handler.handle(request(21), bareCommand);
    assert.match(again.report, /i GitHub la mostra oberta/u);
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
  const { deliverPreview, handler, merges } = setup(context, { github });
  deliverPreview();

  await handler.handle(request(20), bareCommand, { signal: controller.signal });

  assert.equal(merges.state(20), "uncertain");
});

test("an uncertain merge that GitHub shows as merged is closed and reported", async (context) => {
  const github = fakeGithub({ mergeError: new TypeError("fetch failed") });
  const { deliverPreview, handler, merges, traces } = setup(context, {
    github,
  });
  deliverPreview();
  await handler.handle(request(20), bareCommand);

  github.mergeError = null;
  github.pullRequest = mergedPullRequest();
  const result = await handler.handle(request(21), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /GitHub mostra la proposta #200 fusionada/u);
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
  const { deliverPreview, handler, merges } = setup(context, { github });
  deliverPreview();
  await handler.handle(request(20), bareCommand);

  github.readError = new Error("network down");
  const result = await handler.handle(request(21), bareCommand);

  assert.match(result.report, /No he pogut llegir com està la proposta/u);
  assert.equal(merges.state(20), "uncertain");
  assert.equal(github.merges.length, 1);
});

test("never merges the same update twice", async (context) => {
  const { deliverPreview, handler, github, merges, traces } = setup(context);
  deliverPreview();
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

  assert.match(result.report, /Aquesta petició de merge ja s'havia atès/u);
  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "already_handled #200 aaaaaaa");
});

test("refuses a second merge of a pull request that is already merging", async (context) => {
  const { deliverPreview, handler, github, merges } = setup(context);
  deliverPreview();
  merges.begin({
    updateIdentifier: 19,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });

  const result = await handler.handle(request(20), bareCommand);

  assert.match(result.report, /Ja hi ha un merge de la proposta #200 en curs/u);
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
  assert.match(sent[0].text, /GitHub mostra la proposta #200 fusionada/u);
  assert.ok(sent[0].signal instanceof AbortSignal);
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

test("keeps the startup notice of a merge as a service event of its session", async (context) => {
  const github = fakeGithub({ pullRequest: mergedPullRequest() });
  const notes = [];
  const { merges, sent, buildHandler } = setup(context, { github });
  const handler = buildHandler({
    recordServiceNote: (note) => notes.push(note),
  });
  interruptedMerge(merges);

  await handler.reconcileUncertain();

  assert.equal(sent.length, 1);
  assert.deepEqual(notes, [
    { sessionKey, text: sent[0].text, effectKey: "merge:20:reconciled" },
  ]);
});

test("startup tells the topic once about an unknown result of an open pull request", async (context) => {
  const { handler, merges, sent, traces } = setup(context);
  interruptedMerge(merges);

  await handler.reconcileUncertain();
  await handler.reconcileUncertain();

  assert.equal(merges.state(20), "uncertain");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].messageThreadIdentifier, 7);
  assert.match(sent[0].text, /i GitHub la mostra oberta/u);
  assert.ok(
    sent[0].text.includes(`\`/merge 200 ${commit}\``),
    "the topic carries the exact command to confirm the unknown result",
  );
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
  await handler.reconcileUncertain();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /tancada sense fusionar/u);
  assert.match(sent[0].text, /no es pot fusionar/u);
  // The merge can never happen, so the row ends instead of blocking every start.
  assert.equal(merges.state(20), "not_merged");
  assert.deepEqual(merges.uncertain(), []);
});

test("startup does not repeat the notice of a result the topic was already told", async (context) => {
  const github = fakeGithub({ mergeError: new TypeError("fetch failed") });
  const { deliverPreview, handler, sent } = setup(context, { github });
  deliverPreview();
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
  environment.deliverPreview();
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
    assert.match(result.report, /i GitHub la mostra oberta/u);
    assert.ok(result.report.includes(`\`/merge 200 ${commit}\``));
  }

  assert.equal(github.merges.length, 1);
  assert.equal(merges.state(20), "uncertain");
  assert.equal(traces.at(-1).detail, "uncertain_pending #200 aaaaaaa");
});

test("asks for the strict form of the row's commit while another commit is written", async (context) => {
  const { handler, github, merges } = await uncertainOpenMerge(context);

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit: "c".repeat(40),
  });

  assert.match(result.report, /i GitHub la mostra oberta/u);
  assert.ok(result.report.includes(`\`/merge 200 ${commit}\``));
  assert.equal(github.merges.length, 1);
  assert.equal(merges.state(20), "uncertain");
});

test("a person's strict form clears an unknown result and never merges in that request", async (context) => {
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

  assert.match(result.report, /GitHub no mostra la proposta #200 fusionada/u);
  assert.match(result.report, /No s'ha fusionat res en aquesta petició/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(21), undefined);
  assert.equal(github.merges.length, 1);
  assert.equal(membership.calls.length, membershipCalls + 1);
  assert.equal(newerWork.calls.length, newerWorkCalls);
  assert.equal(github.checkReads, checkReads);
  const cleared = traces.find(
    (entry) => entry.action === "merge_uncertain_cleared",
  );
  assert.equal(cleared.authorIdentifier, 555);
  assert.equal(cleared.updateIdentifier, 21);
  assert.equal(cleared.sessionKey, sessionKey);
  assert.equal(cleared.detail, "#200 aaaaaaa");

  // The next request starts from scratch and merges the delivered preview.
  const merged = await handler.handle(request(22), bareCommand);
  assert.match(merged.report, /proposta #200 ja està fusionada/u);
  assert.equal(merges.state(22), "merged");
  assert.equal(github.merges.length, 2);
  assert.deepEqual(github.merges[1], { number: 200, sha: commit });
});

test("keeps the unknown result open when its row cannot be closed", async (context) => {
  const { handler, github, merges, traces } = await uncertainOpenMerge(context);
  merges.markNotMerged = () => {
    throw new Error("disk full");
  };

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });

  // The row is still uncertain, so the request never goes on to merge.
  assert.match(result.report, /i GitHub la mostra oberta/u);
  assert.ok(result.report.includes(`\`/merge 200 ${commit}\``));
  assert.equal(merges.state(20), "uncertain");
  assert.equal(github.merges.length, 1);
  assert.ok(
    !traces.some((entry) => entry.action === "merge_uncertain_cleared"),
    "a row that could not be closed is never reported as cleared",
  );
});

test("an explicit strict form reconciles an unknown result without an eligible preview and merges nothing", async (context) => {
  const { previews, handler, github, merges, traces } =
    await uncertainOpenMerge(context);
  previews.clear(sessionKey);

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });

  assert.match(result.report, /No s'ha fusionat res en aquesta petició/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(21), undefined);
  assert.equal(
    github.merges.length,
    1,
    "the reconciled request never PUTs again",
  );
  const cleared = traces.find(
    (entry) => entry.action === "merge_uncertain_cleared",
  );
  assert.equal(cleared.updateIdentifier, 21);
  assert.equal(cleared.detail, "#200 aaaaaaa");
});

test("an explicit strict form never reconciles an unknown result of another topic", async (context) => {
  const otherSessionKey = "-1001234567890:8";
  const { handler, github, merges, traces } = setup(context);
  merges.begin({
    updateIdentifier: 20,
    sessionKey: otherSessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  merges.recoverMerging();

  const result = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });

  assert.match(
    result.report,
    /no hi ha cap avís vigent de preview confirmada/u,
  );
  assert.match(result.report, /No s'ha fusionat res/u);
  assert.equal(merges.state(20), "uncertain");
  assert.deepEqual(github.merges, []);
  assert.ok(
    !traces.some((entry) => entry.action === "merge_uncertain_cleared"),
    "another topic's unknown result is never reported as cleared",
  );
});

test("a moved head is confirmed with its own commit, which the full request still binds", async (context) => {
  const movedCommit = "b".repeat(40);
  const { deliverPreview, handler, github, merges, traces } =
    await uncertainOpenMerge(context);
  github.pullRequest = openPullRequest({ headSha: movedCommit });
  deliverPreview(deliveredPreviewRow({ commitSha: movedCommit }));

  const asked = await handler.handle(request(21), bareCommand);
  assert.match(asked.report, /i GitHub la mostra oberta/u);
  assert.ok(
    asked.report.includes(`\`/merge 200 ${movedCommit}\``),
    "the command asks for the commit of the current head",
  );
  assert.ok(!asked.report.includes(commit));

  const stale = await handler.handle(request(22), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });
  assert.match(stale.report, /i GitHub la mostra oberta/u);
  assert.ok(stale.report.includes(`\`/merge 200 ${movedCommit}\``));
  assert.equal(github.merges.length, 1);
  assert.equal(merges.state(20), "uncertain");

  const cleared = await handler.handle(request(23), {
    valid: true,
    pullRequestNumber: 200,
    commit: movedCommit,
  });
  assert.match(cleared.report, /GitHub no mostra la proposta #200 fusionada/u);
  assert.match(cleared.report, /No s'ha fusionat res en aquesta petició/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(23), undefined);
  assert.equal(github.merges.length, 1);
  const clearedTrace = traces.find(
    (entry) => entry.action === "merge_uncertain_cleared",
  );
  assert.equal(clearedTrace.detail, `#200 ${movedCommit.slice(0, 7)}`);

  const merged = await handler.handle(request(24), bareCommand);
  assert.match(merged.report, /proposta #200 ja està fusionada/u);
  assert.equal(merges.state(24), "merged");
  assert.equal(github.merges.length, 2);
  assert.deepEqual(github.merges[1], { number: 200, sha: movedCommit });
});

test("a strict form of the new head clears the unknown result before its preview arrives", async (context) => {
  const movedCommit = "b".repeat(40);
  const { deliverPreview, handler, github, merges, traces } =
    await uncertainOpenMerge(context);
  // The head moved and its preview has not been delivered: the delivered notice
  // still names the previous commit.
  github.pullRequest = openPullRequest({ headSha: movedCommit });

  const cleared = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit: movedCommit,
  });

  assert.match(cleared.report, /GitHub no mostra la proposta #200 fusionada/u);
  assert.match(cleared.report, /No s'ha fusionat res en aquesta petició/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(github.merges.length, 1, "nothing new was merged");
  const clearedTrace = traces.find(
    (entry) => entry.action === "merge_uncertain_cleared",
  );
  assert.equal(clearedTrace.detail, `#200 ${movedCommit.slice(0, 7)}`);

  // The delivered preview of the new head arrives: a new request merges it.
  deliverPreview(deliveredPreviewRow({ commitSha: movedCommit }));
  const merged = await handler.handle(request(22), bareCommand);

  assert.match(merged.report, /proposta #200 ja està fusionada/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(22), "merged");
  assert.deepEqual(github.merges.at(-1), { number: 200, sha: movedCommit });
});

test("refuses a live pull request that GitHub shows merged", async (context) => {
  const { deliverPreview, handler, github, traces } = setup(context);
  deliverPreview();
  github.pullRequest = mergedPullRequest();

  const result = await handler.handle(request(20), bareCommand);

  assert.match(result.report, /proposta #200 ja està fusionada/u);
  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "already_merged #200 aaaaaaa");
});

test("a later request after a cleared unknown result still refuses failing live checks", async (context) => {
  const { handler, github, merges } = await uncertainOpenMerge(context);
  github.checkRuns = [];

  const cleared = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit,
  });
  assert.match(cleared.report, /No s'ha fusionat res en aquesta petició/u);
  assert.equal(merges.state(20), "not_merged");
  assert.equal(github.merges.length, 1);

  const retry = await handler.handle(request(22), bareCommand);
  assert.match(retry.report, /no estan totes en verd/u);
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
  // A pull request closed without merging can never be merged: the row ends
  // instead of blocking the topic on every start.
  assert.equal(merges.state(20), "not_merged");
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

  assert.match(result.report, /GitHub mostra la proposta #200 fusionada/u);
  assert.equal(merges.state(20), "merged");
  assert.equal(github.merges.length, 1);
});

test("answers that the pull request is already merged from its delivered preview", async (context) => {
  const { deliverPreview, handler, github, traces } = setup(context, {
    github: fakeGithub({ pullRequest: mergedPullRequest() }),
  });
  deliverPreview();

  for (const [updateIdentifier, command] of [
    [20, bareCommand],
    [21, { valid: true, pullRequestNumber: 200 }],
  ]) {
    const result = await handler.handle(request(updateIdentifier), command);
    assert.equal(
      result.report,
      [
        "La proposta #200 ja està fusionada. No he fet res més.",
        `Enllaç per a revisió: https://github.com/${repository}/pull/200 (canvi fusionat bbbbbbb)`,
      ].join("\n"),
    );
  }

  assert.deepEqual(github.merges, []);
  assert.equal(traces.at(-1).detail, "already_merged #200 aaaaaaa");
});

test("reports a merge that happened even when its end cannot be saved", async (context) => {
  const { deliverPreview, handler, merges, traces } = setup(context);
  deliverPreview();
  merges.markMerged = () => {
    throw new Error("disk full");
  };

  const result = await handler.handle(request(20), bareCommand);

  assert.match(
    result.report,
    /La proposta #200 ja està fusionada i el canvi és al projecte\./u,
  );
  assert.match(result.report, /No he pogut desar aquest resultat/u);
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
    const { deliverPreview, handler, merges } = setup(context, { github });
    deliverPreview();
    merges[method] = () => {
      throw new Error("disk full");
    };

    const result = await handler.handle(request(20), bareCommand);

    assert.match(result.report, /No sé si la proposta #200 s'ha fusionat/u);
    assert.doesNotMatch(result.report, /No s'ha fet cap push/u);
    assert.equal(merges.state(20), "merging");
  });
}

test("a failing trace never stops a merge", async (context) => {
  const failures = [];
  const { buildHandler, deliverPreview, github } = setup(context);
  deliverPreview();
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

test("a behind branch triggers the synchronisation with the trusted pin and never merges", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({
      mergeableState: "behind",
      headRef: "work",
      baseSha: "c".repeat(40),
    }),
  });
  const { deliverPreview, handler, synchronization, merges, traces } = setup(
    context,
    { github, synchronize: true },
  );
  deliverPreview();
  const abort = new AbortController();

  const result = await handler.handle(request(), bareCommand, {
    signal: abort.signal,
  });

  assert.deepEqual(result, synchronization.result);
  assert.equal(synchronization.calls.length, 1);
  const [call] = synchronization.calls;
  assert.deepEqual(call.target, {
    pullRequestNumber: 200,
    commit,
    branch: "work",
  });
  assert.equal(call.requestArgument.updateIdentifier, 20);
  assert.equal(call.options.signal, abort.signal);
  assert.deepEqual(github.merges, []);
  assert.equal(merges.state(20), undefined);
  assert.deepEqual(actions(traces), [
    "merge_membership_verified",
    "merge_sync_requested",
  ]);
});

test("an up to date branch never synchronises", async (context) => {
  const { deliverPreview, handler, synchronization, github } = setup(context, {
    synchronize: true,
  });
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(synchronization.calls, []);
  assert.equal(github.merges.length, 1);
});

test("a conflict with main reaches synchronization instead of attempting the merge", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "dirty" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.deepEqual(result, synchronization.result);
  assert.equal(synchronization.calls.length, 1);
  assert.deepEqual(github.merges, []);
});

test("a still-open merge prevents synchronizing a behind pull request", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, merges, synchronization } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();
  merges.begin({
    updateIdentifier: 19,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /merge de la proposta #200 en curs/u);
  assert.deepEqual(synchronization.calls, []);
  assert.deepEqual(github.merges, []);
  assert.equal(merges.state(19), "merging");
});

test("fresh requests repeat synchronization until the delivered commit is current", async (context) => {
  const { deliverPreview, handler, github, previews, synchronization } = setup(
    context,
    { synchronize: true },
  );
  const secondHead = "b".repeat(40);
  const thirdHead = "c".repeat(40);
  deliverPreview();
  github.pullRequest = openPullRequest({ mergeableState: "behind" });

  await handler.handle(request(20), bareCommand);
  assert.deepEqual(
    synchronization.calls.map(({ target }) => target.commit),
    [commit],
  );

  previews.clear(sessionKey);
  github.pullRequest = openPullRequest({
    headSha: secondHead,
    mergeableState: "behind",
  });
  await handler.handle(request(21), bareCommand);
  deliverPreview(
    deliveredPreviewRow({
      commitSha: secondHead,
      noticeMessageIdentifier: 120,
    }),
  );
  await handler.handle(request(22), bareCommand);
  assert.equal(
    synchronization.calls.length,
    1,
    "no notice or an old request cannot synchronize",
  );
  await handler.handle({ ...request(23), messageIdentifier: 121 }, bareCommand);
  assert.deepEqual(
    synchronization.calls.map(({ target }) => target.commit),
    [commit, secondHead],
  );
  assert.deepEqual(github.merges, []);

  github.pullRequest = openPullRequest({ headSha: thirdHead });
  deliverPreview(
    deliveredPreviewRow({ commitSha: thirdHead, noticeMessageIdentifier: 130 }),
  );
  await handler.handle({ ...request(24), messageIdentifier: 131 }, bareCommand);
  assert.deepEqual(github.merges, [{ number: 200, sha: thirdHead }]);
});

test("a behind branch with a pull request or commit mismatch never synchronises", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();

  await handler.handle(request(), { valid: true, pullRequestNumber: 201 });
  await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit: "d".repeat(40),
  });

  assert.deepEqual(synchronization.calls, []);
});

for (const [name, prepare] of [
  ["a moved head", { headSha: "e".repeat(40) }],
  ["a revoked preview", { previewRevoked: true }],
  ["a missing preview label", { previewLabeled: false }],
  ["a draft", { draft: true }],
]) {
  test(`a behind branch with ${name} never synchronises`, async (context) => {
    const github = fakeGithub({
      pullRequest: openPullRequest({ mergeableState: "behind", ...prepare }),
    });
    const { deliverPreview, handler, synchronization } = setup(context, {
      github,
      synchronize: true,
    });
    deliverPreview();

    await handler.handle(request(), bareCommand);

    assert.deepEqual(synchronization.calls, [], name);
  });
}

test("a behind branch with checks not green never synchronises", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
    checkRuns: [{ name: "Validate", status: "in_progress", conclusion: null }],
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(synchronization.calls, []);
});

test("a behind branch for a person who left or with newer work never synchronises", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, membership, newerWork } =
    setup(context, { github, synchronize: true });
  deliverPreview();
  membership.result = { verified: false, reason: "not_member" };
  await handler.handle(request(), bareCommand);
  membership.result = { verified: true, status: "member" };
  newerWork.value = true;
  await handler.handle(request(21), bareCommand);

  assert.deepEqual(synchronization.calls, []);
});

test("a preview replaced during the live read prevents the synchronisation", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, previews } = setup(
    context,
    { github, synchronize: true },
  );
  deliverPreview();
  const getPullRequest = github.getPullRequest;
  github.getPullRequest = async (...args) => {
    previews.deliver(
      sessionKey,
      deliveredPreviewRow({ noticeMessageIdentifier: 91 }),
    );
    return getPullRequest(...args);
  };

  const result = await handler.handle(request(), bareCommand);

  assert.deepEqual(synchronization.calls, []);
  assert.match(result.report, /preview|avís|No s'ha fusionat|encara/u);
});

test("a failing synchronisation refuses as behind and still never merges", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, traces } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();
  synchronization.error = new Error("sync failed");

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /no està al dia/u);
  assert.deepEqual(github.merges, []);
  assert.ok(actions(traces).includes("merge_refused"));
});

test("an aborted synchronisation propagates the abort", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();
  const abort = new AbortController();
  synchronization.error = new Error("stopped");
  abort.abort(synchronization.error);

  await assert.rejects(
    handler.handle(request(), bareCommand, { signal: abort.signal }),
  );
});

test("without the callback a behind branch keeps the existing refusal", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const {
    deliverPreview,
    buildHandler,
    github: used,
  } = setup(context, { github, synchronize: true });
  deliverPreview();
  const handler = buildHandler({ synchronizeBehind: undefined });

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /no està al dia/u);
  assert.deepEqual(used.merges, []);
});

test("an uncertain result keeps its query-only path and never synchronises", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, merges } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();
  merges.begin({
    updateIdentifier: 5,
    sessionKey,
    authorIdentifier: 555,
    pullRequestNumber: 200,
    commitSha: commit,
  });
  merges.markUncertain(5);

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.deepEqual(synchronization.calls, []);
  assert.deepEqual(github.merges, []);
});

for (const [name, messageIdentifier] of [
  ["older than the notice", 89],
  ["the notice itself", 90],
  ["missing", undefined],
  ["not an integer", "100"],
]) {
  test(`a queued merge whose message is ${name} fails closed`, async (context) => {
    const { deliverPreview, handler, github, merges, traces } = setup(context, {
      synchronize: true,
    });
    deliverPreview();

    const result = await handler.handle(
      { ...request(), messageIdentifier },
      bareCommand,
    );

    assert.equal(result.outcome, "answered");
    assert.match(result.report, /preview|avís/u);
    assert.deepEqual(github.merges, []);
    assert.equal(merges.state(20), undefined);
    assert.ok(actions(traces).includes("merge_refused"));
    assert.match(traces.at(-1).detail, /^predates_preview/u);
  });
}

test("an old merge never synchronises a behind branch", async (context) => {
  const github = fakeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
    synchronize: true,
  });
  deliverPreview();

  await handler.handle({ ...request(), messageIdentifier: 50 }, bareCommand);

  assert.deepEqual(synchronization.calls, []);
});

test("a notice delivered while the live read runs refuses the older queued merge", async (context) => {
  const { deliverPreview, handler, github, previews } = setup(context);
  deliverPreview();
  const getPullRequest = github.getPullRequest;
  github.getPullRequest = async (...args) => {
    // The same pull request and commit, announced again after the request.
    previews.deliver(
      sessionKey,
      deliveredPreviewRow({ noticeMessageIdentifier: 150 }),
    );
    return getPullRequest(...args);
  };

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /preview|avís/u);
  assert.deepEqual(github.merges, []);
});

test("strict protection rejects the pinned merge when main advances after preflight", async (context) => {
  const { deliverPreview, handler, github, merges, synchronization } = setup(
    context,
    { synchronize: true },
  );
  deliverPreview();
  const reviewedBase = "c".repeat(40);
  let main = reviewedBase;
  github.beforeMerge = () => {
    main = "d".repeat(40);
    if (main !== reviewedBase) {
      github.mergeError = new GitHubResponseError("PUT", "/merge", 405);
    }
  };

  const result = await handler.handle(request(), bareCommand);

  assert.match(result.report, /GitHub ha refusat el merge/u);
  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
  assert.deepEqual(synchronization.calls, []);
  assert.equal(merges.state(20), "failed");
});
