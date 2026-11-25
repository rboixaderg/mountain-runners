import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyMembership } from "telegram-pi-bridge/telegram";
import { mergeReports } from "../policy/development.mjs";
import { PublicationStore } from "../repository/publication-store.mjs";
import { GitHubResponseError } from "../repository/github.mjs";
import { InspectableMergeRequestStore } from "../repository/test-support/merge-request-state.mjs";
import { requestSignal } from "../repository/request-signal.mjs";
import { createMergeRequests, parseMergeCommand } from "./merge-request.mjs";
import {
  deliveredPreviews,
  mergedPullRequest,
  mergeGithub,
  openPullRequest,
} from "./test-support/github.mjs";
import { recordingTelegram } from "./test-support/telegram.mjs";

const repository = "rboixaderg/mountain-runners";
const groupIdentifier = "-1001234567890";
const commit = "a".repeat(40);
const mergeCommit = "b".repeat(40);
const sessionKey = "-1001234567890:7";
const mergedTarget = {
  pullRequestNumber: 200,
  mergeCommit,
  pullRequestUrl: `https://github.com/${repository}/pull/200`,
};

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
  const publications = new PublicationStore(
    join(directory, "ci-watch.sqlite"),
    {
      now,
    },
  );
  const merges = new InspectableMergeRequestStore(
    join(directory, "merge.sqlite"),
  );
  context.after(() => {
    publications.close();
    merges.close();
  });
  return { directory, publications, merges };
}

function report(
  publications,
  { updateIdentifier = 10, result = "success", commitSha = commit } = {},
) {
  publications.record({
    authorIdentifier: 555,
    updateIdentifier,
    sessionKey,
    pullRequestNumber: 200,
    commitSha,
  });
  publications.finishCiNotice(updateIdentifier, result);
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

function setup(context, { github = mergeGithub(), now } = {}) {
  const { publications, merges } = fixture(context, { now });
  const previews = deliveredPreviews();
  const traces = [];
  const membership = {
    result: { verified: true, status: "member" },
    calls: [],
  };
  const newerWork = { value: false, calls: [] };
  const telegram = recordingTelegram();
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
      synchronizeBehind: synchronization.callback,
      github,
      repository,
      requiredChecks: ["Validate"],
      telegram,
      retryDelayMilliseconds: 0,
      recordTrace: (entry) => traces.push(entry),
      recordServiceNote() {},
      ...overrides,
    });
  }
  return {
    publications,
    previews,
    deliverPreview: (row = deliveredPreviewRow()) =>
      previews.deliver(sessionKey, row),
    merges,
    github,
    telegram,
    membership,
    newerWork,
    synchronization,
    handler: buildHandler(),
    buildHandler,
    sent: telegram.sent,
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
  assert.equal(result.report, mergeReports.merged(mergedTarget));
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

const infrastructureReport = mergeReports.infrastructureChanges({
  reviewUrl: `https://github.com/${repository}/pull/200`,
});

test("merges a pull request without infrastructure changes, read at the pinned commit", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: mergeGithub({
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
      github: mergeGithub({ changedPaths }),
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
      github: mergeGithub({ treeModes: { [path]: mode } }),
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
    github: mergeGithub({ removedPaths: [path] }),
  });
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
});

test("refuses as unreadable when the commit tree cannot be read", async (context) => {
  const { deliverPreview, handler, github, traces } = setup(context, {
    github: mergeGithub({ treeModesError: new Error("truncated") }),
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
        github: mergeGithub({
          pullRequest: openPullRequest({ mergeableState }),
          changedPaths: ["apps/web/package.json"],
        }),
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
    github: mergeGithub({ changedPathsError: new Error("network down") }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.equal(
    result.report,
    mergeReports.unreadable({ pullRequestNumber: 200 }),
  );
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

    assert.equal(result.report, mergeReports.merged(mergedTarget));
    assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
  });
}

test("the merge handler checks live CI instead of a delivered CI notice", async (context) => {
  const { publications, deliverPreview, handler, github } = setup(context);
  deliverPreview();
  report(publications, { result: "failure" });

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.report, mergeReports.merged(mergedTarget));
  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
});

test("refuses a command that is not one of the accepted forms", async (context) => {
  const { handler, github, traces, membership } = setup(context);

  const result = await handler.handle(request(), { valid: false });

  assert.equal(result.report, mergeReports.usage);
  assert.deepEqual(github.merges, []);
  assert.equal(github.reads, 0);
  assert.deepEqual(membership.calls, []);
  assert.deepEqual(actions(traces), ["merge_refused"]);
  assert.equal(traces[0].detail, "usage");
});

test("refuses when no preview confirmation was delivered", async (context) => {
  const { handler, github, traces } = setup(context);

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.report, mergeReports.noDeliveredPreview);
  assert.equal(github.reads, 0);
  assert.deepEqual(github.merges, []);
  assert.deepEqual(actions(traces), ["merge_refused"]);
  assert.equal(traces[0].detail, "no_delivered_preview");
});

