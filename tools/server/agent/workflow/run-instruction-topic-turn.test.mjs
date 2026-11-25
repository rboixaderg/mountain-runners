import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../repository/merge-request-store.mjs";
import { createResearchReview } from "../repository/research-review.mjs";
import { TopicJobStore } from "../repository/topic-job-store.mjs";
import {
  finishedTopicReport,
  instructionReports,
  mergeReports,
} from "../policy/development.mjs";
import { createMergeRequests } from "./merge-request.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { createTopicResearch } from "../web-research/topic-research.mjs";
import { git } from "../repository/test-support/git-repository.mjs";
import { publicationGithub } from "./test-support/github.mjs";
import {
  fixture,
  configFor,
  topicSessionKey,
  identifiersFor,
  topicWorktreePath,
  promptOf,
  noteStore,
  request,
  publishedWorktree,
} from "./test-support/run-instruction.mjs";

function researchFixture(review, operations) {
  return createTopicResearch({
    broker: async (operation) => {
      operations.push(operation);
      return {
        kind: "result",
        data: { trust: "untrusted", text: "Synthetic source." },
        sources: [
          { kind: "page", url: "https://example.test/route?private=1#map" },
        ],
      };
    },
    telegram: {},
    attribution: { groupIdentifier: "-1001234567890" },
    checkMembership: async () => assert.fail("no confirmation is expected"),
    markResearch: (jobId) => review.markResearch(jobId),
    worktreeForSession: () => assert.fail("no continuation is expected"),
    hasInterveningInstructions: () => false,
  });
}

test("a question with web research is a writable turn that reports sources", async (context) => {
  const paths = await fixture(context);
  const jobId = identifiersFor(paths).worktreeName(topicSessionKey);
  const review = createResearchReview({
    directory: join(paths.state, "review"),
  });
  const operations = [];
  const github = publicationGithub();
  let preparations = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    researchReview: review,
    research: researchFixture(review, operations),
    executeSandbox: async () => {
      preparations += 1;
      return { exitCode: 0, timedOut: false };
    },
    executeAgent: async (_config, options) => {
      const result = await options.webResearch(
        { operation: "read", input: "https://example.test/route" },
        {},
      );
      assert.equal(result.data.text, "Synthetic source.");
      return { text: "Resposta contrastada." };
    },
    runChecks: async () => assert.fail("an unchanged turn needs no checks"),
  });

  const result = await runner(request({ instruction: "Consulta la ruta." }));

  assert.equal(result.outcome, "answered", result.report);
  assert.equal(
    result.report,
    "Resposta contrastada.\n\nFonts:\n- Pàgina llegida: https://example.test/route (paràmetres omesos)",
  );
  assert.equal(preparations, 1);
  assert.deepEqual(operations, [
    { operation: "read", input: "https://example.test/route" },
  ]);
  assert.equal(review.isTainted(jobId), true);
  assert.equal(
    await git(topicWorktreePath(paths), ["branch", "--show-current"]),
    "",
  );
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
});

test("a merge before the first change leaves the job without private review", async (context) => {
  const paths = await fixture(context);
  const review = createResearchReview({
    directory: join(paths.state, "review"),
  });
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    researchReview: review,
    requestMerge: async () => ({ outcome: "answered", report: "merge" }),
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "change\n");
      return { text: "Canvi fet.\nSUMMARY: feat(content): add a change" };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  await runner(request({ instruction: "/merge" }));
  const result = await runner(request({ updateIdentifier: 1003 }));

  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.equal(
    review.isTainted(identifiersFor(paths).worktreeName(topicSessionKey)),
    false,
  );
  assert.equal(github.pushes.length, 1);
});