test("a delivered CI notice alone never authorizes the merge", async (context) => {
  const { publications, handler, github, traces } = setup(context);
  report(publications);

  const result = await handler.handle(request(20), bareCommand);

  assert.equal(result.report, mergeReports.noDeliveredPreview);
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
  assert.equal(
    other.report,
    mergeReports.otherPullRequest({
      requestedNumber: 201,
      pullRequestNumber: 200,
    }),
  );

  const moved = await handler.handle(request(21), {
    valid: true,
    pullRequestNumber: 200,
    commit: "c".repeat(40),
  });
  assert.equal(
    moved.report,
    mergeReports.commitMismatch({ pullRequestNumber: 200 }),
  );

  assert.deepEqual(github.merges, []);
});

test("refuses while the topic has newer work than its last notice", async (context) => {
  const { deliverPreview, handler, github, newerWork, traces } = setup(context);
  deliverPreview();
  newerWork.value = true;

  const result = await handler.handle(request(), bareCommand);

  assert.equal(
    result.report,
    mergeReports.newerWork({ pullRequestNumber: 200 }),
  );
  assert.deepEqual(newerWork.calls, [{ sessionKey, updateIdentifier: 20 }]);
  assert.deepEqual(github.merges, []);
  assert.equal(traces[0].detail, "newer_work #200 aaaaaaa");
});

test("verifies the membership before any pull request is read", async (context) => {
  const { deliverPreview, handler, github, membership } = setup(context, {
    github: mergeGithub({ pullRequest: mergedPullRequest() }),
  });
  deliverPreview();
  membership.result = { verified: false, reason: "not_a_group_member" };

  const result = await handler.handle(request(20), bareCommand);

  assert.equal(result.report, mergeReports.membershipRevoked);
  assert.equal(github.reads, 0, "no GitHub read for a revoked member");
  assert.deepEqual(github.merges, []);
});

test("verifies the membership again when the command runs", async (context) => {
  const { deliverPreview, handler, github, membership, traces } =
    setup(context);
  deliverPreview();

  membership.result = { verified: false, reason: "not_a_group_member" };
  const revoked = await handler.handle(request(20), bareCommand);
  assert.equal(revoked.report, mergeReports.membershipRevoked);

  membership.result = { verified: false, reason: "membership_check_failed" };
  const unavailable = await handler.handle(request(21), bareCommand);
  assert.equal(unavailable.report, mergeReports.membershipUnavailable);

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
  assert.equal(result.report, mergeReports.membershipUnavailable);
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
    mergeReports.notOpen,
  ],
  [
    "a draft",
    { pullRequest: openPullRequest({ draft: true }) },
    "draft",
    mergeReports.draft,
  ],
  [
    "another base branch",
    { pullRequest: openPullRequest({ baseRef: "release" }) },
    "not_main_base",
    mergeReports.notMainBase,
  ],
  [
    "a fork",
    { pullRequest: openPullRequest({ headRepository: "someone/fork" }) },
    "not_main_repository",
    mergeReports.notMainRepository,
  ],
  [
    "a deleted fork",
    { pullRequest: openPullRequest({ headRepository: null }) },
    "not_main_repository",
    mergeReports.notMainRepository,
  ],
  [
    "a pull request without the preview label",
    { pullRequest: openPullRequest({ previewLabeled: false }) },
    "no_preview_label",
    mergeReports.noPreviewLabel,
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
    mergeReports.previewRevoked,
  ],
  [
    "a moved head",
    { pullRequest: openPullRequest({ headSha: "c".repeat(40) }) },
    "head_moved",
    mergeReports.headMoved,
  ],
  [
    "a red required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "failure" },
      ],
    },
    "checks_not_green",
    mergeReports.checksNotGreen,
  ],
  [
    "a pending required check",
    {
      checkRuns: [
        { name: "Validate", status: "in_progress", conclusion: null },
      ],
    },
    "checks_not_green",
    mergeReports.checksNotGreen,
  ],
  [
    "an absent required check",
    { checkRuns: [] },
    "checks_not_green",
    mergeReports.checksNotGreen,
  ],
  [
    "a skipped required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "skipped" },
      ],
    },
    "checks_not_green",
    mergeReports.checksNotGreen,
  ],
  [
    "a neutral required check",
    {
      checkRuns: [
        { name: "Validate", status: "completed", conclusion: "neutral" },
      ],
    },
    "checks_not_green",
    mergeReports.checksNotGreen,
  ],
  [
    "a pull request without a mergeable state",
    { pullRequest: openPullRequest({ mergeableState: undefined }) },
    "not_clean",
    mergeReports.notClean,
  ],
  [
    "a blocked pull request",
    { pullRequest: openPullRequest({ mergeableState: "blocked" }) },
    "not_clean",
    mergeReports.notClean,
  ],
  [
    "unstable checks",
    { pullRequest: openPullRequest({ mergeableState: "unstable" }) },
    "not_clean",
    mergeReports.notClean,
  ],
  [
    "pending hooks",
    { pullRequest: openPullRequest({ mergeableState: "has_hooks" }) },
    "not_clean",
    mergeReports.notClean,
  ],
  [
    "an unreadable pull request",
    { readError: new Error("network down") },
    "unreadable",
    mergeReports.unreadable,
  ],
];

for (const [name, state, reason, text] of liveRefusals) {
  test(`refuses ${name} without merging`, async (context) => {
    const { deliverPreview, handler, github, merges, traces } = setup(context, {
      github: mergeGithub(state),
    });
    deliverPreview();

    const result = await handler.handle(request(), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.equal(result.report, text({ pullRequestNumber: 200 }));
    assert.deepEqual(github.merges, []);
    assert.equal(merges.state(20), undefined);
    assert.equal(traces.at(-1).action, "merge_refused");
    assert.equal(traces.at(-1).detail, `${reason} #200 aaaaaaa`);
  });
}

test("refuses if the live head changes during the check read", async (context) => {
  const github = mergeGithub();
  const { deliverPreview, handler } = setup(context, { github });
  deliverPreview();
  github.getCommitCheckRuns = async () => {
    github.pullRequest = openPullRequest({ headSha: "c".repeat(40) });
    return github.checkRuns;
  };
  const result = await handler.handle(request(), bareCommand);
  assert.equal(
    result.report,
    mergeReports.unreadable({ pullRequestNumber: 200 }),
  );
  assert.deepEqual(github.merges, []);
});

for (const [name, mutate, detail, report] of [
  [
    "the delivered preview is replaced",
    ({ previews }) =>
      previews.deliver(
        sessionKey,
        deliveredPreviewRow({ noticeMessageIdentifier: 91 }),
      ),
    "no_delivered_preview",
    mergeReports.noDeliveredPreview,
  ],
  [
    "newer work appears",
    ({ newerWork }) => {
      newerWork.value = true;
    },
    "newer_work #200 aaaaaaa",
    mergeReports.newerWork({ pullRequestNumber: 200 }),
  ],
]) {
  test(`refuses when ${name} while the live checks are read`, async (context) => {
    const github = mergeGithub();
    const environment = setup(context, { github });
    environment.deliverPreview();
    github.getCommitCheckRuns = async () => {
      mutate(environment);
      return github.checkRuns;
    };

    const result = await environment.handler.handle(request(), bareCommand);

    assert.equal(result.report, report);
    assert.deepEqual(github.merges, []);
    assert.equal(environment.traces.at(-1).detail, detail);
  });
}

test("refuses when live checks turn red or their read fails", async (context) => {
  const github = mergeGithub();
  const { deliverPreview, handler } = setup(context, { github });
  deliverPreview();
  github.checkRuns = [
    { name: "Validate", status: "completed", conclusion: "failure" },
  ];
  const red = await handler.handle(request(), bareCommand);
  assert.equal(
    red.report,
    mergeReports.checksNotGreen({ pullRequestNumber: 200 }),
  );
  github.getCommitCheckRuns = async () => {
    throw new Error("network");
  };
  const unreadable = await handler.handle(request(21), bareCommand);
  assert.equal(
    unreadable.report,
    mergeReports.unreadable({ pullRequestNumber: 200 }),
  );
  assert.deepEqual(github.merges, []);
});

test("reads a pull request again while mergeability is unknown and then refuses as unreadable", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: mergeGithub({
      pullRequest: openPullRequest({ mergeableState: "unknown" }),
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.equal(
    result.report,
    mergeReports.unreadable({ pullRequestNumber: 200 }),
  );
  assert.equal(github.reads, 3);
  assert.equal(github.checkReads, 0);
  assert.deepEqual(github.merges, []);
});

test("answers already merged when GitHub reports unknown mergeability for a merged pull request", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: mergeGithub({
      pullRequest: { ...mergedPullRequest(), mergeableState: "unknown" },
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.report, mergeReports.alreadyMerged(mergedTarget));
  assert.deepEqual(github.merges, []);
});

test("answers not open when GitHub reports unknown mergeability for a closed pull request", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: mergeGithub({
      pullRequest: openPullRequest({
        state: "closed",
        mergeableState: "unknown",
      }),
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.doesNotMatch(result.report, /No he pogut llegir/u);
  assert.equal(result.report, mergeReports.notOpen({ pullRequestNumber: 200 }));
  assert.deepEqual(github.merges, []);
});

test("merges once GitHub finishes computing the mergeability", async (context) => {
  const { deliverPreview, handler, github } = setup(context, {
    github: mergeGithub({
      pullRequestSequence: [openPullRequest({ mergeableState: "unknown" })],
    }),
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.report, mergeReports.merged(mergedTarget));
  assert.equal(github.reads, 4);
  assert.equal(github.merges.length, 1);
});

test("stops while waiting to read the mergeability again", async (context) => {
  const controller = new AbortController();
  const github = mergeGithub({
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
  const github = mergeGithub({
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
    const github = mergeGithub({
      mergeError: new GitHubResponseError("PUT", "/merge", status),
    });
    const { deliverPreview, handler, merges, traces } = setup(context, {
      github,
    });
    deliverPreview();

    const result = await handler.handle(request(20), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.equal(
      result.report,
      mergeReports.failed({ pullRequestNumber: 200 }),
    );
    assert.equal(merges.state(20), "failed");
    assert.equal(traces.at(-1).action, "merge_failed");
    assert.equal(traces.at(-1).detail, "#200 aaaaaaa HTTP 4xx");
    assert.equal(traces.at(-1).authorIdentifier, 555);
    assert.equal(traces.at(-1).sessionKey, sessionKey);

    github.mergeError = null;
    const retry = await handler.handle(request(21), bareCommand);
    assert.equal(retry.report, mergeReports.merged(mergedTarget));
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
    const github = mergeGithub({ mergeError: error });
    const { deliverPreview, handler, merges, traces } = setup(context, {
      github,
    });
    deliverPreview();

    const result = await handler.handle(request(20), bareCommand);

    assert.equal(result.outcome, "answered");
    assert.equal(
      result.report,
      mergeReports.uncertain({ pullRequestNumber: 200 }),
    );
    assert.equal(merges.state(20), "uncertain");
    assert.equal(traces.at(-1).action, "merge_uncertain");
    assert.equal(traces.at(-1).authorIdentifier, 555);
    assert.equal(traces.at(-1).sessionKey, sessionKey);

    // The pull request is still open: a person decides, nothing is repeated.
    github.mergeError = null;
    const again = await handler.handle(request(21), bareCommand);
    assert.equal(
      again.report,
      mergeReports.uncertainOpen({ pullRequestNumber: 200, commit }),
    );
    assert.equal(github.merges.length, 1);
    assert.equal(merges.state(21), undefined);
    assert.equal(traces.at(-1).detail, "uncertain_pending #200 aaaaaaa");
  });
}

test("an aborted merge call is uncertain", async (context) => {
  const controller = new AbortController();
  const github = mergeGithub({
    mergeError: new DOMException("aborted", "AbortError"),
  });
  github.beforeMerge = () => controller.abort();
  const { deliverPreview, handler, merges } = setup(context, { github });
  deliverPreview();

  await handler.handle(request(20), bareCommand, { signal: controller.signal });

  assert.equal(merges.state(20), "uncertain");
});

test("an uncertain merge that GitHub shows as merged is closed and reported", async (context) => {
  const github = mergeGithub({ mergeError: new TypeError("fetch failed") });
  const { deliverPreview, handler, merges, traces } = setup(context, {
    github,
  });
  deliverPreview();
  await handler.handle(request(20), bareCommand);

  github.mergeError = null;
  github.pullRequest = mergedPullRequest();
  const result = await handler.handle(request(21), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, mergeReports.reconciled(mergedTarget));
  assert.equal(merges.state(20), "merged");
  assert.equal(github.merges.length, 1);
  const reconciled = traces.at(-1);
  assert.equal(reconciled.action, "merge_reconciled");
  assert.equal(reconciled.updateIdentifier, 20);
  assert.equal(reconciled.authorIdentifier, 555);
  assert.equal(reconciled.detail, `#200 aaaaaaa ${mergeCommit}`);
});

test("an uncertain merge whose pull request cannot be read refuses as unreadable", async (context) => {
  const github = mergeGithub({ mergeError: new TypeError("fetch failed") });
  const { deliverPreview, handler, merges } = setup(context, { github });
  deliverPreview();
  await handler.handle(request(20), bareCommand);

  github.readError = new Error("network down");
  const result = await handler.handle(request(21), bareCommand);

  assert.equal(
    result.report,
    mergeReports.unreadable({ pullRequestNumber: 200 }),
  );
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

  assert.equal(result.report, mergeReports.alreadyHandled);
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

  assert.equal(
    result.report,
    mergeReports.alreadyInProgress({ pullRequestNumber: 200 }),
  );
  assert.deepEqual(github.merges, []);
});

test("startup closes an uncertain merge that GitHub shows as merged and tells the topic", async (context) => {
  const github = mergeGithub({ pullRequest: mergedPullRequest() });
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
  assert.equal(sent[0].text, mergeReports.reconciled(mergedTarget));
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
  const github = mergeGithub({ pullRequest: mergedPullRequest() });
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
  assert.equal(
    sent[0].text,
    mergeReports.uncertainOpen({ pullRequestNumber: 200, commit }),
  );
  assert.ok(
    sent[0].text.includes(`\`/merge 200 ${commit}\``),
    "the topic carries the exact command to confirm the unknown result",
  );
  assert.ok(sent[0].signal instanceof AbortSignal);
  assert.deepEqual(traces, []);
});

test("startup tells the topic that an unmerged closed pull request cannot be merged", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ state: "closed" }),
  });
  const { handler, merges, sent } = setup(context, { github });
  interruptedMerge(merges);

  await handler.reconcileUncertain();
  await handler.reconcileUncertain();

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].text,
    mergeReports.uncertainClosed({ pullRequestNumber: 200 }),
  );
  // The merge can never happen, so the row ends instead of blocking every start.
  assert.equal(merges.state(20), "not_merged");
  assert.deepEqual(merges.uncertain(), []);
});

test("startup does not repeat the notice of a result the topic was already told", async (context) => {
  const github = mergeGithub({ mergeError: new TypeError("fetch failed") });
  const { deliverPreview, handler, sent } = setup(context, { github });
  deliverPreview();
  await handler.handle(request(20), bareCommand);

  await handler.reconcileUncertain();

  assert.deepEqual(sent, []);
});

test("startup keeps an uncertain merge when it cannot be read or the notice is not sent", async (context) => {
  const github = mergeGithub();
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
  const github = mergeGithub({
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
    assert.equal(
      result.report,
      mergeReports.uncertainOpen({ pullRequestNumber: 200, commit }),
    );
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

  assert.equal(
    result.report,
    mergeReports.uncertainOpen({ pullRequestNumber: 200, commit }),
  );
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

  assert.equal(
    result.report,
    mergeReports.uncertainCleared({ pullRequestNumber: 200 }),
  );
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
  assert.equal(merged.report, mergeReports.merged(mergedTarget));
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
  assert.equal(
    result.report,
    mergeReports.uncertainOpen({ pullRequestNumber: 200, commit }),
  );
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

  assert.equal(
    result.report,
    mergeReports.uncertainCleared({ pullRequestNumber: 200 }),
  );
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

  assert.equal(result.report, mergeReports.noDeliveredPreview);
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
  assert.equal(
    asked.report,
    mergeReports.uncertainOpen({ pullRequestNumber: 200, commit: movedCommit }),
  );
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
  assert.equal(
    stale.report,
    mergeReports.uncertainOpen({ pullRequestNumber: 200, commit: movedCommit }),
  );
  assert.ok(stale.report.includes(`\`/merge 200 ${movedCommit}\``));
  assert.equal(github.merges.length, 1);
  assert.equal(merges.state(20), "uncertain");

  const cleared = await handler.handle(request(23), {
    valid: true,
    pullRequestNumber: 200,
    commit: movedCommit,
  });
  assert.equal(
    cleared.report,
    mergeReports.uncertainCleared({ pullRequestNumber: 200 }),
  );
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(23), undefined);
  assert.equal(github.merges.length, 1);
  const clearedTrace = traces.find(
    (entry) => entry.action === "merge_uncertain_cleared",
  );
  assert.equal(clearedTrace.detail, `#200 ${movedCommit.slice(0, 7)}`);

  const merged = await handler.handle(request(24), bareCommand);
  assert.equal(merged.report, mergeReports.merged(mergedTarget));
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

  assert.equal(
    cleared.report,
    mergeReports.uncertainCleared({ pullRequestNumber: 200 }),
  );
  assert.equal(merges.state(20), "not_merged");
  assert.equal(github.merges.length, 1, "nothing new was merged");
  const clearedTrace = traces.find(
    (entry) => entry.action === "merge_uncertain_cleared",
  );
  assert.equal(clearedTrace.detail, `#200 ${movedCommit.slice(0, 7)}`);

  // The delivered preview of the new head arrives: a new request merges it.
  deliverPreview(deliveredPreviewRow({ commitSha: movedCommit }));
  const merged = await handler.handle(request(22), bareCommand);

  assert.equal(merged.report, mergeReports.merged(mergedTarget));
  assert.equal(merges.state(20), "not_merged");
  assert.equal(merges.state(22), "merged");
  assert.deepEqual(github.merges.at(-1), { number: 200, sha: movedCommit });
});

test("refuses a live pull request that GitHub shows merged", async (context) => {
  const { deliverPreview, handler, github, traces } = setup(context);
  deliverPreview();
  github.pullRequest = mergedPullRequest();

  const result = await handler.handle(request(20), bareCommand);

  assert.equal(result.report, mergeReports.alreadyMerged(mergedTarget));
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
  assert.equal(
    cleared.report,
    mergeReports.uncertainCleared({ pullRequestNumber: 200 }),
  );
  assert.equal(merges.state(20), "not_merged");
  assert.equal(github.merges.length, 1);

  const retry = await handler.handle(request(22), bareCommand);
  assert.equal(
    retry.report,
    mergeReports.checksNotGreen({ pullRequestNumber: 200 }),
  );
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

  assert.equal(
    result.report,
    mergeReports.uncertainClosed({ pullRequestNumber: 200 }),
  );
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

  assert.equal(result.report, mergeReports.reconciled(mergedTarget));
  assert.equal(merges.state(20), "merged");
  assert.equal(github.merges.length, 1);
});

test("answers that the pull request is already merged from its delivered preview", async (context) => {
  const { deliverPreview, handler, github, traces } = setup(context, {
    github: mergeGithub({ pullRequest: mergedPullRequest() }),
  });
  deliverPreview();

  for (const [updateIdentifier, command] of [
    [20, bareCommand],
    [21, { valid: true, pullRequestNumber: 200 }],
  ]) {
    const result = await handler.handle(request(updateIdentifier), command);
    assert.equal(result.report, mergeReports.alreadyMerged(mergedTarget));
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

  assert.equal(result.report, mergeReports.mergedUnsaved(mergedTarget));
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
    const github = mergeGithub({ mergeError: error });
    const { deliverPreview, handler, merges } = setup(context, { github });
    deliverPreview();
    merges[method] = () => {
      throw new Error("disk full");
    };

    const result = await handler.handle(request(20), bareCommand);

    assert.equal(
      result.report,
      mergeReports.uncertain({ pullRequestNumber: 200 }),
    );
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

  assert.equal(result.report, mergeReports.merged(mergedTarget));
  assert.equal(github.merges.length, 1);
  assert.ok(failures.includes("merge_trace_failed"));
});

test("a behind branch triggers the synchronisation with the trusted pin and never merges", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({
      mergeableState: "behind",
      headRef: "work",
      baseSha: "c".repeat(40),
    }),
  });
  const { deliverPreview, handler, synchronization, merges, traces } = setup(
    context,
    { github },
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
  const { deliverPreview, handler, synchronization, github } = setup(
    context,
    {},
  );
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(synchronization.calls, []);
  assert.equal(github.merges.length, 1);
});

test("a conflict with main reaches synchronization instead of attempting the merge", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "dirty" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
  });
  deliverPreview();

  const result = await handler.handle(request(), bareCommand);

  assert.deepEqual(result, synchronization.result);
  assert.equal(synchronization.calls.length, 1);
  assert.deepEqual(github.merges, []);
});