test("a research-informed change requires approval and retries the reviewed snapshot without Pi", async (context) => {
  const paths = await fixture(context);
  const review = createResearchReview({
    directory: join(paths.state, "review"),
  });
  const operations = [];
  const github = publicationGithub();
  github.researchCandidate = async ({
    worktree,
    branch,
    title,
    body,
    repair,
  }) => ({
    repository: "rboixaderg/mountain-runners",
    worktreePath: worktree.path,
    gitDirectory: worktree.gitDirectory,
    branch,
    commit: await git(worktree.path, ["rev-parse", "HEAD"]),
    base: await git(worktree.path, ["rev-parse", "origin/main"]),
    expectedHead: null,
    title,
    body,
    repair: repair ?? null,
  });
  let turns = 0;
  let checks = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    researchReview: review,
    research: researchFixture(review, operations),
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      turns += 1;
      assert.equal(typeof options.webResearch, "function");
      await options.webResearch(
        { operation: "read", input: "https://example.test/route" },
        {},
      );
      writeFileSync(join(options.worktreePath, "change.txt"), "change\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): source-derived title" };
    },
    runChecks: async () => {
      checks += 1;
      return { exitCode: 0, timedOut: false };
    },
  });

  const first = await runner(request());
  const jobId = identifiersFor(paths).worktreeName(topicSessionKey);
  const status = review.status(jobId);
  assert.equal(first.outcome, "research_review_required", first.report);
  assert.match(first.report, /Pàgina llegida: https:\/\/example\.test\/route/u);
  assert.equal(status.tainted, true);
  assert.equal(status.approved, false);
  assert.match(status.reviewId, /^[a-f0-9]{64}$/u);
  assert.ok(first.report.includes(status.reviewId));
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
  const candidate = review.candidate(jobId, status.reviewId);
  assert.equal(
    candidate.commit,
    await git(topicWorktreePath(paths), ["rev-parse", "HEAD"]),
  );
  assert.equal(candidate.title, "feat(agent): update project");
  assert.match(candidate.body, /change\.txt/u);
  assert.doesNotMatch(candidate.body, /example\.test|source-derived/u);
  assert.equal(operations.length, 1);

  review.approve(jobId, status.reviewId);
  const retry = await runner(
    request({ updateIdentifier: 1002, instruction: "/publica-revisio" }),
  );

  assert.equal(retry.outcome, "pull_request_created", retry.report);
  assert.equal(turns, 1);
  assert.equal(checks, 2);
  assert.equal(github.pushes.length, 1);
  assert.deepEqual(github.pushes[0].approved, candidate);
  assert.equal(
    await git(topicWorktreePath(paths), ["rev-parse", "HEAD"]),
    candidate.commit,
  );
  assert.equal(github.pulls.length, 1);
  assert.equal(github.pulls[0].branch, candidate.branch);
  assert.equal(github.pulls[0].title, candidate.title);
  assert.equal(github.pulls[0].body, candidate.body);
  assert.equal(review.status(jobId).reviewId, status.reviewId);
});

test("gives the prompt the current instant of the service in Europe/Madrid", async (context) => {
  const paths = await fixture(context);
  const prompts = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    now: () => new Date("2026-11-18T09:32:05.000Z"),
    executeAgent: async (_config, options) => {
      prompts.push(promptOf(options));
      return { text: "Resposta." };
    },
  });

  await runner(request());

  assert.match(
    prompts[0],
    /Current instant, in Europe\/Madrid with its offset: 2026-11-18T10:32:05\+01:00\./u,
    "the prompt carries the instant the service fixed, not the sandbox clock",
  );
  assert.doesNotMatch(prompts[0], /undefined/u);
});

test("answers a consultation without creating a branch or a remote effect", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,

    runModel: async () => ({ text: "El fitxer diu synthetic." }),
    runChecks: async () =>
      assert.fail("checks must not run for a consultation"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "El fitxer diu synthetic.");
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
  assert.equal(existsSync(join(paths.worktrees, "scratch-1001")), false);
  assert.equal(await git(paths.repository, ["branch", "--list", "feat/*"]), "");
});

test("strips the change summary from a consultation answer", async (context) => {
  const paths = await fixture(context);
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    runModel: async () => ({
      text: "La notícia ja hi és.\nSUMMARY: content(posts): add the news",
    }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "La notícia ja hi és.");
  assert.doesNotMatch(result.report, /SUMMARY|content\(posts\)/u);
});