test("a still-open merge prevents synchronizing a behind pull request", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, merges, synchronization } = setup(context, {
    github,
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

  assert.equal(
    result.report,
    mergeReports.alreadyInProgress({ pullRequestNumber: 200 }),
  );
  assert.deepEqual(synchronization.calls, []);
  assert.deepEqual(github.merges, []);
  assert.equal(merges.state(19), "merging");
});

test("fresh requests repeat synchronization until the delivered commit is current", async (context) => {
  const { deliverPreview, handler, github, previews, synchronization } = setup(
    context,
    {},
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
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
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
    const github = mergeGithub({
      pullRequest: openPullRequest({ mergeableState: "behind", ...prepare }),
    });
    const { deliverPreview, handler, synchronization } = setup(context, {
      github,
    });
    deliverPreview();

    await handler.handle(request(), bareCommand);

    assert.deepEqual(synchronization.calls, [], name);
  });
}

test("a behind branch with checks not green never synchronises", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
    checkRuns: [{ name: "Validate", status: "in_progress", conclusion: null }],
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
  });
  deliverPreview();

  await handler.handle(request(), bareCommand);

  assert.deepEqual(synchronization.calls, []);
});

test("a behind branch for a person who left or with newer work never synchronises", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, membership, newerWork } =
    setup(context, { github });
  deliverPreview();
  membership.result = { verified: false, reason: "not_member" };
  await handler.handle(request(), bareCommand);
  membership.result = { verified: true, status: "member" };
  newerWork.value = true;
  await handler.handle(request(21), bareCommand);

  assert.deepEqual(synchronization.calls, []);
});

test("a preview replaced during the live read prevents the synchronisation", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, previews } = setup(
    context,
    { github },
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
  assert.equal(result.report, mergeReports.noDeliveredPreview);
});

test("a failing synchronisation refuses as behind and still never merges", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, traces } = setup(context, {
    github,
  });
  deliverPreview();
  synchronization.error = new Error("sync failed");

  const result = await handler.handle(request(), bareCommand);

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, mergeReports.behind({ pullRequestNumber: 200 }));
  assert.deepEqual(github.merges, []);
  assert.ok(actions(traces).includes("merge_refused"));
});

test("an aborted synchronisation propagates the abort", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
  });
  deliverPreview();
  const abort = new AbortController();
  synchronization.error = new Error("stopped");
  abort.abort(synchronization.error);

  await assert.rejects(
    handler.handle(request(), bareCommand, { signal: abort.signal }),
  );
});

test("an uncertain result keeps its query-only path and never synchronises", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization, merges } = setup(context, {
    github,
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
    const { deliverPreview, handler, github, merges, traces } = setup(
      context,
      {},
    );
    deliverPreview();

    const result = await handler.handle(
      { ...request(), messageIdentifier },
      bareCommand,
    );

    assert.equal(result.outcome, "answered");
    assert.equal(result.report, mergeReports.noDeliveredPreview);
    assert.deepEqual(github.merges, []);
    assert.equal(merges.state(20), undefined);
    assert.ok(actions(traces).includes("merge_refused"));
    assert.match(traces.at(-1).detail, /^predates_preview/u);
  });
}

test("an old merge never synchronises a behind branch", async (context) => {
  const github = mergeGithub({
    pullRequest: openPullRequest({ mergeableState: "behind" }),
  });
  const { deliverPreview, handler, synchronization } = setup(context, {
    github,
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

  assert.equal(result.report, mergeReports.noDeliveredPreview);
  assert.deepEqual(github.merges, []);
});

test("strict protection rejects the pinned merge when main advances after preflight", async (context) => {
  const { deliverPreview, handler, github, merges, synchronization } = setup(
    context,
    {},
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

  assert.equal(result.report, mergeReports.failed({ pullRequestNumber: 200 }));
  assert.deepEqual(github.merges, [{ number: 200, sha: commit }]);
  assert.deepEqual(synchronization.calls, []);
  assert.equal(merges.state(20), "failed");
});