test("runs a question as one writable turn without publication", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const turns = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    runModel: async (options) => {
      turns.push(options);
      return { text: "La data és el 15 de maig." };
    },
    runChecks: async () => assert.fail("an unchanged turn must not run checks"),
  });

  const result = await runner(request({ instruction: "Quina és la data?" }));

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "La data és el 15 de maig.");
  assert.equal(turns.length, 1);
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
});

/** A topic bound to pull request 200, with a simulated GitHub and model. */
async function boundTopicFixture(context, pullRequestOverrides) {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const github = publicationGithub();
  const published = await publishedWorktree(context, paths, github, ciWatches);
  const branch = await git(topicWorktreePath(paths), [
    "branch",
    "--show-current",
  ]);
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  topicJobs.bind({
    sessionKey: topicSessionKey,
    branch,
    pullRequestNumber: 200,
  });
  github.pullRequest = {
    state: "open",
    merged: false,
    headSha: published,
    headRef: branch,
    headRepository: "rboixaderg/mountain-runners",
    baseRef: "main",
    draft: false,
    ...pullRequestOverrides,
  };
  const pushesBefore = github.pushes.length;
  const pullsBefore = github.pulls.length;
  const calls = { model: 0 };
  const runnerOptions = {
    config: configFor(paths),
    github,
    ciWatches,
    topicJobs,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    runModel: async ({ worktreePath }) => {
      calls.model += 1;
      writeFileSync(join(worktreePath, "later.txt"), "later change\n");
      return { text: "SUMMARY: feat(tools): add a later change" };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  };
  return { github, calls, runnerOptions, pushesBefore, pullsBefore };
}

for (const [name, overrides] of [
  ["merged", { state: "closed", merged: true }],
  ["closed", { state: "closed", merged: false }],
]) {
  test(`answers a topic whose bound pull request is ${name} without a turn`, async (context) => {
    const fixtureState = await boundTopicFixture(context, overrides);
    const { github, calls } = fixtureState;
    const runner = createTestProjectRunner(fixtureState.runnerOptions);

    const result = await runner(request({ updateIdentifier: 1002 }));

    assert.equal(result.report, finishedTopicReport);
    assert.equal(calls.model, 0);
    assert.equal(github.pushes.length, fixtureState.pushesBefore);
    assert.equal(github.pulls.length, fixtureState.pullsBefore);
  });
}

test("a bound pull request that cannot be read is not assumed open", async (context) => {
  const fixtureState = await boundTopicFixture(context, {});
  const { github, calls } = fixtureState;
  github.getPullRequest = async () => {
    throw new Error("GitHub unavailable");
  };
  const runner = createTestProjectRunner(fixtureState.runnerOptions);

  const result = await runner(request({ updateIdentifier: 1002 }));

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.publicationReadFailed);
  assert.equal(calls.model, 0);
  assert.equal(github.pushes.length, fixtureState.pushesBefore);
  assert.equal(github.pulls.length, fixtureState.pullsBefore);
});

test("an open bound pull request still runs the model turn", async (context) => {
  const fixtureState = await boundTopicFixture(context, {});
  const { github, calls } = fixtureState;
  github.ensurePullRequest = async (options) => {
    github.pulls.push(options);
    return {
      pullRequest: {
        number: 200,
        htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
      },
      created: false,
    };
  };
  const runner = createTestProjectRunner(fixtureState.runnerOptions);

  const result = await runner(request({ updateIdentifier: 1002 }));

  assert.equal(result.outcome, "pull_request_updated");
  assert.equal(calls.model, 1);
});

test("/merge on a finished topic keeps its own path", async (context) => {
  const fixtureState = await boundTopicFixture(context, {
    state: "closed",
    merged: true,
  });
  const merges = [];
  const runner = createTestProjectRunner({
    ...fixtureState.runnerOptions,
    requestMerge: async (mergeRequest, command) => {
      merges.push(command);
      return { outcome: "answered", report: "refusal of the merge path" };
    },
  });

  const result = await runner(request({ instruction: "/merge" }));

  assert.equal(result.report, "refusal of the merge path");
  assert.deepEqual(merges, [{ valid: true }]);
  assert.equal(fixtureState.calls.model, 0);
});

test("prepares dependencies before the model for an implementation", async (context) => {
  const paths = await fixture(context);
  const calls = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    executeSandbox: async (options) => {
      calls.push({ kind: "prepare", command: options.command });
      return { exitCode: 0, timedOut: false };
    },
    executeAgent: async () => {
      calls.push({ kind: "model" });
      return { text: "No changes." };
    },
  });
  const result = await runner(request());
  assert.equal(result.outcome, "answered");
  assert.deepEqual(
    calls.map((call) => call.kind),
    ["prepare", "model"],
  );
  assert.match(calls[0].command.join(" "), /pnpm install --offline/u);
});

test("prepares a writable environment for a question", async (context) => {
  const paths = await fixture(context);
  let prepared = false;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    executeSandbox: async () => {
      prepared = true;
      return { exitCode: 0, timedOut: false };
    },
    executeAgent: async () => {
      return { text: "Synthetic answer." };
    },
  });
  assert.equal((await runner(request())).outcome, "answered");
  assert.equal(prepared, true);
});

test("publishes a change made while answering a question", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "change\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  const result = await runner(request({ instruction: "Pots revisar això?" }));

  assert.equal(result.outcome, "pull_request_created");
  assert.equal(github.pushes.length, 1);
  assert.equal(github.pulls.length, 1);
});

test("does not start the model when offline preparation fails", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  let modelStarted = false;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    executeSandbox: async () => ({ exitCode: 1, timedOut: false }),
    executeAgent: async () => {
      modelStarted = true;
      return { text: "unexpected" };
    },
  });
  const result = await runner(request());
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.preparationFailed);
  assert.equal(modelStarted, false);
  assert.deepEqual(github.pushes, []);
});

test("reports a timed-out preparation without starting the model", async (context) => {
  const paths = await fixture(context);
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    executeSandbox: async () => ({ exitCode: -1, timedOut: true }),
    executeAgent: async () => assert.fail("model must not run"),
  });
  const result = await runner(request());
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.modelTimedOut);
});

test("runs a continuation without pending work as a writable topic turn", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const modelContexts = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    runModel: async (modelContext) => {
      modelContexts.push(modelContext);
      return { text: "Aquest tema no té feina pendent." };
    },
    runChecks: async () => assert.fail("checks must not run"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "Aquest tema no té feina pendent.");
  assert.equal(modelContexts.length, 1, "the message reaches the session");
  assert.equal(github.pushes.length, 0, "a consultation publishes nothing");
  assert.equal(
    await git(topicWorktreePath(paths), ["branch", "--show-current"]),
    "",
    "a consultation creates no branch",
  );
});

test("publishes the answer of a continuation on a clean topic that asked a question", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const github = publicationGithub();
  let turn = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    sessionNotes: notes,
    runModel: async ({ worktreePath }) => {
      turn += 1;
      if (turn === 1) {
        return { text: "Quants participants hi havia?" };
      }
      writeFileSync(join(worktreePath, "facts.txt"), "42 participants\n");
      return { text: "SUMMARY: feat(content): add the facts" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });

  const first = await runner(request());
  const second = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "hi havia 42 participants",
    }),
  );

  assert.equal(first.outcome, "answered");
  assert.equal(
    second.outcome,
    "pull_request_created",
    "the answer to the question keeps the writable turn",
  );
  assert.equal(github.pulls.length, 1);
});

test("keeps one worktree per topic so the Pi session continues", async (context) => {
  const paths = await fixture(context);
  const seen = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    runModel: async ({ worktreePath }) => {
      seen.push(worktreePath);
      return { text: "Resposta." };
    },
    runChecks: async () => assert.fail("checks must not run"),
  });

  await runner(request({ updateIdentifier: 1001 }));
  await runner(request({ updateIdentifier: 1002 }));

  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
  assert.equal(basename(seen[0]), basename(topicWorktreePath(paths)));
});

test("gives the sandbox an opaque name that carries no chat or topic", async (context) => {
  const paths = await fixture(context);
  const seen = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    runModel: async (modelContext) => {
      seen.push(modelContext);
      writeFileSync(join(modelContext.worktreePath, "change.txt"), "canvi\n");
      return { text: "SUMMARY: feat(tools): change a file" };
    },
    runChecks: async (checkContext) => {
      seen.push(checkContext);
      return { exitCode: 0 };
    },
  });

  await runner(request());

  const [modelContext, checkContext] = seen;
  const opaqueName = identifiersFor(paths).worktreeName(topicSessionKey);
  assert.equal(modelContext.sandboxIdentifier, opaqueName);
  assert.equal(checkContext.sandboxIdentifier, opaqueName);
  assert.match(opaqueName, /^topic-[0-9a-f]{16}$/u);
  assert.equal(opaqueName.includes("1001234567890"), false);
  assert.equal(
    modelContext.sessionIdentifier,
    "topic_n1001234567890_7",
    "the Pi session file keeps the private identifier outside the sandbox",
  );
  assert.equal(basename(modelContext.worktreePath), opaqueName);
  const gitMarker = readFileSync(
    join(modelContext.worktreePath, ".git"),
    "utf8",
  );
  assert.doesNotMatch(gitMarker, /1001234567890/u);
  assert.doesNotMatch(gitMarker, /topic_n/u);
  // `git worktree add` names the administrative directory after the worktree,
  // so a new worktree is opaque from the start.
  assert.equal(
    gitMarker.trim(),
    `gitdir: ${join(paths.repository, ".git", "worktrees", opaqueName)}`,
  );
});

test("routes a literal /merge command to the service before the model", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const commands = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    requestMerge: async (mergeRequest, command) => {
      commands.push([mergeRequest.updateIdentifier, command]);
      return { outcome: "answered", report: "PR fusionada" };
    },
    runModel: async () => assert.fail("the model must not run for a merge"),
    runChecks: async () => assert.fail("checks must not run for a merge"),
  });

  const bare = await runner(request({ instruction: "/merge" }));
  const numbered = await runner(request({ instruction: "/merge #12" }));
  const malformed = await runner(request({ instruction: "/merge 12 later" }));

  assert.deepEqual(bare, { outcome: "answered", report: "PR fusionada" });
  assert.deepEqual(numbered, bare);
  assert.deepEqual(malformed, bare);
  assert.deepEqual(commands, [
    [1001, { valid: true }],
    [1001, { valid: true, pullRequestNumber: 12, commit: undefined }],
    [1001, { valid: false }],
  ]);
  assert.deepEqual(github.pushes, []);
  assert.equal(existsSync(join(paths.worktrees, "scratch-1001")), false);
});

test("only contextual replies reach the merge confirmation", async (context) => {
  const paths = await fixture(context);
  const modelInstructions = [];
  mkdirSync(paths.state, { recursive: true });
  const store = new MergeRequestStore(join(paths.state, "merge.sqlite"));
  context.after(() => store.close());
  const sessionKey = request().sessionKey;
  const sentQuestions = [];
  const mergeConfirmation = createMergeRequests({
    store,
    findDeliveredPreview: (key) =>
      key === sessionKey
        ? {
            update_identifier: 10,
            pull_request_number: 200,
            commit_sha: "a".repeat(40),
            notice_message_identifier: 800,
          }
        : undefined,
    hasNewerWork: () => false,
    hasInterveningInstructions: () => false,
    verifyMembership: async () => ({ verified: true, status: "member" }),
    github: {
      ...publicationGithub(),
      async getChangedPaths() {
        const paths = ["apps/web/src/content/posts/la-cursa.yaml"];
        return { paths, presentPaths: paths };
      },
      async getTreeModes() {
        return new Map([
          ["apps/web/src/content/posts/la-cursa.yaml", "100644"],
        ]);
      },
      async getPullRequest() {
        return {
          state: "open",
          htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
          headSha: "a".repeat(40),
          headRepository: "rboixaderg/mountain-runners",
          draft: false,
          baseRef: "main",
          mergeableState: "clean",
          merged: false,
          mergeCommitSha: null,
          previewLabeled: true,
          previewRevoked: false,
        };
      },
      async getCommitCheckRuns() {
        return [
          { name: "Validate", status: "completed", conclusion: "success" },
        ];
      },
      async getCommitStatuses() {
        return [];
      },
    },
    repository: "rboixaderg/mountain-runners",
    requiredChecks: ["Validate"],
    telegram: {
      async sendMessage(message) {
        sentQuestions.push(message.text);
        return { message_id: 900 };
      },
    },
    retryDelayMilliseconds: 0,
  });
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    runModel: async ({ instruction }) => {
      modelInstructions.push(instruction);
      return { text: "Entesos." };
    },
    requestMergeConfirmation: mergeConfirmation,
  });

  const outOfContextValidation = await runner(
    request({
      updateIdentifier: 11,
      instruction: "La feina està validada",
      replyMessageIdentifier: 801,
    }),
  );
  assert.equal(outOfContextValidation.report, "Entesos.");
  assert.deepEqual(modelInstructions, ["La feina està validada"]);

  const contextualValidation = await runner(
    request({
      updateIdentifier: 12,
      instruction: "La feina està validada",
      replyMessageIdentifier: 800,
    }),
  );
  assert.equal(contextualValidation.outcome, "merge_context");
  assert.equal(sentQuestions.length, 1);
  assert.deepEqual(modelInstructions, ["La feina està validada"]);

  const outOfContextConfirm = await runner(
    request({
      updateIdentifier: 13,
      instruction: "si, produccio",
      replyMessageIdentifier: 901,
    }),
  );
  assert.equal(outOfContextConfirm.outcome, "merge_context");
  assert.equal(outOfContextConfirm.report, mergeReports.invalidQuestion);
  assert.deepEqual(modelInstructions, ["La feina està validada"]);
});

test("never treats prose as a merge", async (context) => {
  const paths = await fixture(context);
  let turns = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    requestMerge: async () => assert.fail("prose must never reach a merge"),
    runModel: async () => {
      turns += 1;
      return { text: "Vols que la fusioni?" };
    },
    runChecks: async () => assert.fail("checks must not run"),
  });

  for (const instruction of [
    "fusiona-la",
    "ho pots fusionar?",
    "si us plau /merge",
  ]) {
    const result = await runner(request({ instruction }));
    assert.equal(result.outcome, "answered");
    assert.equal(result.report, "Vols que la fusioni?");
  }
  assert.equal(turns, 3);
});

test("a merge store failure reaches the runner failure report", async (context) => {
  const paths = await fixture(context);
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    requestMerge: async () => {
      throw new Error("database is locked");
    },
    runModel: async () => assert.fail("the model must not run for a merge"),
    runChecks: async () => assert.fail("checks must not run for a merge"),
  });

  const result = await runner(request({ instruction: "/merge" }));

  assert.equal(result.outcome, "failed");
});

// T8.7: the conversation of a topic keeps every accepted message and receives
// the effects the service decided since its previous turn.

test("answers an unclear message with one writable topic turn", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const runs = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      runs.push({ ...options, message: promptOf(options) });
      return { text: "Vols que afegeixi la imatge a la notícia?" };
    },
  });

  const result = await runner(
    request({ instruction: "aquí tens la imatge que posarem a la notícia" }),
  );

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "Vols que afegeixi la imatge a la notícia?");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].sessionIdentifier, "topic_n1001234567890_7");
  assert.doesNotMatch(runs[0].message, /This request is/u);
  assert.match(
    runs[0].message,
    /aquí tens la imatge que posarem a la notícia/u,
  );
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
  assert.equal(
    await git(topicWorktreePath(paths), ["branch", "--show-current"]),
    "",
    "a consultation turn creates no branch",
  );
});

test("falls back to the fixed clarification text when the turn answers nothing", async (context) => {
  const paths = await fixture(context);
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    runModel: async () => ({ text: "   " }),
    runChecks: async () => assert.fail("checks must not run"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, instructionReports.clarification);
});
