import assert from "node:assert/strict";
import { PiRunError } from "telegram-pi-bridge/pi";
import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  PublicationBaseChangedError,
  PublishRefusedError,
} from "../repository/github.mjs";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../repository/merge-request-store.mjs";
import { createResearchReview } from "../repository/research-review.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import { TopicJobStore } from "../repository/topic-job-store.mjs";
import {
  attachmentReports,
  failedMaintainerNotice,
  finishedTopicReport,
  instructionReports,
  savedNotice,
  serviceNotesHeader,
  topicStateHeader,
} from "../policy/development.mjs";
import { createAttachmentPreparation } from "../attachments/prepare.mjs";
import { createAttachmentStore } from "../attachments/store.mjs";
import {
  jpegImage,
  pngImage,
} from "../attachments/test-support/synthetic-images.mjs";
import { runAgent } from "../runtime/agent.mjs";
import { createMergeRequests } from "./merge-request.mjs";
import { createProjectRunner } from "./project-runner.mjs";
import {
  createBranch,
  ensureSessionWorktree,
  hasUnpublishedCommit,
} from "../repository/worktrees.mjs";
import { openIdentifierNames } from "../repository/identifiers.mjs";
import { createNestedRepository } from "../repository/test-support/nested-repository.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";
import { createTopicResearch } from "../web-research/topic-research.mjs";

const executeFile = promisify(execFile);

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

async function fixture(context, { ignoreAttachments = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-job-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const origin = join(directory, "origin.git");
  const repository = join(directory, "repository");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, repository]);
  writeFileSync(join(repository, "README.md"), "synthetic\n");
  if (ignoreAttachments) {
    writeFileSync(join(repository, ".gitignore"), ".agent-attachments/\n");
    await git(repository, ["add", "README.md", ".gitignore"]);
  } else {
    await git(repository, ["add", "README.md"]);
  }
  await git(repository, ["commit", "-m", "chore: initial"]);
  await git(repository, ["push", "origin", "main"]);

  return {
    directory: realpathSync(directory),
    repository: realpathSync(repository),
    worktrees: join(directory, "worktrees"),
    state: join(directory, "state"),
  };
}

function configFor(paths) {
  return {
    telegram: { botToken: "telegram-secret" },
    github: {
      token: "github-secret",
      repository: "rboixaderg/mountain-runners",
    },
    model: {
      sandboxImage: "mountain-agent-pi:1.5.0",
      providerEnvironment: {},
    },
    paths: {
      repository: paths.repository,
      worktrees: paths.worktrees,
      state: paths.state,
    },
    limits: {
      executionTimeoutMs: 60000,
      sandboxProcessLimit: 64,
      sandboxMemoryMegabytes: 256,
      sandboxCpuCount: 1,
    },
  };
}

const topicSessionKey = "-1001234567890:7";
const otherSessionKey = "-1009999999999:3";

/** The installation names of the fixture: the runner reads the same salt file. */
function identifiersFor(paths) {
  return openIdentifierNames(paths.state);
}

function topicWorktreePath(paths, sessionKey = topicSessionKey) {
  return join(paths.worktrees, identifiersFor(paths).worktreeName(sessionKey));
}

/**
 * The prompt the injected runtime would send: the real adapter claims the
 * effects of the topic, reports that it is about to write the prompt and builds
 * the message with them, so a test does the same in that order.
 */
function promptOf(options) {
  const serviceNotes = options.claimServiceNotes();
  options.onPromptSent();
  return options.buildMessage(serviceNotes);
}

function branchSuffix(paths, updateIdentifier) {
  return identifiersFor(paths).changeSuffix(updateIdentifier);
}

/** The durable conversation state of the fixture: real SQLite, temporary file. */
function noteStore(context, paths) {
  mkdirSync(paths.state, { recursive: true });
  const store = new SessionNoteStore(join(paths.state, "session-notes.sqlite"));
  context.after(() => store.close());
  return store;
}

function request(overrides = {}) {
  return {
    updateIdentifier: 1001,
    messageIdentifier: 2001,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 42,
    instruction: "afegeix una prova sintètica",
    ...overrides,
  };
}

function githubStub() {
  return {
    pushes: [],
    pulls: [],
    labelled: [],
    labelError: null,
    async addPreviewLabel({ number }) {
      if (this.labelError) throw this.labelError;
      this.labelled.push(number);
    },
    pullRequest: { state: "open" },
    async getPullRequest() {
      return this.pullRequest;
    },
    async pushBranch(argumentsObject) {
      this.pushes.push(argumentsObject);
      argumentsObject.onPublicationStarted?.();
      return {
        branch: argumentsObject.branch,
        commit: await git(argumentsObject.worktree.path, ["rev-parse", "HEAD"]),
      };
    },
    async ensurePullRequest(argumentsObject) {
      this.pulls.push(argumentsObject);
      return {
        pullRequest: {
          number: 200,
          htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
        },
        created: true,
      };
    },
  };
}

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

test("a research consultation reports sources without publishing existing pending work", async (context) => {
  const paths = await fixture(context);
  const jobId = identifiersFor(paths).worktreeName(topicSessionKey);
  const worktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name: jobId,
  });
  writeFileSync(join(worktree.path, "pending.txt"), "pending work\n");
  const head = await git(worktree.path, ["rev-parse", "HEAD"]);
  const review = createResearchReview({
    directory: join(paths.state, "review"),
  });
  const operations = [];
  const github = githubStub();
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    researchReview: review,
    research: researchFixture(review, operations),
    classifyRequest: async () => ({ kind: "consultation" }),
    executeSandbox: async () =>
      assert.fail("a consultation needs no preparation"),
    executeAgent: async (_config, options) => {
      turns += 1;
      assert.equal(options.readOnly, true);
      assert.equal(typeof options.webResearch, "function");
      const result = await options.webResearch(
        { operation: "read", input: "https://example.test/route" },
        {},
      );
      assert.equal(result.data.text, "Synthetic source.");
      return { text: "Resposta contrastada." };
    },
    runChecks: async () => assert.fail("a consultation must not publish work"),
  });

  const result = await runner(request({ instruction: "Consulta la ruta." }));

  assert.equal(result.outcome, "answered", result.report);
  assert.equal(
    result.report,
    "Resposta contrastada.\n\nFonts:\n- Pàgina llegida: https://example.test/route (paràmetres omesos)",
  );
  assert.equal(turns, 1);
  assert.deepEqual(operations, [
    { operation: "read", input: "https://example.test/route" },
  ]);
  assert.equal(review.isTainted(jobId), true);
  assert.equal(
    readFileSync(join(worktree.path, "pending.txt"), "utf8"),
    "pending work\n",
  );
  assert.equal(await git(worktree.path, ["rev-parse", "HEAD"]), head);
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
});

test("a research-informed change requires approval and retries the reviewed snapshot without Pi", async (context) => {
  const paths = await fixture(context);
  const review = createResearchReview({
    directory: join(paths.state, "review"),
  });
  const operations = [];
  const github = githubStub();
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
  let classifications = 0;
  let checks = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    researchReview: review,
    research: researchFixture(review, operations),
    classifyRequest: async () => {
      classifications += 1;
      return { kind: "implementation" };
    },
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      turns += 1;
      assert.equal(options.readOnly, false);
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
  assert.equal(classifications, 1);
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
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "consultation" }),
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
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "consultation" }),
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
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "consultation" }),
    runModel: async () => ({
      text: "La notícia ja hi és.\nSUMMARY: content(posts): add the news",
    }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "La notícia ja hi és.");
  assert.doesNotMatch(result.report, /SUMMARY|content\(posts\)/u);
});

test("runs a classified question as one writable turn without publication", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const turns = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "consultation" }),
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
  assert.notEqual(turns[0].kind, "consultation");
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
});

test("former non-preview classifications all run the same writable turn", async (context) => {
  const modelKinds = [];
  for (const classifiedKind of [
    "consultation",
    "continuation",
    "implementation",
    "clarification",
  ]) {
    const paths = await fixture(context);
    const github = githubStub();
    const runner = createProjectRunner({
      config: configFor(paths),
      github,
      classifyRequest: async () => ({ kind: classifiedKind }),
      runModel: async ({ kind }) => {
        modelKinds.push({ kind });
        return { text: "Resposta." };
      },
      runChecks: async () => assert.fail("an unchanged turn needs no checks"),
    });
    const result = await runner(request({ instruction: "Quina és la data?" }));
    assert.equal(result.outcome, "answered", classifiedKind);
    assert.deepEqual(github.pushes, [], classifiedKind);
  }
  assert.equal(modelKinds.length, 4);
  assert.ok(modelKinds.every((turn) => turn.kind === modelKinds[0].kind));
  assert.ok(modelKinds.every((turn) => turn.kind !== "consultation"));
});

test("publishes a classified consultation to its existing pull request", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const github = githubStub();
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
    headSha: published,
    headRef: branch,
    headRepository: "rboixaderg/mountain-runners",
    baseRef: "main",
    draft: false,
  };
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
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    ciWatches,
    topicJobs,
    classifyRequest: async () => ({ kind: "consultation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "second.txt"), "second change\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add another change" };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  const result = await runner(request({ updateIdentifier: 1002 }));

  assert.equal(result.outcome, "pull_request_updated");
  assert.equal(github.pushes.at(-1).branch, branch);
  assert.equal(github.pulls.at(-1).createMissing, false);
});

/** A topic bound to pull request 200, with a simulated GitHub and model. */
async function boundTopicFixture(context, pullRequestOverrides) {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const github = githubStub();
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
  const calls = { model: 0, classifier: 0 };
  const runnerOptions = {
    config: configFor(paths),
    github,
    ciWatches,
    topicJobs,
    classifyRequest: async () => {
      calls.classifier += 1;
      return { kind: "implementation" };
    },
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
    const runner = createProjectRunner(fixtureState.runnerOptions);

    const result = await runner(request({ updateIdentifier: 1002 }));

    assert.equal(result.report, finishedTopicReport);
    assert.equal(
      finishedTopicReport,
      "Aquesta feina ja està acabada. Obre un tema nou per a una altra feina.",
    );
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
  const runner = createProjectRunner(fixtureState.runnerOptions);

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
  const runner = createProjectRunner(fixtureState.runnerOptions);

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
  const runner = createProjectRunner({
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
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
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

test("prepares a writable environment for a classified consultation", async (context) => {
  const paths = await fixture(context);
  let prepared = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "consultation" }),
    executeSandbox: async () => {
      prepared = true;
      return { exitCode: 0, timedOut: false };
    },
    executeAgent: async (_config, options) => {
      assert.equal(options.readOnly, false);
      return { text: "Synthetic answer." };
    },
  });
  assert.equal((await runner(request())).outcome, "answered");
  assert.equal(prepared, true);
});

test("publishes a change made during a classified consultation", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "consultation" }),
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
  const github = githubStub();
  let modelStarted = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
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
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    executeSandbox: async () => ({ exitCode: -1, timedOut: true }),
    executeAgent: async () => assert.fail("model must not run"),
  });
  const result = await runner(request());
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.modelTimedOut);
});

test("publishes a small change as a pull request after the checks pass", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const checks = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return {
        text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change",
      };
    },
    runChecks: async ({ worktreePath }) => {
      checks.push(worktreePath);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.match(result.report, /pull\/200/u);
  assert.equal(checks.length, 1);
  assert.equal(github.pushes.length, 1);
  assert.equal(
    github.pushes[0].branch,
    `feat/tools-add-synthetic-change-${branchSuffix(paths, 1001)}`,
  );
  assert.deepEqual(github.pushes[0].secrets, [
    "telegram-secret",
    "github-secret",
  ]);
  assert.equal(github.pulls.length, 1);
  assert.equal(github.pulls[0].title, "feat(tools): add synthetic change");
  assert.match(github.pulls[0].body, /change\.txt/u);
  assert.match(github.pulls[0].body, /pnpm check/u);

  const committed = await git(topicWorktreePath(paths), [
    "log",
    "-1",
    "--format=%s",
  ]);
  assert.equal(committed, "feat(tools): add synthetic change");
});

test("passes a fresh Git file inventory to the sandbox checks without mounting Git metadata", async (context) => {
  const paths = await fixture(context);
  let inventoryPath;
  let capturedFiles;
  let command;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "new file.md"), "# New\n");
      mkdirSync(join(worktreePath, ".agent-attachments"), { recursive: true });
      writeFileSync(
        join(worktreePath, ".agent-attachments", "ignored.md"),
        "ignored\n",
      );
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    executeSandbox: async (options) => {
      inventoryPath = options.documentationFilesPath;
      capturedFiles = readFileSync(inventoryPath, "utf8").split("\0");
      command = options.command[2];
      return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.ok(inventoryPath);
  assert.ok(capturedFiles.includes("PREADME.md"));
  assert.ok(capturedFiles.includes("Pnew file.md"));
  assert.ok(!capturedFiles.includes("P.agent-attachments/ignored.md"));
  assert.match(
    command,
    /MOUNTAIN_AGENT_DOCUMENTATION_FILES=\/tmp\/mountain-agent-documentation-files/u,
  );
  assert.equal(existsSync(inventoryPath), false);
});

test("the service inventory lets the real documentation checker run without the worktree gitdir", async (context) => {
  const paths = await fixture(context);
  const sandbox = join(paths.directory, "isolated-copy");
  const github = githubStub();
  let checkerRan = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      mkdirSync(join(worktreePath, "docs"));
      writeFileSync(
        join(worktreePath, "docs/README.md"),
        "# Map\n\n[Guide](guide.md)\n",
      );
      writeFileSync(join(worktreePath, "docs/guide.md"), "# Guide\n");
      return { text: "Canvi fet.\nSUMMARY: docs(tools): add synthetic guide" };
    },
    executeSandbox: async ({ workspacePath, documentationFilesPath }) => {
      cpSync(workspacePath, sandbox, { recursive: true });
      writeFileSync(join(sandbox, ".git"), "gitdir: /nonexistent/gitdir\n");
      const checker = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../../docs/check-docs.mjs", import.meta.url),
          ),
        ],
        {
          cwd: sandbox,
          encoding: "utf8",
          env: {
            ...process.env,
            MOUNTAIN_AGENT_DOCUMENTATION_FILES: documentationFilesPath,
          },
        },
      );
      checkerRan = true;
      assert.equal(checker.status, 0, checker.stderr);
      return {
        exitCode: checker.status,
        stdout: checker.stdout,
        stderr: checker.stderr,
        timedOut: false,
      };
    },
  });

  const result = await runner(request());

  assert.equal(checkerRan, true);
  assert.equal(result.outcome, "pull_request_created");
});

test("does not publish files created after the documentation inventory was captured", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const events = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    logger: (event) => events.push(event),
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "change\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    executeSandbox: async ({ workspacePath }) => {
      writeFileSync(join(workspacePath, "late.md"), "# Late\n");
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(github.pushes.length, 0);
  assert.ok(events.includes("documentation_inventory_changed"));
  assert.equal(existsSync(join(topicWorktreePath(paths), "late.md")), true);
});

test("leaves a file deleted by the checkpointed change out of the documentation inventory", async (context) => {
  const paths = await fixture(context);
  let checked = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      unlinkSync(join(worktreePath, "README.md"));
      return { text: "Canvi fet.\nSUMMARY: fix(tools): remove synthetic file" };
    },
    executeSandbox: async ({ documentationFilesPath }) => {
      const files = readFileSync(documentationFilesPath, "utf8").split("\0");
      assert.ok(files.includes("P.gitignore"));
      // The checkpoint commit already records the deletion.
      assert.equal(files.includes("DREADME.md"), false);
      assert.equal(files.includes("PREADME.md"), false);
      checked = true;
      return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(checked, true);
});

test("does not publish a tracked file deleted during the checks", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "change\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    executeSandbox: async ({ workspacePath }) => {
      unlinkSync(join(workspacePath, "README.md"));
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(github.pushes.length, 0);
});

test("keeps an unconfirmed sandbox stop uncertain even if inventory cleanup fails", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  let directory;
  context.after(() => {
    if (directory && existsSync(directory)) {
      chmodSync(directory, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "change\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    executeSandbox: async ({ documentationFilesPath }) => {
      directory = dirname(documentationFilesPath);
      chmodSync(directory, 0o500);
      throw new SandboxCleanupError();
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "uncertain");
  assert.equal(github.pushes.length, 0);
  assert.equal(existsSync(directory), true);
});

test("stops an ambiguous legacy topic before the model or any publication", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => {
    topicJobs.close();
    ciWatches.close();
  });
  for (const number of [200, 201]) {
    ciWatches.add({
      updateIdentifier: number,
      sessionKey: topicSessionKey,
      pullRequestNumber: number,
      commitSha: "a".repeat(40),
    });
  }
  const github = githubStub();
  github.getPullRequest = async ({ number }) => ({
    state: "open",
    baseRef: "main",
    headRepository: "rboixaderg/mountain-runners",
    headRef: `feat/agent-change-${number}`,
  });
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    ciWatches,
    topicJobs,
    classifyRequest: async () => assert.fail("classification must not run"),
    runModel: async () => assert.fail("model must not run"),
  });

  const result = await runner(request());
  assert.equal(result.outcome, "failed");
  assert.match(result.report, /persona que manté el servei/u);
  assert.equal(topicJobs.bindingOf(topicSessionKey), null);
  assert.deepEqual(github.pushes, []);
  assert.equal(existsSync(topicWorktreePath(paths)), false);
});

async function runMainSync(
  context,
  {
    conflict = false,
    resolveConflict = false,
    failCheck = false,
    binary = false,
    resolutionFails = false,
    breakCleanup = false,
  } = {},
) {
  const paths = await fixture(context);
  const github = githubStub();
  let checks = 0;
  let modelTurns = 0;
  let advancedMain;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath, instruction }) => {
      modelTurns += 1;
      if (modelTurns === 2) {
        assert.match(instruction, /README\.md/u);
        if (resolutionFails) throw new Error("Synthetic model failure.");
        if (breakCleanup)
          writeFileSync(join(worktreePath, ".git"), "tampered marker\n");
        if (!binary) {
          assert.match(
            readFileSync(join(worktreePath, "README.md"), "utf8"),
            /<<<<<<< /u,
          );
        }
        if (resolveConflict) {
          writeFileSync(
            join(worktreePath, "README.md"),
            "main change\ntopic change\n",
          );
        }
        return {
          text: resolveConflict
            ? "Conflicte resolt.\nCONFLICT_RESOLVED"
            : "Quina versió vols conservar?",
        };
      }
      const topicPath = conflict ? "README.md" : "change.txt";
      const mainPath = conflict ? "README.md" : "main-change.txt";
      writeFileSync(
        join(worktreePath, topicPath),
        binary ? Buffer.from([0, 1, 2]) : "topic change\n",
      );
      writeFileSync(
        join(paths.repository, mainPath),
        binary ? Buffer.from([0, 3, 4]) : "main change\n",
      );
      await git(paths.repository, ["add", mainPath]);
      await git(paths.repository, [
        "commit",
        "-m",
        "chore: advance synthetic main",
      ]);
      advancedMain = await git(paths.repository, ["rev-parse", "HEAD"]);
      await git(join(paths.directory, "origin.git"), [
        "fetch",
        paths.repository,
        "+refs/heads/main:refs/heads/main",
      ]);
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => {
      checks += 1;
      return {
        exitCode: failCheck && checks === 1 ? 1 : 0,
        timedOut: false,
      };
    },
  });
  const result = await runner(request());
  return { paths, github, result, checks, modelTurns, advancedMain };
}

test("integrates an advanced main before the only gate and publishes", async (context) => {
  const { paths, github, result, checks, advancedMain } =
    await runMainSync(context);
  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.equal(checks, 1);
  assert.equal(github.pushes[0].validated.base, advancedMain);
  assert.equal(github.pushes.length, 1);
  const parents = (
    await git(topicWorktreePath(paths), ["log", "-1", "--format=%P"])
  ).split(" ");
  assert.equal(parents.length, 2);
  assert.equal(parents[1], advancedMain);
});

test("aborts a conflicting main merge and keeps the topic commit", async (context) => {
  const { paths, github, result, checks, modelTurns } = await runMainSync(
    context,
    { conflict: true },
  );
  assert.equal(result.outcome, "failed");
  // The question of the model reaches the person; nothing is published.
  assert.equal(result.report, "Quina versió vols conservar?");
  assert.equal(checks, 0);
  assert.equal(modelTurns, 2);
  assert.deepEqual(github.pushes, []);
  const worktree = topicWorktreePath(paths);
  assert.equal(
    readFileSync(join(worktree, "README.md"), "utf8"),
    "topic change\n",
  );
  await assert.rejects(git(worktree, ["rev-parse", "--verify", "MERGE_HEAD"]));
});

test("publishes a conflict resolved by the model with both changes", async (context) => {
  const { paths, github, result, checks, modelTurns, advancedMain } =
    await runMainSync(context, { conflict: true, resolveConflict: true });
  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.equal(modelTurns, 2);
  assert.equal(checks, 1);
  assert.equal(github.pushes.length, 1);
  const worktree = topicWorktreePath(paths);
  assert.equal(
    readFileSync(join(worktree, "README.md"), "utf8"),
    "main change\ntopic change\n",
  );
  const parents = (await git(worktree, ["log", "-1", "--format=%P"])).split(
    " ",
  );
  assert.equal(parents[1], advancedMain);
});

test("aborts the merge if the conflict resolution turn fails", async (context) => {
  const { paths, github, result, modelTurns } = await runMainSync(context, {
    conflict: true,
    resolutionFails: true,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(modelTurns, 2);
  assert.deepEqual(github.pushes, []);
  const worktree = topicWorktreePath(paths);
  assert.equal(
    readFileSync(join(worktree, "README.md"), "utf8"),
    "topic change\n",
  );
  await assert.rejects(git(worktree, ["rev-parse", "--verify", "MERGE_HEAD"]));
});

test("blocks the service if it cannot abort the merge", async (context) => {
  const { github, result, modelTurns } = await runMainSync(context, {
    conflict: true,
    breakCleanup: true,
  });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.report, instructionReports.mergeCleanupUncertain);
  assert.equal(modelTurns, 2);
  assert.deepEqual(github.pushes, []);
});

test("never publishes an unresolved binary conflict", async (context) => {
  const { paths, github, result, modelTurns } = await runMainSync(context, {
    conflict: true,
    binary: true,
  });
  assert.equal(result.outcome, "failed");
  // A binary conflict never reaches the model.
  assert.equal(modelTurns, 1);
  assert.deepEqual(github.pushes, []);
  await assert.rejects(
    git(topicWorktreePath(paths), ["rev-parse", "--verify", "MERGE_HEAD"]),
  );
});

test("keeps a resolved merge without pushing when checks fail", async (context) => {
  const { paths, github, result, checks } = await runMainSync(context, {
    conflict: true,
    resolveConflict: true,
    failCheck: true,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.checksFailed);
  assert.equal(checks, 1);
  assert.deepEqual(github.pushes, []);
  assert.equal(
    readFileSync(join(topicWorktreePath(paths), "README.md"), "utf8"),
    "main change\ntopic change\n",
  );
  await assert.rejects(
    git(topicWorktreePath(paths), ["rev-parse", "--verify", "MERGE_HEAD"]),
  );
});

test("keeps the clean merge without pushing when synchronized checks fail", async (context) => {
  const { paths, github, result, checks, advancedMain } = await runMainSync(
    context,
    { failCheck: true },
  );
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.checksFailed);
  assert.equal(checks, 1);
  assert.deepEqual(github.pushes, []);
  const parents = (
    await git(topicWorktreePath(paths), ["log", "-1", "--format=%P"])
  ).split(" ");
  assert.equal(parents[1], advancedMain);
});

test("publishes pending work after a later question when checks recover", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const events = [];
  let turn = 0;
  let checkCount = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      turn += 1;
      events.push(`model:${turn}`);
      if (turn === 1) {
        writeFileSync(join(worktreePath, "change.txt"), "change\n");
        return { text: "SUMMARY: feat(tools): add synthetic change" };
      }
      return { text: "Resposta." };
    },
    runChecks: async () => {
      checkCount += 1;
      events.push(`checks:${checkCount}`);
      return { exitCode: checkCount === 1 ? 1 : 0, timedOut: false };
    },
  });

  const first = await runner(request());
  assert.equal(first.outcome, "failed");
  assert.equal(first.report, instructionReports.checksFailed);
  const second = await runner(
    request({ updateIdentifier: 1002, instruction: "Com està?" }),
  );

  assert.equal(second.outcome, "pull_request_created");
  assert.deepEqual(events, ["model:1", "checks:1", "model:2", "checks:2"]);
  assert.equal(github.pushes.length, 1);
  assert.equal(github.pulls.length, 1);
});

test("retries the same refused commit after the next model turn", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const pushBranch = github.pushBranch.bind(github);
  const events = [];
  let attempts = 0;
  const attemptedCommits = [];
  github.pushBranch = async (options) => {
    attempts += 1;
    attemptedCommits.push(
      await git(options.worktree.path, ["rev-parse", "HEAD"]),
    );
    events.push(`push:${attempts}`);
    if (attempts === 1) {
      throw new PublishRefusedError("Synthetic publication refusal.");
    }
    return pushBranch(options);
  };
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      turns += 1;
      events.push(`model:${turns}`);
      if (turns === 1) {
        writeFileSync(join(worktreePath, "change.txt"), "change\n");
        return { text: "SUMMARY: feat(tools): add synthetic change" };
      }
      return { text: "Resposta." };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  const first = await runner(request());
  assert.equal(first.outcome, "failed");
  assert.equal(first.report, instructionReports.publicationRefused);
  const second = await runner(
    request({ updateIdentifier: 1002, instruction: "Com està?" }),
  );

  assert.equal(second.outcome, "pull_request_created");
  assert.deepEqual(events, ["model:1", "push:1", "model:2", "push:2"]);
  assert.equal(attemptedCommits.length, 2);
  assert.equal(attemptedCommits[0], attemptedCommits[1]);
  assert.equal(github.pushes.length, 1);
});

test("retries a refused commit on an already bound pull request", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const github = githubStub();
  const pushBranch = github.pushBranch.bind(github);
  let remoteHead;
  let attempts = 0;
  const commits = [];
  github.pushBranch = async (options) => {
    attempts += 1;
    commits.push(await git(options.worktree.path, ["rev-parse", "HEAD"]));
    if (attempts === 2) throw new PublishRefusedError("Synthetic refusal.");
    const pushed = await pushBranch(options);
    remoteHead = pushed.commit;
    return pushed;
  };
  github.getPullRequest = async () => ({
    state: "open",
    draft: false,
    baseRef: "main",
    headRepository: "rboixaderg/mountain-runners",
    headRef: github.pushes[0].branch,
    headSha: remoteHead,
  });
  github.ensurePullRequest = async (options) => {
    github.pulls.push(options);
    return {
      pullRequest: {
        number: 200,
        htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
      },
      created: github.pulls.length === 1,
    };
  };
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      turns += 1;
      if (turns < 3) {
        writeFileSync(join(worktreePath, "change.txt"), `change ${turns}\n`);
        return { text: "SUMMARY: feat(tools): add synthetic change" };
      }
      return { text: "Resposta." };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  assert.equal((await runner(request())).outcome, "pull_request_created");
  const refused = await runner(request({ updateIdentifier: 1002 }));
  assert.equal(refused.report, instructionReports.publicationRefused);
  const originalRemoteHead = remoteHead;
  remoteHead = "f".repeat(40);
  const moved = await runner(request({ updateIdentifier: 1003 }));
  assert.equal(moved.outcome, "failed");
  assert.equal(turns, 2, "a changed remote head never reaches the model");
  assert.equal(attempts, 2, "a changed remote head is never pushed");
  remoteHead = originalRemoteHead;
  const retried = await runner(request({ updateIdentifier: 1004 }));
  assert.equal(retried.outcome, "pull_request_updated", retried.report);
  assert.equal(turns, 3);
  assert.equal(commits[1], commits[2]);
  assert.equal(github.pulls.at(-1).createMissing, false);
});

test("reports a persistent publication block after each model turn", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  let modelTurns = 0;
  let checkCount = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      modelTurns += 1;
      if (modelTurns === 1) {
        writeFileSync(join(worktreePath, "change.txt"), "change\n");
        return { text: "SUMMARY: feat(tools): add synthetic change" };
      }
      return { text: "Resposta." };
    },
    runChecks: async () => {
      checkCount += 1;
      return { exitCode: 1, timedOut: false };
    },
  });

  const first = await runner(request());
  assert.equal(first.outcome, "failed");
  assert.equal(first.report, instructionReports.checksFailed);
  const retried = await runner(request({ updateIdentifier: 1002 }));

  assert.equal(retried.outcome, "failed");
  assert.equal(retried.report, instructionReports.checksFailed);
  assert.equal(checkCount, 2);
  assert.equal(modelTurns, 2);
  assert.deepEqual(github.pushes, []);
});

test("does not bind a topic when local checks block publication", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "change\n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 1, timedOut: false }),
  });

  assert.equal((await runner(request())).outcome, "failed");
  assert.equal(topicJobs.bindingOf(topicSessionKey), null);
  assert.deepEqual(github.pushes, []);
});

test("does not take another topic's pull request when its number is mentioned", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  github.getPullRequest = async () =>
    assert.fail("another topic's pull request must not be read");
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "continuation" }),
    runModel: async ({ instruction }) => {
      assert.match(instruction, /#321/u);
      return { text: "Resposta." };
    },
    runChecks: async () => assert.fail("an unchanged turn needs no checks"),
  });
  const result = await runner(request({ instruction: "Continua la PR #321" }));
  assert.equal(result.outcome, "answered");
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
});

async function assertAdvancedPullRequest(
  context,
  {
    updateBranch = false,
    pending = false,
    ignoredConflict = false,
    pendingConflict = false,
    leaveConflict = false,
    diverged = false,
    noEdit = false,
  } = {},
) {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const github = githubStub();
  const origin = join(paths.directory, "origin.git");
  let remoteBranch;
  github.pushBranch = async ({ worktree, branch }) => {
    remoteBranch = branch;
    const commit = await git(worktree.path, ["rev-parse", "HEAD"]);
    await git(origin, [
      "fetch",
      worktree.path,
      `refs/heads/${branch}:refs/heads/${branch}`,
    ]);
    github.pushes.push({ branch, commit });
    return { branch, commit };
  };
  github.getPullRequest = async () => ({
    state: "open",
    draft: false,
    baseRef: "main",
    headRepository: "rboixaderg/mountain-runners",
    headRef: remoteBranch,
    headSha: await git(origin, ["rev-parse", `refs/heads/${remoteBranch}`]),
  });
  github.ensurePullRequest = async (options) => {
    github.pulls.push(options);
    return {
      pullRequest: {
        number: 200,
        htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
      },
      created: github.pulls.length === 1,
    };
  };
  let modelTurns = 0;
  let conflictTurns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath, instruction }) => {
      if (pendingConflict && instruction.includes("Conflicted paths")) {
        conflictTurns += 1;
        const conflictPath = join(worktreePath, "pending.txt");
        assert.match(readFileSync(conflictPath, "utf8"), /<<<<<<< /u);
        if (!leaveConflict)
          writeFileSync(conflictPath, "pending work\nremote work\n");
        return {
          text: leaveConflict
            ? "Quina versió vols?"
            : "Conflicte resolt.\nCONFLICT_RESOLVED",
        };
      }
      modelTurns += 1;
      if (modelTurns === 2) {
        assert.equal(
          readFileSync(join(worktreePath, "human.txt"), "utf8"),
          "human change\n",
        );
        if (pending) {
          assert.equal(
            readFileSync(join(worktreePath, "pending.txt"), "utf8"),
            pendingConflict ? "pending work\nremote work\n" : "pending work\n",
          );
        }
      }
      if (modelTurns === 2 && noEdit) {
        return { text: "Resposta." };
      }
      writeFileSync(
        join(worktreePath, `topic-${modelTurns}.txt`),
        "topic change\n",
      );
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  assert.equal((await runner(request())).outcome, "pull_request_created");
  const human = join(paths.directory, "human");
  await executeFile("git", ["clone", "--branch", remoteBranch, origin, human]);
  writeFileSync(join(human, "human.txt"), "human change\n");
  await git(human, ["add", "human.txt"]);
  if (pendingConflict) {
    writeFileSync(join(human, "pending.txt"), "remote work\n");
    await git(human, ["add", "pending.txt"]);
  }
  if (ignoredConflict) {
    mkdirSync(join(human, ".agent-attachments"), { recursive: true });
    writeFileSync(
      join(human, ".agent-attachments", "keep.txt"),
      "remote data\n",
    );
    await git(human, ["add", "-f", ".agent-attachments/keep.txt"]);
  }
  await git(human, ["commit", "-m", "feat(tools): add human change"]);
  let humanHead = await git(human, ["rev-parse", "HEAD"]);
  if (updateBranch) {
    await git(paths.repository, [
      "commit",
      "--allow-empty",
      "-m",
      "chore: advance main",
    ]);
    const mainHead = await git(paths.repository, ["rev-parse", "HEAD"]);
    await git(origin, [
      "fetch",
      paths.repository,
      "+refs/heads/main:refs/heads/main",
    ]);
    await git(human, ["fetch", "origin", "main"]);
    const tree = await git(human, ["rev-parse", "HEAD^{tree}"]);
    const mergeCommit = await git(human, [
      "commit-tree",
      tree,
      "-p",
      humanHead,
      "-p",
      mainHead,
      "-m",
      "Merge main",
    ]);
    await git(human, ["update-ref", `refs/heads/${remoteBranch}`, mergeCommit]);
    humanHead = mergeCommit;
  }
  if (diverged) {
    const tree = await git(human, ["rev-parse", "HEAD^{tree}"]);
    const base = await git(human, ["rev-parse", "origin/main"]);
    humanHead = await git(human, [
      "commit-tree",
      tree,
      "-p",
      base,
      "-m",
      "feat: rewritten remote",
    ]);
    await git(human, [
      "update-ref",
      "refs/heads/synthetic-diverged",
      humanHead,
    ]);
    await git(origin, [
      "fetch",
      human,
      "refs/heads/synthetic-diverged:refs/heads/synthetic-diverged",
    ]);
    await git(origin, ["update-ref", `refs/heads/${remoteBranch}`, humanHead]);
  } else {
    await git(origin, [
      "fetch",
      human,
      `refs/heads/${remoteBranch}:refs/heads/${remoteBranch}`,
    ]);
  }
  if (pending) {
    writeFileSync(
      join(topicWorktreePath(paths), "pending.txt"),
      "pending work\n",
    );
  }
  if (ignoredConflict) {
    mkdirSync(join(topicWorktreePath(paths), ".agent-attachments"), {
      recursive: true,
    });
    writeFileSync(
      join(topicWorktreePath(paths), ".agent-attachments", "keep.txt"),
      "local data\n",
    );
  }

  const second = await runner(request({ updateIdentifier: 1002 }));

  if (ignoredConflict) {
    assert.equal(second.outcome, "failed");
    assert.equal(modelTurns, 1);
    assert.equal(github.pushes.length, 1);
    assert.equal(
      readFileSync(
        join(topicWorktreePath(paths), ".agent-attachments", "keep.txt"),
        "utf8",
      ),
      "local data\n",
    );
    return;
  }
  if (diverged) {
    assert.equal(second.outcome, "failed");
    assert.equal(modelTurns, 1);
    assert.equal(github.pushes.length, 1);
    assert.equal(
      readFileSync(join(topicWorktreePath(paths), "pending.txt"), "utf8"),
      "pending work\n",
    );
    return;
  }
  if (leaveConflict) {
    assert.equal(second.outcome, "failed");
    assert.equal(conflictTurns, 1);
    assert.equal(modelTurns, 1);
    assert.equal(github.pushes.length, 1);
    assert.equal(
      readFileSync(join(topicWorktreePath(paths), "pending.txt"), "utf8"),
      "pending work\n",
    );
    await assert.rejects(
      git(topicWorktreePath(paths), ["rev-parse", "--verify", "MERGE_HEAD"]),
    );
    return;
  }
  if (noEdit) {
    assert.equal(second.outcome, "answered", second.report);
    assert.equal(modelTurns, 2);
    assert.equal(github.pushes.length, 1);
    assert.equal(
      await git(topicWorktreePath(paths), ["rev-parse", "HEAD"]),
      humanHead,
    );
    return;
  }
  assert.equal(second.outcome, "pull_request_updated", second.report);
  if (pendingConflict) assert.equal(conflictTurns, 1);
  assert.equal(modelTurns, 2);
  assert.equal(github.pushes.length, 2);
  if (pending) {
    await git(topicWorktreePath(paths), [
      "merge-base",
      "--is-ancestor",
      humanHead,
      "HEAD",
    ]);
  } else {
    assert.equal(
      await git(topicWorktreePath(paths), ["rev-parse", "HEAD^"]),
      humanHead,
    );
  }
  assert.equal(github.pulls.at(-1).createMissing, false);
}

test("continues a bound topic after a person advances its pull request", async (context) => {
  await assertAdvancedPullRequest(context);
});

test("continues a bound topic after an update-branch merge commit", async (context) => {
  await assertAdvancedPullRequest(context, { updateBranch: true });
});

test("does not republish an advanced pull request after an unchanged turn", async (context) => {
  await assertAdvancedPullRequest(context, { noEdit: true });
});

test("never overwrites ignored work when the pull request advances", async (context) => {
  await assertAdvancedPullRequest(context, { ignoredConflict: true });
});

test("preserves pending work when the bound pull request advances", async (context) => {
  await assertAdvancedPullRequest(context, { pending: true });
});

test("resolves a pending topic conflict against the advanced pull request", async (context) => {
  await assertAdvancedPullRequest(context, {
    pending: true,
    pendingConflict: true,
  });
});

test("keeps pending topic work when the advanced pull request conflict remains", async (context) => {
  await assertAdvancedPullRequest(context, {
    pending: true,
    pendingConflict: true,
    leaveConflict: true,
  });
});

test("keeps pending work when the remote branch was rewritten", async (context) => {
  await assertAdvancedPullRequest(context, { pending: true, diverged: true });
});

test("a bound pull request that cannot be read before the push fails locally", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const github = githubStub();
  const pushBranch = github.pushBranch.bind(github);
  let remoteHead;
  github.pushBranch = async (options) => {
    const pushed = await pushBranch(options);
    remoteHead = pushed.commit;
    return pushed;
  };
  const unreadable = unreadablePullRequestRead(10);
  let reads = 0;
  github.getPullRequest = (options) => {
    reads += 1;
    // The first read is the check before the model turn; the second one is the
    // publisher's, immediately before the push.
    if (reads === 2) return unreadable(options);
    return Promise.resolve({
      state: "open",
      draft: false,
      baseRef: "main",
      headRepository: "rboixaderg/mountain-runners",
      headRef: github.pushes[0].branch,
      headSha: remoteHead,
    });
  };
  github.ensurePullRequest = async (options) => {
    github.pulls.push(options);
    return {
      pullRequest: {
        number: 200,
        htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
      },
      created: github.pulls.length === 1,
    };
  };
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      turns += 1;
      writeFileSync(join(worktreePath, "change.txt"), `change ${turns}\n`);
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  assert.equal((await runner(request())).outcome, "pull_request_created");
  reads = 0;
  const result = await runner(request({ updateIdentifier: 1002 }));

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.publicationReadFailed);
  assert.equal(github.pushes.length, 1);
  assert.equal(github.pulls.length, 1);
});

test("two implementation turns publish to the first bound pull request", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const github = githubStub();
  const pushBranch = github.pushBranch.bind(github);
  let remoteHead;
  github.pushBranch = async (options) => {
    const pushed = await pushBranch(options);
    remoteHead = pushed.commit;
    return pushed;
  };
  github.getPullRequest = async ({ number }) => {
    assert.equal(number, 200, "a named pull request cannot change the binding");
    return {
      state: "open",
      draft: false,
      baseRef: "main",
      headRepository: "rboixaderg/mountain-runners",
      headRef: github.pushes.at(-1).branch,
      headSha: remoteHead,
    };
  };
  github.ensurePullRequest = async (options) => {
    github.pulls.push(options);
    return {
      pullRequest: {
        number: 200,
        htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
      },
      created: github.pulls.length === 1,
    };
  };
  let turn = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(pngImage({ width: 200, height: 100 })),
    }),
    runModel: async ({ worktreePath, images }) => {
      turn += 1;
      writeFileSync(join(worktreePath, "change.txt"), `change ${turn}\n`);
      if (turn === 3) {
        assert.equal(images.length, 1);
        writeFileSync(
          join(worktreePath, "cover.png"),
          readFileSync(
            join(worktreePath, ".agent-attachments", "imatge-1.png"),
          ),
        );
      }
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, timedOut: false }),
  });

  assert.equal((await runner(request())).outcome, "pull_request_created");
  const binding = topicJobs.bindingOf(topicSessionKey);
  assert.deepEqual(binding, {
    branch: github.pushes[0].branch,
    pullRequestNumber: 200,
  });
  assert.equal(
    (
      await runner(
        request({
          updateIdentifier: 1002,
          instruction: "Comença una feina nova i diferent a la PR #321.",
        }),
      )
    ).outcome,
    "pull_request_updated",
  );
  assert.equal(github.pushes[1].branch, binding.branch);
  assert.equal(github.pulls[1].createMissing, false);
  assert.deepEqual(topicJobs.bindingOf(topicSessionKey), binding);

  const attachmentResult = await runner(
    attachmentRequest({ updateIdentifier: 1003 }),
  );
  assert.equal(attachmentResult.outcome, "pull_request_updated");
  assert.equal(github.pushes[2].branch, binding.branch);
  assert.equal(github.pulls[2].createMissing, false);
  assert.equal(existsSync(join(topicWorktreePath(paths), "cover.png")), true);

  const currentHead = await git(topicWorktreePath(paths), [
    "rev-parse",
    "HEAD",
  ]);
  github.getPullRequest = async () => ({
    state: "open",
    draft: false,
    baseRef: "main",
    headRepository: "rboixaderg/mountain-runners",
    headRef: "feat/agent-other-1234",
    headSha: currentHead,
  });
  const refused = await runner(request({ updateIdentifier: 1004 }));
  assert.equal(refused.outcome, "failed");
  assert.equal(turn, 3, "a different remote branch never reaches the model");
  assert.equal(github.pushes.length, 3);
  assert.deepEqual(topicJobs.bindingOf(topicSessionKey), binding);

  for (const [offset, override] of [
    { headRepository: "another-owner/fork" },
    { state: "closed" },
    { draft: true },
    { baseRef: "other" },
  ].entries()) {
    github.getPullRequest = async () => ({
      state: "open",
      draft: false,
      baseRef: "main",
      headRepository: "rboixaderg/mountain-runners",
      headRef: binding.branch,
      headSha: currentHead,
      ...override,
    });
    const rejected = await runner(request({ updateIdentifier: 1005 + offset }));
    assert.equal(rejected.outcome, "failed", JSON.stringify(override));
    assert.equal(turn, 3, "an untrusted pull request never reaches the model");
    assert.equal(github.pushes.length, 3);
  }
});

test("runs the fast gate for a web-only change and names it in the pull request", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const github = githubStub();
  const commands = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    sessionNotes: notes,
    runModel: async ({ worktreePath }) => {
      const postDirectory = join(worktreePath, "apps/web/src/content/posts");
      const componentDirectory = join(
        worktreePath,
        "apps/web/src/components/about",
      );
      mkdirSync(postDirectory, { recursive: true });
      mkdirSync(componentDirectory, { recursive: true });
      writeFileSync(join(postDirectory, "la-cursa.md"), "---\n---\n");
      writeFileSync(
        join(componentDirectory, "AboutBoard.astro"),
        "<section>synthetic</section>\n",
      );
      return {
        text: "Text corregit.\nSUMMARY: content(posts): fix three sentences",
      };
    },
    runChecks: async ({ checkCommand }) => {
      commands.push(checkCommand);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.deepEqual(commands, ["pnpm check:local"]);
  assert.match(
    github.pulls[0].body,
    /- `pnpm check:local` correcte dins l'entorn aïllat\./u,
  );
  assert.match(
    notes
      .claim(topicSessionKey)
      .map((note) => note.text)
      .join("\n"),
    /Comprovacions: pnpm check:local correcte\./u,
    "the session note names the command that ran",
  );
});

test("runs the full gate when the change also touches files outside the web app roots", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const commands = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      const postDirectory = join(worktreePath, "apps/web/src/content/posts");
      mkdirSync(postDirectory, { recursive: true });
      writeFileSync(join(postDirectory, "la-cursa.md"), "---\n---\n");
      writeFileSync(
        join(worktreePath, "apps/web/build-mode.mjs"),
        "export const synthetic = true;\n",
      );
      return {
        text: "Text corregit.\nSUMMARY: content(posts): fix three sentences",
      };
    },
    runChecks: async ({ checkCommand }) => {
      commands.push(checkCommand);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.deepEqual(commands, ["pnpm check"]);
  assert.match(github.pulls[0].body, /- `pnpm check` correcte/u);
});

test("puts the preview label on the pull request it creates and never again on an update", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Fet.\nSUMMARY: feat(content): add the news" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const created = await runner(request());
  assert.equal(created.outcome, "pull_request_created");
  assert.deepEqual(github.labelled, [200]);
  assert.doesNotMatch(created.report, /preview/u);

  github.ensurePullRequest = async () => ({
    pullRequest: {
      number: 200,
      htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
    },
    created: false,
  });
  const updated = await runner(
    request({ updateIdentifier: 1002, instruction: "afegeix-hi una data" }),
  );
  assert.equal(updated.outcome, "pull_request_updated");
  assert.deepEqual(
    github.labelled,
    [200],
    "an existing pull request is not labelled",
  );
});

test("says plainly that the preview could not be activated and keeps the publication", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  github.labelError = new Error("GitHub refused the label");
  const traces = [];
  const runner = createProjectRunner({
    recordTrace: (entry) => traces.push(entry),
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Fet.\nSUMMARY: feat(content): add the news" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.equal(result.report.split(failedMaintainerNotice).length - 1, 1);
  assert.doesNotMatch(result.report, new RegExp(savedNotice, "u"));
  assert.doesNotMatch(result.report, /GitHub refused|\/preview/u);
  assert.deepEqual(
    traces
      .filter((entry) => entry.action === "maintainer_attention")
      .map((entry) => entry.detail),
    ["previewLabelFailed"],
    "the failure notice is true: the case is recorded for the maintainer",
  );
});

test("sends the failure notice once when the label and the CI watch both fail", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  github.labelError = new Error("GitHub refused the label");
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  ciWatches.add = () => {
    throw new Error("The watch cannot be stored");
  };
  const traces = [];
  const runner = createProjectRunner({
    recordTrace: (entry) => traces.push(entry),
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    ciWatches,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Fet.\nSUMMARY: feat(content): add the news" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.report.split(failedMaintainerNotice).length - 1, 1);
  assert.doesNotMatch(result.report, new RegExp(savedNotice, "u"));
  assert.deepEqual(
    traces
      .filter((entry) => entry.action === "maintainer_attention")
      .map((entry) => entry.detail),
    ["ciWatchUnavailable", "previewLabelFailed"],
  );
});

test("sends the model answer with one plain notice and the review link after a publication", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return {
        text: "He afegit la notícia del campionat.\nSUMMARY: feat(content): add the news",
      };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.equal(
    result.report,
    [
      "He afegit la notícia del campionat.",
      "",
      savedNotice,
      "Enllaç per a revisió: https://github.com/rboixaderg/mountain-runners/pull/200",
    ].join("\n"),
  );
  assert.doesNotMatch(
    result.report,
    /SUMMARY|feat\(content\)|Branca|commit|pnpm|Validate/u,
  );
  assert.doesNotMatch(
    result.report,
    /avisar[ée]/u,
    "without a CI watch the service promises no follow-up message",
  );
});

test("registers the CI watch for the published commit without waiting for CI", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const github = githubStub();
  github.getCommitCheckRuns = () =>
    assert.fail("the instruction must not wait for CI");
  github.getCommitStatuses = () =>
    assert.fail("the instruction must not wait for CI");
  github.getPullRequest = () =>
    assert.fail("the instruction must not wait for CI");
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    ciWatches,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.match(result.report, /Canvi fet\./u);
  assert.match(result.report, new RegExp(savedNotice, "u"));
  assert.match(
    result.report,
    /Enllaç per a revisió: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/200$/u,
  );
  assert.doesNotMatch(result.report, /SUMMARY|feat\(tools\)|Branca|commit/u);
  const published = await git(topicWorktreePath(paths), ["rev-parse", "HEAD"]);
  const [watch] = ciWatches.pending();
  assert.equal(watch.commit_sha, published);
  assert.equal(watch.pull_request_number, 200);
  assert.equal(watch.session_key, request().sessionKey);
});

test("follows the preview of every commit it publishes, without a request", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const followed = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github: githubStub(),
    ciWatches,
    followPreview: (publication) => followed.push(publication),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  const published = await git(topicWorktreePath(paths), ["rev-parse", "HEAD"]);
  assert.deepEqual(followed, [
    {
      updateIdentifier: request().updateIdentifier,
      sessionKey: request().sessionKey,
      authorIdentifier: request().authorIdentifier,
      pullRequestNumber: 200,
      commit: published,
    },
  ]);
});

test("ends the instruction unknown when the CI watch cannot be registered", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    ciWatches: {
      latestPublications: () => [],
      add() {
        throw new Error("state volume full");
      },
    },
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  // The publication is real, so it is not repeated; the missing durable watch
  // blocks the service until a person reconciles it.
  assert.equal(result.outcome, "uncertain");
  assert.match(result.report, /Canvi fet\./u);
  assert.match(result.report, new RegExp(failedMaintainerNotice, "u"));
  assert.match(result.report, /pull\/200/u);
  assert.deepEqual(github.pushes.length, 1);
});

test("keeps the worktree and publishes nothing when the checks fail", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const entries = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    logger: (event, detail) => entries.push([event, detail]),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "SUMMARY: fix(tools): broken change" };
    },
    runChecks: async () => ({
      exitCode: 137,
      stdout: "private stdout",
      stderr: "private stderr",
      timedOut: false,
    }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.checksFailed);
  const [, diagnostics] = entries.find(([event]) => event === "checks_failed");
  assert.ok(
    Number.isInteger(diagnostics.durationMs) && diagnostics.durationMs >= 0,
  );
  assert.deepEqual(diagnostics, {
    reason: "nonzero_exit",
    exitCode: 137,
    signal: null,
    durationMs: diagnostics.durationMs,
  });
  assert.deepEqual(github.pushes, []);
  assert.equal(existsSync(topicWorktreePath(paths)), true);
});

test("refuses a nested repository locally without entering it and keeps the work", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const entries = [];
  const marker = join(paths.directory, "filter-ran");
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    logger: (event, detail) => entries.push([event, detail]),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      await createNestedRepository(worktreePath, marker);
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => assert.fail("A refused commit runs no checks."),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.publicationRefused);
  assert.deepEqual(
    entries.filter(([event]) =>
      ["instruction_failed", "maintainer_attention"].includes(event),
    ),
    [
      ["instruction_failed", "NestedRepositoryError"],
      ["maintainer_attention", "publicationRefused"],
    ],
  );
  assert.deepEqual(github.pushes, []);
  assert.equal(
    readFileSync(join(topicWorktreePath(paths), "change.txt"), "utf8"),
    "canvi\n",
  );
  assert.equal(existsSync(marker), false);
});

for (const scenario of [
  {
    name: "timeout",
    checkResult: {
      exitCode: -1,
      signal: "SIGKILL",
      timedOut: true,
      outputLimitExceeded: false,
    },
    expectedReport: instructionReports.checksTimedOut,
    expectedDiagnostics: {
      reason: "timeout",
      exitCode: -1,
      signal: "SIGKILL",
    },
  },
  {
    name: "output_limit",
    checkResult: {
      exitCode: -1,
      signal: "SIGKILL",
      timedOut: false,
      outputLimitExceeded: true,
    },
    expectedReport: instructionReports.checksFailed,
    expectedDiagnostics: {
      reason: "output_limit",
      exitCode: -1,
      signal: "SIGKILL",
    },
  },
  {
    name: "cancelled",
    abortDuringChecks: true,
    checkResult: {
      exitCode: -1,
      signal: "SIGKILL",
      timedOut: false,
      outputLimitExceeded: false,
    },
    expectedReport: instructionReports.checksFailed,
    expectedDiagnostics: {
      reason: "cancelled",
      exitCode: -1,
      signal: "SIGKILL",
    },
  },
]) {
  test(`logs checks_failed diagnostics for ${scenario.name}`, async (context) => {
    const paths = await fixture(context);
    const github = githubStub();
    const entries = [];
    const controller = new AbortController();
    const runner = createProjectRunner({
      config: configFor(paths),
      classifyRequest: async () => ({ kind: "implementation" }),
      github,
      logger: (event, detail) => entries.push([event, detail]),
      runModel: async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
        return { text: "SUMMARY: fix(tools): broken change" };
      },
      runChecks: async () => {
        if (scenario.abortDuringChecks) controller.abort();
        return {
          stdout: "private stdout",
          stderr: "private stderr",
          ...scenario.checkResult,
        };
      },
    });

    const result = await runner(request(), { signal: controller.signal });

    assert.equal(result.outcome, "failed");
    assert.equal(result.report, scenario.expectedReport);
    const [, diagnostics] = entries.find(
      ([event]) => event === "checks_failed",
    );
    assert.ok(
      Number.isInteger(diagnostics.durationMs) && diagnostics.durationMs >= 0,
    );
    assert.deepEqual(diagnostics, {
      ...scenario.expectedDiagnostics,
      durationMs: diagnostics.durationMs,
    });
    assert.deepEqual(github.pushes, []);
  });
}

for (const edits of [false, true]) {
  test(`fails a topic turn with a provider error ${edits ? "with" : "without"} edits and publishes nothing`, async (context) => {
    const paths = await fixture(context);
    const github = githubStub();
    const runner = createProjectRunner({
      config: configFor(paths),
      classifyRequest: async () => ({ kind: "implementation" }),
      github,
      runModel: async ({ worktreePath }) => {
        if (edits) writeFileSync(join(worktreePath, "change.txt"), "partial\n");
        return { text: "", errorMessage: "429: rate limit exceeded" };
      },
      runChecks: async () => ({ exitCode: 0, timedOut: false }),
    });

    const result = await runner(request());

    assert.equal(result.outcome, "failed");
    assert.equal(result.report, instructionReports.modelProviderFailed);
    assert.notEqual(result.report, instructionReports.clarification);
    assert.deepEqual(github.pushes, []);
  });
}

test("reports a timed-out local run as failed and keeps the work", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async () => ({ text: "", timedOut: true }),
    runChecks: async () => assert.fail("checks must not run"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.deepEqual(github.pushes, []);
  assert.equal(existsSync(topicWorktreePath(paths)), true);
});

for (const failureStage of [
  "classification",
  "model",
  "checks",
  "checks_timeout",
  "model_aborted",
  "signal",
]) {
  test(`does not mark a local ${failureStage} failure as a remote uncertainty`, async (context) => {
    const paths = await fixture(context);
    const github = githubStub();
    const controller = new AbortController();
    const runner = createProjectRunner({
      config: configFor(paths),
      github,
      classifyRequest: async () => {
        if (failureStage === "classification")
          throw new Error("Synthetic classifier failure");
        return { kind: "implementation" };
      },
      runModel: async ({ worktreePath }) => {
        if (failureStage === "model")
          throw new Error("Synthetic model failure");
        if (failureStage === "model_aborted")
          return { text: "", aborted: true };
        if (failureStage === "signal") controller.abort();
        writeFileSync(join(worktreePath, "change.txt"), "change\n");
        return { text: "SUMMARY: fix(agent): repair a local failure" };
      },
      runChecks: async () => {
        if (failureStage === "checks_timeout")
          return { exitCode: -1, timedOut: true };
        throw new Error("Synthetic checks failure");
      },
    });
    const result = await runner(request(), { signal: controller.signal });
    assert.equal(result.outcome, "failed");
    assert.deepEqual(github.pushes, []);
  });
}

test("logs the reason of a local failure for the operator", async (context) => {
  const paths = await fixture(context);
  const entries = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    logger: (event, detail) => entries.push([event, detail]),
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async () => {
      throw new Error("Synthetic model failure");
    },
    runChecks: async () => assert.fail("checks must not start"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.deepEqual(entries, [
    ["instruction_failed", "Error"],
    ["maintainer_attention", "executionFailed"],
  ]);
});

for (const diagnostics of [
  {
    reason: "premature_exit",
    exitCode: null,
    signal: "SIGKILL",
  },
  {
    reason: "output_limit",
  },
]) {
  test(`logs Pi's ${diagnostics.reason} metadata without logging the exception message`, async (context) => {
    const paths = await fixture(context);
    const entries = [];
    const runner = createProjectRunner({
      config: configFor(paths),
      github: githubStub(),
      logger: (event, detail) => entries.push([event, detail]),
      classifyRequest: async () => ({ kind: "implementation" }),
      runModel: async () => {
        throw new PiRunError("private error message", {
          ...diagnostics,
          stderr: "private transport output",
        });
      },
      runChecks: async () => assert.fail("checks must not start"),
    });

    const result = await runner(request());

    assert.equal(result.outcome, "failed");
    assert.equal(result.report, instructionReports.executionFailed);
    assert.deepEqual(entries, [
      ["pi_rpc_failed", diagnostics],
      ["maintainer_attention", "executionFailed"],
    ]);
  });
}

test("blocks after an unconfirmed sandbox stop even before publication", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async () => {
      throw new SandboxCleanupError({
        cause: new Error("Synthetic stop failure"),
      });
    },
    runChecks: async () =>
      assert.fail("checks must not start after unsafe cleanup"),
  });
  assert.equal((await runner(request())).outcome, "uncertain");
  assert.deepEqual(github.pushes, []);
});

test("runs a continuation without pending work as a writable topic turn", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const modelContexts = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "continuation" }),
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
  assert.equal(modelContexts[0].kind, "implementation");
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
  const github = githubStub();
  const kinds = [];
  let turn = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    sessionNotes: notes,
    classifyRequest: async () => ({
      kind: turn === 0 ? "implementation" : "continuation",
    }),
    runModel: async ({ worktreePath, kind }) => {
      kinds.push(kind);
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
  assert.deepEqual(kinds, ["implementation", "implementation"]);
  assert.equal(github.pulls.length, 1);
});

test("passes the configured provider credentials to the publication scanner", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const config = configFor(paths);
  config.model.providerEnvironment = {
    SYNTHETIC_PROVIDER_KEY: "synthetic-provider-secret",
  };
  const runner = createProjectRunner({
    config,
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "change\n");
      return { text: "SUMMARY: fix(agent): protect provider credentials" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });
  await runner(request());
  assert.deepEqual(github.pushes[0].secrets, [
    "telegram-secret",
    "github-secret",
    "synthetic-provider-secret",
  ]);
});

test("uses a conventional fallback when the model omits the summary", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet." };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  await runner(request());

  assert.equal(github.pulls[0].title, "feat(agent): update project");
  assert.equal(
    github.pushes[0].branch,
    `feat/agent-change-${branchSuffix(paths, 1001)}`,
  );
});

test("keeps one worktree per topic so the Pi session continues", async (context) => {
  const paths = await fixture(context);
  const seen = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github: githubStub(),
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
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github: githubStub(),
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
  // so a worktree created after the migration is opaque from the start.
  assert.equal(
    gitMarker.trim(),
    `gitdir: ${join(paths.repository, ".git", "worktrees", opaqueName)}`,
  );
});

test("continues the unpublished branch when the previous checks failed", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  let checksPass = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async ({ instruction }) => ({
      kind:
        instruction === "Continua la feina pendent."
          ? "continuation"
          : "implementation",
    }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "SUMMARY: fix(tools): repair the change" };
    },
    runChecks: async () =>
      checksPass
        ? { exitCode: 0, stdout: "", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "" },
  });

  const first = await runner(request({ updateIdentifier: 1001 }));
  checksPass = true;
  const second = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Continua la feina pendent.",
    }),
  );

  assert.equal(first.outcome, "failed");
  assert.equal(second.outcome, "pull_request_created");
  assert.equal(github.pushes.length, 1);
  assert.equal(
    github.pushes[0].branch,
    `fix/tools-repair-the-change-${branchSuffix(paths, 1001)}`,
    "the retry continues the branch of the failed instruction",
  );
});

test("starts a new branch from the latest main after a published change", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  let attempt = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      attempt += 1;
      writeFileSync(join(worktreePath, `change-${attempt}.txt`), "canvi\n");
      return { text: "" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  await runner(request({ updateIdentifier: 1001 }));

  const other = join(paths.directory, "other");
  await executeFile("git", [
    "clone",
    join(paths.directory, "origin.git"),
    other,
  ]);
  writeFileSync(join(other, "main-change.txt"), "new main\n");
  await git(other, ["add", "main-change.txt"]);
  await git(other, ["commit", "-m", "feat: new main content"]);
  await git(other, ["push", "origin", "main"]);
  const mainCommit = await git(other, ["rev-parse", "HEAD"]);

  await runner(request({ updateIdentifier: 1002 }));

  const secondBranch = github.pushes[1].branch;
  assert.equal(secondBranch, `feat/agent-change-${branchSuffix(paths, 1002)}`);
  const ancestry = await executeFile("git", [
    "-C",
    paths.repository,
    "merge-base",
    "--is-ancestor",
    mainCommit,
    secondBranch,
  ]).then(
    () => true,
    () => false,
  );
  assert.equal(ancestry, true);
});

test("reports a local publication refusal as a failure, not an unknown result", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  github.pushBranch = async () => {
    throw new PublishRefusedError(
      "The worktree file leaked.env contains a live credential.",
    );
  };
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "leaked.env"), "TOKEN=secret\n");
      return { text: "" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.publicationRefused);
  assert.deepEqual(github.pulls, []);
});

test("retries a locally refused publication without losing or duplicating the commit", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const publish = github.pushBranch.bind(github);
  let refused = false;
  github.pushBranch = async (parameters) => {
    if (!refused) {
      refused = true;
      throw new PublishRefusedError("Synthetic local refusal.");
    }
    return publish(parameters);
  };
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async ({ instruction }) => ({
      kind:
        instruction === "Torna a provar la publicació pendent."
          ? "continuation"
          : "implementation",
    }),
    runModel: async ({ worktreePath }) => {
      if (turns === 0)
        writeFileSync(
          join(worktreePath, "change.txt"),
          "preserve this change\n",
        );
      turns += 1;
      return { text: "SUMMARY: fix(agent): preserve the unpublished commit" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });
  const first = await runner(request({ updateIdentifier: 1001 }));
  const worktreePath = topicWorktreePath(paths);
  const commit = await git(worktreePath, ["rev-parse", "HEAD"]);
  const second = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Torna a provar la publicació pendent.",
    }),
  );
  assert.equal(first.outcome, "failed");
  assert.equal(second.outcome, "pull_request_created");
  assert.equal(github.pushes.length, 1);
  assert.equal(
    github.pushes[0].branch,
    `fix/agent-preserve-the-unpublished-commit-${branchSuffix(paths, 1001)}`,
  );
  assert.equal(await git(worktreePath, ["rev-parse", "HEAD"]), commit);
});

for (const operationName of ["pushBranch", "ensurePullRequest"]) {
  test(`keeps the commit unpublished when ${operationName} has an unknown remote result`, async (context) => {
    const paths = await fixture(context);
    const github = githubStub();
    const operation = github[operationName].bind(github);
    const failure = new Error(
      "Synthetic connection lost after the remote action.",
    );
    github[operationName] = async (parameters) => {
      await operation(parameters);
      throw failure;
    };
    const runner = createProjectRunner({
      config: configFor(paths),
      github,
      classifyRequest: async () => ({ kind: "implementation" }),
      runModel: async ({ worktreePath }) => {
        writeFileSync(join(worktreePath, "change.txt"), "keep this commit\n");
        return {
          text: "SUMMARY: fix(agent): preserve an uncertain publication",
        };
      },
      runChecks: async () => ({ exitCode: 0 }),
    });
    const result = await runner(request());
    assert.equal(result.outcome, "uncertain");
    assert.equal(github.pushes.length, 1);
    assert.equal(github.pulls.length, operationName === "pushBranch" ? 0 : 1);
    assert.equal(await hasUnpublishedCommit(github.pushes[0].worktree), true);
  });
}

test("keeps the instruction uncertain when the publication deadline expires after the push", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const push = github.pushBranch.bind(github);
  const pushSignals = [];
  github.pushBranch = async (parameters) => {
    pushSignals.push(parameters.signal);
    return push(parameters);
  };
  // The push reached GitHub; the pull request request then ran out of time.
  github.ensurePullRequest = async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  };
  const controller = new AbortController();
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "keep this commit\n");
      return { text: "SUMMARY: fix(agent): bound the publication" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });

  const result = await runner(request(), { signal: controller.signal });

  assert.equal(result.outcome, "uncertain");
  assert.equal(pushSignals.length, 1);
  assert.equal(pushSignals[0], controller.signal);
  assert.equal(await hasUnpublishedCommit(github.pushes[0].worktree), true);
});

/**
 * A pull request read that never answers. The instruction deadline fails it, so
 * the test proves the publisher classifies a pre-write timeout, not a defect of
 * the fake transport.
 */
function unreadablePullRequestRead(milliseconds) {
  return ({ signal }) => {
    const deadline = AbortSignal.timeout(milliseconds);
    const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
    return new Promise((resolve, reject) => {
      bounded.addEventListener("abort", () => reject(bounded.reason), {
        once: true,
      });
    });
  };
}

async function publishedWorktree(context, paths, github, ciWatches) {
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    ciWatches,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });
  await runner(request());
  return git(topicWorktreePath(paths), ["rev-parse", "HEAD"]);
}

test("classifies a request that only claims a kind it does not own", async (context) => {
  const paths = await fixture(context);
  let classified = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => {
      classified = true;
      return { kind: "consultation" };
    },
    runModel: async () => ({ text: "Resposta sintètica." }),
  });

  const result = await runner(request({ kind: "implementation" }));

  assert.equal(classified, true);
  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "Resposta sintètica.");
});

test("routes a preview request to the service without starting the model or touching a worktree", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const requests = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "preview" }),
    github,
    requestPreview: async (previewRequest) => {
      requests.push(previewRequest.updateIdentifier);
      return { outcome: "answered", report: "Preview demanada" };
    },
    runModel: async () => assert.fail("the model must not run for a preview"),
    runChecks: async () => assert.fail("checks must not run for a preview"),
  });

  const result = await runner(request());

  assert.deepEqual(result, { outcome: "answered", report: "Preview demanada" });
  assert.deepEqual(requests, [1001]);
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
  assert.equal(existsSync(join(paths.worktrees, "scratch-1001")), false);
});

test("a preview store failure reaches the runner failure report", async (context) => {
  const paths = await fixture(context);
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "preview" }),
    github: githubStub(),
    requestPreview: async () => {
      throw new Error("database is locked");
    },
    runModel: async () => assert.fail("the model must not run for a preview"),
    runChecks: async () => assert.fail("checks must not run for a preview"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
});

test("never lets the last reply of the topic turn a request into a preview", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.recordReply({
    sessionKey: topicSessionKey,
    text: "Quan vulguis, demana la preview d'aquest canvi.",
  });
  const lastReplies = [];
  const previewRequests = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async ({ context: classification }) => {
      lastReplies.push(classification.lastAgentReply);
      // A hostile last reply is the only reason this classifier sees a preview.
      return {
        kind:
          classification.lastAgentReply === null ? "consultation" : "preview",
      };
    },
    requestPreview: async (previewRequest) => {
      previewRequests.push(previewRequest.updateIdentifier);
      return { outcome: "answered", report: "Preview demanada" };
    },
    runModel: async () => ({ text: "Aquest tema encara no té cap canvi." }),
    runChecks: async () =>
      assert.fail("checks must not run for a consultation"),
  });

  const result = await runner(request({ instruction: "i ara què passa?" }));

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "Aquest tema encara no té cap canvi.");
  assert.deepEqual(
    previewRequests,
    [],
    "untrusted text never requests a preview",
  );
  assert.deepEqual(lastReplies, [
    "Quan vulguis, demana la preview d'aquest canvi.",
    null,
  ]);
});

test("routes a literal /merge command to the service before the classifier and the model", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const commands = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () =>
      assert.fail("the classifier must not see /merge"),
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

test("only contextual replies bypass the classifier for merge confirmation", async (context) => {
  const paths = await fixture(context);
  const classified = [];
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
      ...githubStub(),
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
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async ({ instruction }) => {
      classified.push(instruction);
      return { kind: "clarification" };
    },
    runModel: async () => ({ text: "Entesos." }),
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
  assert.deepEqual(classified, ["La feina està validada"]);

  const contextualValidation = await runner(
    request({
      updateIdentifier: 12,
      instruction: "La feina està validada",
      replyMessageIdentifier: 800,
    }),
  );
  assert.equal(contextualValidation.outcome, "merge_context");
  assert.equal(sentQuestions.length, 1);
  assert.deepEqual(classified, ["La feina està validada"]);

  const outOfContextConfirm = await runner(
    request({
      updateIdentifier: 13,
      instruction: "si, produccio",
      replyMessageIdentifier: 901,
    }),
  );
  assert.equal(outOfContextConfirm.report, "Entesos.");
  assert.deepEqual(classified, ["La feina està validada", "si, produccio"]);
});

test("never treats prose as a merge", async (context) => {
  const paths = await fixture(context);
  const classified = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async ({ instruction }) => {
      classified.push(instruction);
      return { kind: "clarification" };
    },
    github: githubStub(),
    requestMerge: async () => assert.fail("prose must never reach a merge"),
    runModel: async () => ({ text: "Vols que la fusioni?" }),
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
  assert.equal(classified.length, 3);
});

test("a merge store failure reaches the runner failure report", async (context) => {
  const paths = await fixture(context);
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    requestMerge: async () => {
      throw new Error("database is locked");
    },
    runModel: async () => assert.fail("the model must not run for a merge"),
    runChecks: async () => assert.fail("checks must not run for a merge"),
  });

  const result = await runner(request({ instruction: "/merge" }));

  assert.equal(result.outcome, "failed");
});

// A worktree of another topic that is changing the given paths, with or
// without a published pull request registered in the CI watches.
async function otherTopicWorktree(
  paths,
  {
    name = identifiersFor(paths).worktreeName(otherSessionKey),
    branch,
    changedPaths = ["shared.txt"],
  },
) {
  const worktree = await ensureSessionWorktree({
    repositoryPath: paths.repository,
    worktreeRoot: paths.worktrees,
    name,
  });
  await createBranch({ worktree, branch });
  for (const path of changedPaths) {
    writeFileSync(join(worktree.path, path), "other topic\n");
  }
  return worktree;
}

test("does not warn about the files of another topic's pull request", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  ciWatches.add({
    updateIdentifier: 900,
    sessionKey: "-1009999999999:3",
    pullRequestNumber: 321,
    commitSha: "a".repeat(40),
  });
  await otherTopicWorktree(paths, { branch: "feat/tools-other-change" });
  const traces = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github: githubStub(),
    ciWatches,
    recordTrace: (entry) => traces.push(entry),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "shared.txt"), "current change\n");
      return { text: "SUMMARY: feat(tools): change the shared file" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.doesNotMatch(result.report, /solapament|PR #321/u);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["instruction_classified"],
  );
});

test("never compares overlaps for a consultation", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  await otherTopicWorktree(paths, { branch: "feat/tools-other-change" });
  const traces = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "consultation" }),
    github: githubStub(),
    ciWatches,
    recordTrace: (entry) => traces.push(entry),
    runModel: async () => ({ text: "Resposta sintètica." }),
    runChecks: async () => assert.fail("checks must not run"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "Resposta sintètica.");
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["instruction_classified"],
    "a consultation compares no overlaps",
  );
});

test("never compares overlaps for a continuation without changes", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  await otherTopicWorktree(paths, { branch: "feat/tools-other-change" });
  const traces = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "continuation" }),
    github: githubStub(),
    ciWatches,
    recordTrace: (entry) => traces.push(entry),
    runModel: async () => ({ text: "No hi ha res a continuar." }),
    runChecks: async () => assert.fail("checks must not run"),
  });

  assert.equal((await runner(request())).outcome, "answered");
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["instruction_classified"],
  );
});

test("publishes a continuation without an overlap warning", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const traces = [];
  let checksPass = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    ciWatches,
    recordTrace: (entry) => traces.push(entry),
    classifyRequest: async ({ instruction }) => ({
      kind:
        instruction === "Continua la feina pendent."
          ? "continuation"
          : "implementation",
    }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "pending.txt"), "pendent\n");
      return { text: "SUMMARY: feat(tools): keep the pending work" };
    },
    runChecks: async () => (checksPass ? { exitCode: 0 } : { exitCode: 1 }),
  });
  assert.equal((await runner(request())).outcome, "failed");
  await otherTopicWorktree(paths, {
    branch: "feat/tools-other-change",
    changedPaths: ["pending.txt"],
  });

  checksPass = true;
  const result = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Continua la feina pendent.",
    }),
  );

  assert.equal(result.outcome, "pull_request_created");
  assert.doesNotMatch(result.report, /una feina local d'un altre tema/u);
  assert.deepEqual(
    traces.map((entry) => entry.action),
    [
      "instruction_classified",
      "maintainer_attention",
      "instruction_classified",
    ],
  );
});

test("keeps publishing when the overlap warning cannot be computed", async (context) => {
  const paths = await fixture(context);
  const entries = [];
  const registered = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github: githubStub(),
    ciWatches: {
      latestPublications() {
        throw new Error("Synthetic state failure");
      },
      add(watch) {
        registered.push(watch);
      },
    },
    logger: (event, detail) => entries.push([event, detail]),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "SUMMARY: feat(tools): change a file" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "pull_request_created");
  assert.match(result.report, /pull\/200/u);
  assert.doesNotMatch(result.report, /solapament/u);
  assert.deepEqual(entries, [["topic_pull_request_failed", "Error"]]);
  assert.equal(registered.length, 1);
});

test("keeps the checkpointed work unpublished when the signal aborts during checks", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const controller = new AbortController();
  const runner = createProjectRunner({
    config: configFor(paths),
    classifyRequest: async () => ({ kind: "implementation" }),
    github,
    ciWatches: {
      latestPublications() {
        return [];
      },
      add() {},
    },
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "SUMMARY: feat(tools): change a file" };
    },
    runChecks: async () => {
      controller.abort();
      return { exitCode: 0 };
    },
  });

  const result = await runner(request(), { signal: controller.signal });

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.aborted);
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
  const worktree = topicWorktreePath(paths);
  // The checkpoint keeps the work in a commit that is never pushed.
  assert.equal(
    await git(worktree, ["show", "HEAD:change.txt"]),
    "canvi",
    "the aborted instruction preserves the work",
  );
  assert.equal(await git(worktree, ["status", "--porcelain"]), "");
});

function attachmentRequest(overrides = {}) {
  return request({
    instruction: "usa la imatge adjunta a la portada",
    attachments: [
      {
        fileIdentifier: "telegram-file",
        fileUniqueIdentifier: "telegram-unique-file",
        fileName: "Portada.PNG",
        mimeType: "image/png",
        fileSize: 1200000,
        origin: "message",
      },
    ],
    ...overrides,
  });
}

function telegramAttachment(bytes) {
  return {
    async getFile() {
      return { file_id: "telegram-file", file_path: "documents/file_1.png" };
    },
    async downloadFile() {
      return bytes;
    },
  };
}

test("places an attached image and appends the service text to the instruction", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 1200, height: 800 });
  const traces = [];
  const instructions = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    recordTrace: (entry) => traces.push(entry),
    runModel: async ({ instruction, worktreePath }) => {
      instructions.push(instruction);
      // The cleaned file is available while the model works and is removed
      // before the checks and the commit.
      assert.deepEqual(
        readFileSync(join(worktreePath, ".agent-attachments", "imatge-1.png")),
        image,
      );
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet.\nSUMMARY: feat(content): use the cover" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "pull_request_created");
  const worktreePath = topicWorktreePath(paths);
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
  assert.match(instructions[0], /^usa la imatge adjunta a la portada/u);
  assert.match(instructions[0], /imatge-1\.png: 1200×800 px \(new\)/u);
  assert.match(instructions[0], /attached to this prompt as image input/u);
  assert.match(
    instructions[0],
    /belongs to the club, with the credit «Mountain Runners»/u,
  );
  assert.match(instructions[0], /view_attachment/u);
  assert.match(
    instructions[0],
    /smaller than the recommended cover \(1200×675 px\)/u,
  );
  assert.match(instructions[0], /vertical poster is used whole/u);
  assert.deepEqual(
    traces.filter((entry) => entry.action === "attachment_accepted"),
    [
      {
        updateIdentifier: 1001,
        authorIdentifier: 42,
        sessionKey: "-1001234567890:7",
        action: "attachment_accepted",
        detail: `type=png width=1200 height=800 bytes=${image.length}`,
      },
    ],
  );
  // The ignored directory never reaches the commit or the publication.
  assert.doesNotMatch(
    await git(worktreePath, ["show", "--name-only", "--format=", "HEAD"]),
    /\.agent-attachments/u,
  );
});

test("carries the audience rules, the state of the topic and the attachment lines in the same prompt", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 1200, height: 800 });
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  const mergeRequests = new MergeRequestStore(
    join(paths.state, "merge-request.sqlite"),
  );
  context.after(() => {
    mergeRequests.close();
    ciWatches.close();
  });
  // The topic already reported a green pull request before this turn.
  ciWatches.add({
    updateIdentifier: 900,
    sessionKey: topicSessionKey,
    pullRequestNumber: 239,
    commitSha: "a".repeat(40),
  });
  ciWatches.finishSend(900, "success");
  const prompts = [];
  const config = configFor(paths);
  config.github.requiredChecks = ["Validate"];
  const runner = createProjectRunner({
    config,
    github: {
      ...githubStub(),
      async getPullRequest() {
        return { state: "open", merged: false, headSha: "a".repeat(40) };
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
        return [];
      },
    },
    ciWatches,
    mergeRequests,
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    stopCommands: async () => {},
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      prompts.push(promptOf(options));
      writeFileSync(join(options.worktreePath, "change.txt"), "canvi\n");
      return { text: "Fet.\nSUMMARY: feat(content): use the cover" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.equal(prompts.length, 1);
  const audience = prompts[0].indexOf(
    "Who reads your answer and how to write it:",
  );
  const state = prompts[0].indexOf(topicStateHeader);
  const request = prompts[0].indexOf("Request:");
  const attachments = prompts[0].indexOf(
    "Images provided by the service for this topic:",
  );
  assert.ok(audience > 0, "the audience rules are present");
  assert.ok(state > audience, "the state of the topic follows the audience");
  assert.ok(
    attachments > request,
    "the attachment lines travel inside the request",
  );
  assert.match(
    prompts[0].slice(state, request),
    /^- Pull request: https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/239; open\.$/mu,
  );
  assert.match(
    prompts[0],
    /Answer in the language the person wrote in; Catalan by default\./u,
  );
  assert.match(prompts[0], /Images provided by the service for this topic:/u);
  assert.match(prompts[0], /imatge-1\.png: 1200×800 px \(new\)/u);
  assert.match(prompts[0], /view_attachment/u);
  assert.match(
    prompts[0],
    /belongs to the club, with the credit «Mountain Runners»/u,
  );
  assert.match(
    prompts[0],
    /Current instant, in Europe\/Madrid with its offset: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}\./u,
  );
});

test("passes an image to a read-only consultation with web research enabled", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 200, height: 100 });
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "consultation" }),
    research: {
      resume: async () => null,
      turn: () => ({
        withSources: (answer) => answer,
        waitingForConfirmation: () => false,
      }),
    },
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    runModel: async ({ instruction, images, kind }) => {
      assert.equal(kind, "consultation");
      assert.match(instruction, /imatge-1\.png/u);
      assert.equal(images.length, 1);
      return { text: "Resposta." };
    },
    runChecks: async () => assert.fail("checks must not run"),
  });
  const result = await runner(attachmentRequest());
  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "Resposta.");
});

test("reports a refused attachment without starting the model", async (context) => {
  const paths = await fixture(context);
  const image = jpegImage({ width: 120, height: 80 });
  const traces = [];
  let modelStarted = false;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    recordTrace: (entry) => traces.push(entry),
    runModel: async () => {
      modelStarted = true;
      return { text: "unexpected" };
    },
    runChecks: async () => assert.fail("checks must not run"),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "failed");
  assert.match(result.report, /no és la imatge que sembla/u);
  assert.equal(modelStarted, false);
  assert.equal(
    traces.some(
      (entry) =>
        entry.action === "attachment_refused" &&
        entry.detail === `reason=fake_type type=jpeg bytes=${image.length}`,
    ),
    true,
  );
  assert.equal(
    existsSync(join(topicWorktreePath(paths), ".agent-attachments")),
    false,
  );
});

test("never commits an attachment on a branch without the ignore rule", async (context) => {
  const paths = await fixture(context, { ignoreAttachments: false });
  const image = pngImage({ width: 200, height: 100 });
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    recordTrace: () => {},
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    runModel: async ({ instruction, worktreePath }) => {
      assert.match(instruction, /imatge-1\.png: 200×100 px \(new\)/u);
      assert.equal(
        existsSync(join(worktreePath, ".agent-attachments", "imatge-1.png")),
        true,
      );
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet.\nSUMMARY: feat(content): add the cover" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "pull_request_created");
  const worktreePath = topicWorktreePath(paths);
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
  const committed = await git(worktreePath, [
    "show",
    "--name-only",
    "--format=",
    "HEAD",
  ]);
  assert.match(committed, /change\.txt/u);
  assert.doesNotMatch(committed, /\.agent-attachments/u);
  assert.equal(github.pushes.length, 1);
});

test("publishes nothing when the model only asks for the image rights", async (context) => {
  const paths = await fixture(context, { ignoreAttachments: false });
  const github = githubStub();
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    recordTrace: () => {},
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(pngImage({ width: 200, height: 100 })),
    }),
    runModel: async () => ({
      text: "Quin és l'origen, els drets i el crèdit de la imatge?",
    }),
    runChecks: async () => assert.fail("checks must not run without changes"),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /origen/u);
  const worktreePath = topicWorktreePath(paths);
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
  assert.equal(await git(worktreePath, ["status", "--porcelain"]), "");
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(github.pulls, []);
});

test("continues a branch created before the ignore rule without publishing the attachment", async (context) => {
  const paths = await fixture(context, { ignoreAttachments: false });
  const image = pngImage({ width: 200, height: 100 });
  const github = githubStub();
  const first = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "pending.txt"), "canvi pendent\n");
      return { text: "Canvi.\nSUMMARY: feat(content): pending change" };
    },
    runChecks: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
  });
  const failed = await first(attachmentRequest({ attachments: [] }));

  assert.equal(failed.outcome, "failed");
  assert.deepEqual(github.pushes, []);

  const continuation = createProjectRunner({
    config: configFor(paths),
    github,
    recordTrace: () => {},
    classifyRequest: async () => ({ kind: "continuation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    runModel: async ({ instruction, worktreePath }) => {
      assert.match(instruction, /imatge-1\.png: 200×100 px \(new\)/u);
      assert.equal(
        existsSync(join(worktreePath, ".agent-attachments", "imatge-1.png")),
        true,
      );
      return { text: "No he canviat cap fitxer." };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await continuation(
    attachmentRequest({ instruction: "continua la feina pendent" }),
  );

  assert.equal(result.outcome, "pull_request_created");
  const worktreePath = topicWorktreePath(paths);
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
  const committed = await git(worktreePath, [
    "show",
    "--name-only",
    "--format=",
    "HEAD",
  ]);
  assert.match(committed, /pending\.txt/u);
  assert.doesNotMatch(committed, /\.agent-attachments/u);
  assert.equal(github.pushes.length, 1);
});

// T8.7: the conversation of a topic keeps every accepted message and receives
// the effects the service decided since its previous turn.

test("answers a clarification with one writable topic turn", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const runs = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "clarification" }),
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
  assert.equal(runs[0].readOnly, false);
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
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "clarification" }),
    runModel: async () => ({ text: "   " }),
    runChecks: async () => assert.fail("checks must not run"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, instructionReports.clarification);
});

test("gives the classifier the last reply and the pending local work", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const contexts = [];
  const instructions = [];
  let turn = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async (classification) => {
      contexts.push(classification.context);
      turn += 1;
      return { kind: turn === 1 ? "implementation" : "clarification" };
    },
    runModel: async ({ worktreePath, instruction }) => {
      instructions.push(instruction);
      if (turn === 1) {
        writeFileSync(join(worktreePath, "facts.txt"), "els fets\n");
        return { text: "SUMMARY: feat(content): add the facts" };
      }
      return { text: "Ja tinc els fets de la notícia." };
    },
    runChecks: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
  });

  const first = await runner(request());
  const second = await runner(
    request({ updateIdentifier: 1002, instruction: "aquí tens els fets" }),
  );

  assert.equal(first.outcome, "failed");
  assert.equal(second.outcome, "failed");
  assert.equal(second.report, instructionReports.checksFailed);
  assert.equal(
    instructions[1],
    "aquí tens els fets",
    "the message of the person reaches the session",
  );
  assert.deepEqual(
    contexts[0],
    { lastAgentReply: null, pendingLocalWork: false, topicPullRequest: null },
    "the first request of the topic has no context",
  );
  assert.match(
    contexts[1].lastAgentReply,
    new RegExp(failedMaintainerNotice, "u"),
    "the classifier reads the last text the topic received",
  );
  assert.equal(contexts[1].pendingLocalWork, true);
  assert.equal(contexts[1].topicPullRequest, null);
});

test("prepends the service events of the topic once and never to the classifier", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const report =
    "Pull request creada: https://github.com/rboixaderg/mountain-runners/pull/200";
  notes.addNote({ sessionKey: topicSessionKey, text: report });
  notes.addNote({ sessionKey: otherSessionKey, text: "Un altre tema." });
  const messages = [];
  const classifications = [];
  const runner = createProjectRunner({
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async (classification) => {
      classifications.push(classification);
      return { kind: "consultation" };
    },
    executeAgent: async (_config, options) => {
      messages.push(promptOf(options));
      return { text: "Resposta." };
    },
  });

  await runner(request());
  await runner(request({ updateIdentifier: 1002 }));

  assert.equal(messages.length, 2);
  assert.match(messages[0], new RegExp(serviceNotesHeader, "u"));
  assert.match(messages[0], /pull\/200/u);
  assert.doesNotMatch(messages[0], /Un altre tema/u);
  assert.ok(
    messages[0].indexOf(serviceNotesHeader) < messages[0].indexOf("Request:"),
    "the service events come before the request",
  );
  assert.doesNotMatch(
    messages[1],
    /Service events since your previous turn/u,
    "the same effect is never delivered twice",
  );
  assert.equal(
    JSON.stringify(classifications).includes(serviceNotesHeader),
    false,
    "the classifier never receives the service block",
  );
  assert.equal(
    classifications[1].instruction,
    request({ updateIdentifier: 1002 }).instruction,
    "the classifier reads the request of the person, never the service block",
  );
  assert.deepEqual(
    notes.claim(otherSessionKey).map((note) => note.text),
    ["Un altre tema."],
    "the events of another topic stay undelivered",
  );
});

test("keeps the service events of a preparation that failed", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({
    sessionKey: topicSessionKey,
    text: "Pull request creada: https://example.test/pull/200",
  });
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async () => ({ kind: "implementation" }),
    executeSandbox: async () => ({ exitCode: 1, timedOut: false }),
    executeAgent: async () => assert.fail("the model must not start"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.deepEqual(
    notes.claim(topicSessionKey).map((note) => note.text),
    [
      "Pull request creada: https://example.test/pull/200",
      instructionReports.preparationFailed,
    ],
    "a turn that never started returns its events",
  );
});

test("traces the classification of every instruction", async (context) => {
  const paths = await fixture(context);
  const traces = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    recordTrace: (entry) => traces.push(entry),
    classifyRequest: async () => ({ kind: "consultation" }),
    runModel: async () => ({ text: "Resposta." }),
  });

  await runner(request());

  assert.deepEqual(
    traces.map((entry) => [entry.action, entry.detail]),
    [["instruction_classified", "consultation"]],
  );
});

// T8.7 review round 1: the operational sequences of the pilot, the note
// lifecycle and the provenance of everything the session receives.

test("keeps the service events when the sandbox preparation runs out of time", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async () => ({ kind: "implementation" }),
    executeSandbox: async () => ({ exitCode: -1, timedOut: true }),
    executeAgent: async () => assert.fail("the model must not start"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.modelTimedOut);
  const undelivered = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    undelivered[0],
    "Efecte pendent.",
    "a turn that never started keeps the effect undelivered",
  );
  assert.equal(
    undelivered.includes(instructionReports.modelTimedOut),
    true,
    "the failure of the turn is its own effect",
  );
});

test("never returns the service events once the model received them", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const prompts = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    classifyRequest: async () => ({ kind: "consultation" }),
    executeAgent: async (_config, options) => {
      prompts.push(promptOf(options));
      throw new Error("the sandbox cleanup failed after the turn");
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.match(
    prompts[0],
    /Efecte pendent/u,
    "the prompt that reached Pi carried the effect",
  );
  const remaining = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    remaining.includes("Efecte pendent."),
    false,
    "a failure after the prompt is never a redelivery",
  );
});

test("carries the question of the model into the next turn of the same session", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const contexts = [];
  const prompts = [];
  let turn = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async ({ context: classification }) => {
      contexts.push(classification);
      turn += 1;
      return { kind: turn === 1 ? "implementation" : "continuation" };
    },
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      prompts.push({ ...options, message: promptOf(options) });
      if (turn === 1) {
        return { text: "Quins són els fets de la notícia?" };
      }
      return { text: "Gràcies, ja els tinc." };
    },
    runChecks: async () => assert.fail("the model changed no file"),
  });

  const first = await runner(request());
  const facts = "els fets són: 42 participants i 18 km";
  const second = await runner(
    request({ updateIdentifier: 1002, instruction: facts }),
  );

  assert.equal(first.outcome, "answered");
  assert.equal(first.report, "Quins són els fets de la notícia?");
  assert.equal(second.outcome, "answered");
  assert.equal(second.report, "Gràcies, ja els tinc.");
  assert.deepEqual(
    contexts[1],
    {
      lastAgentReply: "Quins són els fets de la notícia?",
      pendingLocalWork: false,
      topicPullRequest: null,
    },
    "the classifier reads the question the model asked",
  );
  assert.equal(
    prompts[0].sessionIdentifier,
    prompts[1].sessionIdentifier,
    "both turns belong to the same Pi session",
  );
  assert.match(
    prompts[1].message,
    new RegExp(facts, "u"),
    "the facts reach the model",
  );
});

test("applies the image of a continuation to the pull request of the topic", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const notes = noteStore(context, paths);
  const github = githubStub();
  const image = pngImage({ width: 1200, height: 800 });
  const classifications = [];
  const prompts = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    ciWatches,
    topicJobs,
    sessionNotes: notes,
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    hasOtherInstructions: () => false,
    classifyRequest: async ({ instruction, context: classification }) => {
      classifications.push(classification);
      return {
        kind: instruction.includes("imatge")
          ? "continuation"
          : "implementation",
      };
    },
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      prompts.push({ ...options, message: promptOf(options) });
      if (prompts.length === 1) {
        writeFileSync(join(options.worktreePath, "news.md"), "fets\n");
        return { text: "SUMMARY: content(posts): add the news" };
      }
      assert.deepEqual(
        readFileSync(
          join(options.worktreePath, ".agent-attachments", "imatge-1.png"),
        ),
        image,
        "the continuation applies the image to the same worktree",
      );
      writeFileSync(join(options.worktreePath, "cover.txt"), "portada\n");
      return { text: "SUMMARY: content(posts): use the cover" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const first = await runner(request({ instruction: "Afegeix la notícia" }));
  assert.equal(first.outcome, "pull_request_created");
  const [publication] = github.pushes;
  // The pull request the service published is open at the head it announced.
  const publishedHead = await git(topicWorktreePath(paths), [
    "rev-parse",
    "HEAD",
  ]);
  github.getPullRequest = async () => ({
    number: 200,
    state: "open",
    draft: false,
    baseRef: "main",
    headRepository: "rboixaderg/mountain-runners",
    headRef: publication.branch,
    headSha: publishedHead,
  });
  const publishCalls = [];
  github.ensurePullRequest = async (argumentsObject) => {
    publishCalls.push(argumentsObject);
    return {
      pullRequest: {
        number: 200,
        htmlUrl: "https://github.com/rboixaderg/mountain-runners/pull/200",
      },
      created: false,
    };
  };

  const second = await runner(
    attachmentRequest({
      updateIdentifier: 1002,
      instruction: "aquí tens la imatge que posarem a la notícia",
    }),
  );

  assert.equal(second.outcome, "pull_request_updated", second.report);
  assert.equal(
    classifications[1].lastAgentReply.includes(savedNotice),
    true,
    "the classifier reads the publication report",
  );
  assert.deepEqual(classifications[1].pendingLocalWork, false);
  assert.equal(classifications[1].topicPullRequest, 200);
  assert.match(prompts[1].message, new RegExp(serviceNotesHeader, "u"));
  assert.equal(
    (prompts[1].message.match(/Pull request (creada|actualitzada)/gu) ?? [])
      .length,
    1,
    "the publication note reached that turn exactly once",
  );
  assert.match(
    prompts[1].message,
    /Branca .+, commit [0-9a-f]{40}\./u,
    "the note keeps the branch and the published commit",
  );
  assert.match(
    prompts[1].message,
    /Comprovacions: pnpm check correcte\./u,
    "the note keeps the result of the local checks",
  );
  assert.ok(
    prompts[1].message.indexOf(serviceNotesHeader) <
      prompts[1].message.indexOf("Request:"),
    "the service events come before the request",
  );
  assert.deepEqual(
    github.pushes.map((push) => push.branch),
    [publication.branch, publication.branch],
  );
  assert.equal(github.pulls.length, 1, "the same pull request is updated");
  assert.equal(publishCalls.length, 1);
  assert.equal(
    publishCalls[0].createMissing,
    false,
    "the publication never opens another pull request",
  );
  const remaining = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(remaining.length, 1, "only the new publication is pending");
  assert.match(remaining[0], /Pull request actualitzada: #200 https:\/\//u);
  assert.match(remaining[0], /Branca .+, commit [0-9a-f]{40}\./u);
  assert.match(remaining[0], /Comprovacions: pnpm check correcte\./u);
  assert.doesNotMatch(
    remaining[0],
    new RegExp(savedNotice, "u"),
    "the person's plain line is not a service note",
  );
});

test("keeps the service events when the Pi profile cannot be prepared", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  // A file where the profile root belongs: the runtime fails before it claims
  // anything, so no prompt ever existed.
  writeFileSync(join(paths.state, "profiles"), "not a directory");
  const runner = createProjectRunner({
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async () => ({ kind: "consultation" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(
    notes.claim(topicSessionKey).map((note) => note.text)[0],
    "Efecte pendent.",
    "an effect is never consumed by a turn that never started",
  );
});

test("keeps the service events when the turn stops before the prompt", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const controller = new AbortController();
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    classifyRequest: async () => ({ kind: "consultation" }),
    executeAgent: async (config, options) => {
      // The stop arrives while the runtime prepares the profile: the prompt is
      // never sent.
      controller.abort();
      return runAgent(config, options);
    },
  });

  const result = await runner(request(), { signal: controller.signal });

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.aborted);
  assert.equal(
    notes.claim(topicSessionKey).map((note) => note.text)[0],
    "Efecte pendent.",
    "a stopped turn keeps the effect undelivered",
  );
});

test("keeps the service events when Pi never starts", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const config = configFor(paths);
  const runner = createProjectRunner({
    config: {
      ...config,
      model: {
        ...config.model,
        piCommand: join(paths.directory, "missing-pi"),
      },
      paths: { ...config.paths, sessions: join(paths.directory, "sessions") },
    },
    github: githubStub(),
    sessionNotes: notes,
    // The sandbox cleanup is not what this test checks: it runs no container.
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    stopCommands: async () => {},
    classifyRequest: async () => ({ kind: "consultation" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  const undelivered = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    undelivered[0],
    "Efecte pendent.",
    "a process that never started never received the prompt",
  );
  assert.equal(
    undelivered.includes(instructionReports.executionFailed),
    true,
    "the failed turn is its own effect",
  );
});

test("keeps the clarification fallback when an image turn answers nothing", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    sessionNotes: notes,
    classifyRequest: async () => ({ kind: "consultation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(pngImage({ width: 200, height: 100 })),
    }),
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async () => ({ text: "   " }),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, instructionReports.clarification);
  assert.doesNotMatch(
    result.report,
    new RegExp(attachmentReports.ignored, "u"),
  );
  assert.equal(notes.lastReply(topicSessionKey), result.report);
});

test("keeps the service events when Pi never starts and the cleanup also fails", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const config = configFor(paths);
  const runner = createProjectRunner({
    config: {
      ...config,
      model: {
        ...config.model,
        piCommand: join(paths.directory, "missing-pi"),
      },
      paths: { ...config.paths, sessions: join(paths.directory, "sessions") },
    },
    github: githubStub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    // The cleanup that runs after a failed launch also fails: the launch fact
    // must survive it.
    stopCommands: async () => {
      throw new SandboxCleanupError({ cause: new Error("podman is down") });
    },
    classifyRequest: async () => ({ kind: "consultation" }),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "uncertain");
  assert.equal(result.report, instructionReports.sandboxUncertain);
  const undelivered = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    undelivered[0],
    "Efecte pendent.",
    "no prompt reached Pi, whatever error wins after the launch",
  );
});

test("keeps the service events when the turn stops before the prompt is written", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const config = configFor(paths);
  const controller = new AbortController();
  const runner = createProjectRunner({
    config: {
      ...config,
      // A real executable: the child exists, and the prompt must still not be
      // written.
      model: { ...config.model, piCommand: process.execPath },
      paths: { ...config.paths, sessions: join(paths.directory, "sessions") },
    },
    github: githubStub(),
    sessionNotes: notes,
    stopCommands: async () => {},
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    classifyRequest: async () => ({ kind: "consultation" }),
    executeAgent: async (agentConfig, options) =>
      runAgent(agentConfig, {
        ...options,
        // The stop is queued while the prompt is built: it lands after the
        // claim and before the runtime writes the prompt.
        buildMessage: (serviceNotes) => {
          queueMicrotask(() => controller.abort());
          return options.buildMessage(serviceNotes);
        },
      }),
  });

  const result = await runner(request(), { signal: controller.signal });

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.aborted);
  assert.equal(
    notes.claim(topicSessionKey).map((note) => note.text)[0],
    "Efecte pendent.",
    "a prompt that was never written never reached Pi",
  );
});

// T8.8: the topic keeps its images and the model receives them as image input.

test("keeps listing the stored image on a later turn without a new attachment", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const prompts = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(pngImage({ width: 200, height: 100 })),
    }),
    runModel: async ({ instruction, worktreePath, images }) => {
      prompts.push({ instruction, images });
      const staged = join(worktreePath, ".agent-attachments", "imatge-1.png");
      assert.equal(
        existsSync(staged),
        true,
        "the stored image is staged again",
      );
      writeFileSync(
        join(worktreePath, `change-${prompts.length}.txt`),
        "canvi\n",
      );
      return {
        text: `Canvi.\nSUMMARY: feat(content): change ${prompts.length}`,
      };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const first = await runner(attachmentRequest());
  assert.equal(first.outcome, "pull_request_created");
  assert.equal(prompts[0].images.length, 1);

  const second = await runner(
    request({ updateIdentifier: 1002, instruction: "fes un altre canvi" }),
  );

  assert.equal(second.outcome, "pull_request_created", second.report);
  assert.match(prompts[1].instruction, /imatge-1\.png: 200×100 px/u);
  assert.doesNotMatch(
    prompts[1].instruction,
    /imatge-1\.png: 200×100 px \(new\)/u,
  );
  assert.deepEqual(
    prompts[1].images,
    [],
    "an older image is listed but not sent again as image input",
  );
});

test("reuses a stored image without another download", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const modelAttachments = [];
  const instructions = [];
  let downloads = 0;
  let turn = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({
      kind: turn === 0 ? "implementation" : "consultation",
    }),
    prepareAttachment: createAttachmentPreparation({
      telegram: {
        async getFile() {
          downloads += 1;
          return {
            file_id: "telegram-file",
            file_path: "documents/file_1.png",
          };
        },
        async downloadFile() {
          return pngImage({ width: 200, height: 100 });
        },
      },
    }),
    runModel: async ({ worktreePath, attachments, instruction }) => {
      turn += 1;
      modelAttachments.push(attachments.map((attachment) => attachment.name));
      instructions.push(instruction);
      const staged = join(worktreePath, ".agent-attachments", "imatge-1.png");
      assert.equal(existsSync(staged), true, "the stored image is staged");
      if (turn === 1) {
        writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
        return { text: "SUMMARY: feat(content): keep the stored image" };
      }
      return { text: "La imatge mostra una portada." };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const first = await runner(attachmentRequest());
  const second = await runner(
    request({ updateIdentifier: 1002, instruction: "què es veu a la imatge?" }),
  );

  assert.equal(first.outcome, "pull_request_created");
  assert.equal(second.outcome, "answered");
  assert.equal(second.report, "La imatge mostra una portada.");
  assert.equal(downloads, 1, "the stored image needs no new download");
  assert.deepEqual(modelAttachments, [["imatge-1.png"], ["imatge-1.png"]]);
  assert.match(instructions[1], /imatge-1\.png: 200×100 px/u);
  assert.match(instructions[1], /view_attachment tool and the exact name/u);
  assert.equal(
    existsSync(join(topicWorktreePath(paths), ".agent-attachments")),
    false,
    "the closed turn removes the staged copy",
  );
});

test("removes the staged image when the model fails", async (context) => {
  const paths = await fixture(context);
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(pngImage({ width: 200, height: 100 })),
    }),
    runModel: async ({ worktreePath }) => {
      assert.equal(
        existsSync(join(worktreePath, ".agent-attachments", "imatge-1.png")),
        true,
      );
      throw new Error("Synthetic model failure");
    },
    runChecks: async () => assert.fail("checks must not start"),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "failed");
  assert.equal(
    existsSync(join(topicWorktreePath(paths), ".agent-attachments")),
    false,
  );
});

test("finds the image already committed when a publication is retried", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const publish = github.pushBranch.bind(github);
  let attempts = 0;
  github.pushBranch = async (parameters) => {
    attempts += 1;
    if (attempts === 1) {
      throw new PublishRefusedError("Synthetic local refusal.");
    }
    return publish(parameters);
  };
  const store = createAttachmentStore({ stateDirectory: paths.state });
  const traces = [];
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    attachmentStore: store,
    recordTrace: (entry) => traces.push(entry),
    classifyRequest: async ({ instruction }) => ({
      kind:
        instruction === "Torna a provar la publicació pendent."
          ? "continuation"
          : "implementation",
    }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(pngImage({ width: 1200, height: 800 })),
    }),
    runModel: async ({ worktreePath }) => {
      turns += 1;
      if (turns === 1) {
        writeFileSync(
          join(worktreePath, "cover.png"),
          readFileSync(
            join(worktreePath, ".agent-attachments", "imatge-1.png"),
          ),
        );
      }
      return { text: "SUMMARY: feat(content): publish the cover" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });

  const first = await runner(attachmentRequest());
  const topicName = basename(topicWorktreePath(paths));
  assert.equal(first.outcome, "failed");
  assert.deepEqual(
    traces.filter((entry) => entry.action === "attachment_used"),
    [],
    "a refused publication never marks the image as used",
  );
  assert.equal(store.list(topicName).length, 1);

  const second = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Torna a provar la publicació pendent.",
    }),
  );

  assert.equal(second.outcome, "pull_request_created");
  assert.deepEqual(
    traces
      .filter((entry) => entry.action === "attachment_used")
      .map((entry) => entry.detail),
    ["imatge-1.png"],
    "the retry finds the image in origin/main..HEAD",
  );
  assert.deepEqual(store.list(topicName), []);
});

test("sends the prepared image of the turn as image input of the prompt", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 1200, height: 800 });
  let receivedImages = null;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    runModel: async ({ images, worktreePath }) => {
      receivedImages = images;
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi.\nSUMMARY: feat(content): use the image" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "pull_request_created");
  assert.equal(receivedImages.length, 1);
  assert.equal(receivedImages[0].type, "image");
  assert.equal(receivedImages[0].mimeType, "image/png");
  assert.deepEqual(Buffer.from(receivedImages[0].data, "base64"), image);
});

test("stores the downscaled image that the sandbox returned", async (context) => {
  const paths = await fixture(context);
  const original = pngImage({ width: 3000, height: 2000 });
  const downscaled = pngImage({ width: 2400, height: 1600 });
  const scaledInputs = [];
  let prompt = null;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(original),
    }),
    scaleAttachments: async ({ images }) => {
      scaledInputs.push(...images);
      return {
        images: [
          { ...images[0], bytes: downscaled, width: 2400, height: 1600 },
        ],
      };
    },
    runModel: async ({ instruction, images, worktreePath }) => {
      prompt = { instruction, images };
      const staged = readFileSync(
        join(worktreePath, ".agent-attachments", "imatge-1.png"),
      );
      assert.deepEqual(staged, downscaled);
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi.\nSUMMARY: feat(content): use the image" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "pull_request_created");
  assert.equal(scaledInputs.length, 1);
  assert.equal(scaledInputs[0].width, 3000);
  assert.match(prompt.instruction, /imatge-1\.png: 2400×1600 px/u);
  assert.deepEqual(Buffer.from(prompt.images[0].data, "base64"), downscaled);
});

test("skips the runtime preparation when the sandbox already installed the worktree", async (context) => {
  const paths = await fixture(context);
  const original = pngImage({ width: 3000, height: 2000 });
  const downscaled = pngImage({ width: 2400, height: 1600 });
  const sandboxCommands = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(original),
    }),
    scaleAttachments: async ({ images }) => ({
      images: [{ ...images[0], bytes: downscaled, width: 2400, height: 1600 }],
    }),
    executeSandbox: async ({ command }) => {
      sandboxCommands.push(command);
      return { exitCode: 0, timedOut: false };
    },
    executeAgent: async () => ({ text: "No he canviat cap fitxer." }),
    runChecks: async () => assert.fail("no checks without changes"),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "answered");
  assert.deepEqual(
    sandboxCommands,
    [],
    "the downscale already ran the offline install",
  );
});

test("logs a post-publication store failure without changing the result", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 200, height: 100 });
  const store = createAttachmentStore({ stateDirectory: paths.state });
  const events = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    attachmentStore: {
      ...store,
      remove: () => {
        throw new Error("synthetic manifest failure");
      },
    },
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    logger: (event) => events.push(event),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "cover.png"), image);
      return { text: "Canvi.\nSUMMARY: feat(content): use the cover" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const result = await runner(attachmentRequest());

  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.deepEqual(events, ["attachment_store_failed"]);
});

test("omits the image that does not fit the prompt byte budget and names it", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 800, height: 600, filler: 4_500_000 });
  let prompt = null;
  const runner = createProjectRunner({
    config: configFor(paths),
    github: githubStub(),
    classifyRequest: async () => ({ kind: "implementation" }),
    prepareAttachment: createAttachmentPreparation({
      telegram: {
        async getFile({ fileIdentifier }) {
          return { file_id: fileIdentifier, file_path: "documents/file.png" };
        },
        async downloadFile() {
          return image;
        },
      },
    }),
    // The sandbox downscale keeps this fixture as it is: the test is about the
    // prompt byte budget, not about re-encoding.
    scaleAttachments: async ({ images }) => ({ images }),
    runModel: async ({ instruction, images, worktreePath }) => {
      prompt = { instruction, images };
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi.\nSUMMARY: feat(content): use the images" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });
  const attachment = (fileIdentifier) => ({
    fileIdentifier,
    fileUniqueIdentifier: `${fileIdentifier}-unique`,
    fileName: "portada.png",
    mimeType: "image/png",
    fileSize: image.length,
    origin: "message",
  });

  const result = await runner(
    request({
      instruction: "usa les imatges adjuntes",
      attachments: [attachment("first"), attachment("second")],
    }),
  );

  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.equal(prompt.images.length, 1);
  assert.match(prompt.instruction, /too large to send as image input/u);
  assert.match(prompt.instruction, /imatge-2\.png/u);
});

async function advanceMain(paths, path, content) {
  writeFileSync(join(paths.repository, path), content);
  await git(paths.repository, ["add", path]);
  await git(paths.repository, ["commit", "-m", `chore: advance ${path}`]);
  await git(join(paths.directory, "origin.git"), [
    "fetch",
    paths.repository,
    "+refs/heads/main:refs/heads/main",
  ]);
  return git(paths.repository, ["rev-parse", "HEAD"]);
}

// One ordinary turn whose model leaves `change.txt` uncommitted while `main`
// advances with `main-change.txt`. The gate records what it saw.
async function runStaleTurn(
  context,
  { advance = true, gate, onWorktree = () => {} } = {},
) {
  const paths = await fixture(context);
  const github = githubStub();
  const gates = [];
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "topic change\n");
      if (advance) await advanceMain(paths, "main-change.txt", "main\n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async ({ worktreePath, checkCommand }) => {
      onWorktree(worktreePath);
      gates.push({
        checkCommand,
        hasMain: existsSync(join(worktreePath, "main-change.txt")),
      });
      return gate ? gate(gates.length) : { exitCode: 0 };
    },
  });
  const result = await runner(request());
  return { paths, github, gates, result };
}

test("an ordinary turn passes the gate only after incorporating main into its uncommitted work", async (context) => {
  const { paths, github, gates, result } = await runStaleTurn(context);
  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.deepEqual(
    gates.map(({ hasMain }) => hasMain),
    [true],
  );
  const worktree = topicWorktreePath(paths);
  assert.equal(
    (await git(worktree, ["log", "-1", "--format=%P"])).split(" ").length,
    2,
  );
  assert.equal(await git(worktree, ["status", "--porcelain"]), "");
  assert.equal(
    github.pushes[0].validated.base,
    await git(paths.repository, ["rev-parse", "origin/main"]),
  );
  assert.equal(
    github.pushes[0].validated.commit,
    await git(worktree, ["rev-parse", "HEAD"]),
  );
});

test("an ordinary turn on an up-to-date branch adds no merge commit and gates once", async (context) => {
  const { paths, gates, result } = await runStaleTurn(context, {
    advance: false,
  });
  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.equal(gates.length, 1);
  const parents = await git(topicWorktreePath(paths), [
    "log",
    "-1",
    "--format=%P",
  ]);
  assert.equal(parents.split(" ").length, 1);
});

test("the gate is chosen from the verified main and a non-content change keeps the full gate", async (context) => {
  const { gates, result } = await runStaleTurn(context);
  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.deepEqual(
    gates.map(({ checkCommand }) => checkCommand),
    ["pnpm check"],
  );
});

test("a failing gate after synchronization keeps the merged work and publishes nothing", async (context) => {
  const { paths, github, result } = await runStaleTurn(context, {
    gate: () => ({ exitCode: 1 }),
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(github.pushes, []);
  const worktree = topicWorktreePath(paths);
  assert.equal(
    readFileSync(join(worktree, "change.txt"), "utf8"),
    "topic change\n",
  );
  assert.equal(
    readFileSync(join(worktree, "main-change.txt"), "utf8"),
    "main\n",
  );
});

test("a gate that changes the worktree is not published", async (context) => {
  let worktreePath;
  const { github, result } = await runStaleTurn(context, {
    gate: () => {
      writeFileSync(join(worktreePath, "gate.txt"), "x\n");
      return { exitCode: 0 };
    },
    onWorktree: (path) => {
      worktreePath = path;
    },
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(github.pushes, []);
});

test("an ordinary turn synchronizes again when the publisher finds a newer main", async (context) => {
  const paths = await fixture(context);
  const github = githubStub();
  const push = github.pushBranch.bind(github);
  let attempts = 0;
  let gates = 0;
  github.pushBranch = async (options) => {
    attempts += 1;
    if (attempts === 1) {
      await advanceMain(paths, "later.txt", "later\n");
      throw new PublicationBaseChangedError("advanced");
    }
    return push(options);
  };
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "topic change\n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => {
      gates += 1;
      return { exitCode: 0 };
    },
  });
  const result = await runner(request());
  assert.equal(result.outcome, "pull_request_created", result.report);
  assert.equal(attempts, 2);
  assert.equal(gates, 2);
  assert.equal(
    github.pushes[0].validated.base,
    await git(paths.repository, ["rev-parse", "origin/main"]),
  );
});

async function conflictTurn(context, resolution) {
  const paths = await fixture(context);
  const github = githubStub();
  let turns = 0;
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath }) => {
      turns += 1;
      if (turns === 2) {
        return resolution(worktreePath);
      }
      writeFileSync(join(worktreePath, "README.md"), "topic change\n");
      await advanceMain(paths, "README.md", "main change\n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });
  const result = await runner(request());
  return { paths, github, result };
}

test("a conflict resolution that edits a path outside the conflict is rolled back", async (context) => {
  const { paths, github, result } = await conflictTurn(
    context,
    (worktreePath) => {
      writeFileSync(
        join(worktreePath, "README.md"),
        "main change\ntopic change\n",
      );
      writeFileSync(join(worktreePath, "stray.txt"), "outside\n");
      return { text: "Fet.\nCONFLICT_RESOLVED" };
    },
  );
  assert.equal(result.outcome, "failed");
  assert.deepEqual(github.pushes, []);
  const worktree = topicWorktreePath(paths);
  await assert.rejects(git(worktree, ["rev-parse", "--verify", "MERGE_HEAD"]));
  assert.equal(
    readFileSync(join(worktree, "README.md"), "utf8"),
    "topic change\n",
  );
});

test("a conflict turn with a provider error is an unresolved conflict", async (context) => {
  const { paths, github, result } = await conflictTurn(
    context,
    (worktreePath) => {
      writeFileSync(
        join(worktreePath, "README.md"),
        "main change\ntopic change\n",
      );
      return { text: "Fet.\nCONFLICT_RESOLVED", errorMessage: "401: invalid" };
    },
  );
  assert.equal(result.outcome, "failed");
  assert.deepEqual(github.pushes, []);
  const worktree = topicWorktreePath(paths);
  await assert.rejects(git(worktree, ["rev-parse", "--verify", "MERGE_HEAD"]));
  assert.equal(
    readFileSync(join(worktree, "README.md"), "utf8"),
    "topic change\n",
  );
});

test("a timed out conflict turn leaves no new untracked file behind", async (context) => {
  const { paths, github, result } = await conflictTurn(
    context,
    (worktreePath) => {
      writeFileSync(join(worktreePath, "stray.txt"), "outside\n");
      return { timedOut: true };
    },
  );
  assert.equal(result.outcome, "failed");
  assert.deepEqual(github.pushes, []);
  const worktree = topicWorktreePath(paths);
  assert.equal(existsSync(join(worktree, "stray.txt")), false);
  assert.equal(await git(worktree, ["status", "--porcelain"]), "");
});

test("a conflict resolution that creates a nested repository is refused locally and removed", async (context) => {
  const marker = join(tmpdir(), `nested-marker-${process.pid}-${Date.now()}`);
  const { paths, github, result } = await conflictTurn(
    context,
    async (worktreePath) => {
      writeFileSync(
        join(worktreePath, "README.md"),
        "main change\ntopic change\n",
      );
      await createNestedRepository(worktreePath, marker);
      return { text: "Fet.\nCONFLICT_RESOLVED" };
    },
  );
  context.after(() => rmSync(marker, { force: true }));
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.publicationRefused);
  assert.deepEqual(github.pushes, []);
  const worktree = topicWorktreePath(paths);
  assert.equal(existsSync(join(worktree, "nested")), false);
  assert.equal(existsSync(marker), false);
  await assert.rejects(git(worktree, ["rev-parse", "--verify", "MERGE_HEAD"]));
});

test("markers removed without the explicit resolved line stop on the model question", async (context) => {
  const { github, result } = await conflictTurn(context, (worktreePath) => {
    writeFileSync(join(worktreePath, "README.md"), "topic change\n");
    return { text: "Quina versió prefereixes?" };
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, "Quina versió prefereixes?");
  assert.deepEqual(github.pushes, []);
});

// A bound topic whose pull request head is published on the fixture origin.
async function boundTopic(context) {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const origin = join(paths.directory, "origin.git");
  const github = githubStub();
  let remoteBranch;
  github.pushBranch = async ({ worktree, branch, onPublicationStarted }) => {
    onPublicationStarted?.();
    remoteBranch = branch;
    const commit = await git(worktree.path, ["rev-parse", "HEAD"]);
    await git(origin, [
      "fetch",
      worktree.path,
      `refs/heads/${branch}:refs/heads/${branch}`,
    ]);
    github.pushes.push({ branch, commit });
    return { branch, commit };
  };
  const readPullRequest = async () => ({
    state: "open",
    draft: false,
    baseRef: "main",
    headRepository: "rboixaderg/mountain-runners",
    headRef: remoteBranch,
    headSha: await git(origin, ["rev-parse", `refs/heads/${remoteBranch}`]),
    previewLabeled: true,
    previewRevoked: false,
  });
  github.getPullRequest = readPullRequest;
  github.ensurePullRequest = async () => ({
    pullRequest: { number: 200, ...(await readPullRequest()) },
    created: github.pulls.push(true) === 1,
  });
  const gates = [];
  const previews = [];
  const followUp = { result: undefined };
  const runner = createProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    classifyRequest: async () => ({ kind: "implementation" }),
    runModel: async ({ worktreePath, instruction }) => {
      assert.doesNotMatch(instruction, /sincronitza/iu);
      writeFileSync(join(worktreePath, "topic.txt"), "topic\n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async ({ checkCommand }) => {
      gates.push(checkCommand);
      return { exitCode: 0 };
    },
    followPreview: (options) => {
      previews.push(options);
      return followUp.result;
    },
  });
  assert.equal((await runner(request())).outcome, "pull_request_created");
  const commit = await git(origin, ["rev-parse", `refs/heads/${remoteBranch}`]);
  gates.length = 0;
  previews.length = 0;
  github.pushes.length = 0;
  return {
    paths,
    github,
    runner,
    gates,
    previews,
    followUp,
    target: { pullRequestNumber: 200, commit, branch: remoteBranch },
  };
}

const mergeRequest = () => request({ updateIdentifier: 2002 });

test("merge synchronization of an up-to-date branch fails closed without gate or push", async (context) => {
  const { runner, github, gates, target } = await boundTopic(context);
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "up_to_date");
  assert.match(result.report, /No he publicat res a producció/u);
  assert.deepEqual(gates, []);
  assert.deepEqual(github.pushes, []);
});

test("merge synchronization publishes against current main after it advances past the PR's original base", async (context) => {
  const { paths, runner, github, gates, previews, target } =
    await boundTopic(context);
  const mainSha = await advanceMain(paths, "main-change.txt", "main\n");
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "synchronized", result.report);
  assert.match(result.report, /T'avisaré quan puguis revisar la preview nova/u);
  assert.equal(result.mainHead, mainSha);
  assert.notEqual(result.commit, target.commit);
  assert.equal(gates.length, 1);
  assert.equal(github.pushes.length, 1);
  const parents = await git(topicWorktreePath(paths), [
    "log",
    "-1",
    "--format=%P",
  ]);
  assert.deepEqual(parents.split(" "), [target.commit, mainSha]);
  assert.equal(previews[0].mergeSynchronization, true);
  assert.equal(previews[0].commit, result.commit);
});

test("merge synchronization refuses a moved head or branch without mutating", async (context) => {
  const { paths, runner, github, gates, target } = await boundTopic(context);
  await advanceMain(paths, "main-change.txt", "main\n");
  const worktree = topicWorktreePath(paths);
  const headBefore = await git(worktree, ["rev-parse", "HEAD"]);
  for (const changed of [
    { commit: "a".repeat(40) },
    { branch: "feat/other" },
  ]) {
    const result = await runner.synchronizeForMerge(mergeRequest(), {
      ...target,
      ...changed,
    });
    assert.equal(result.outcome, "failed");
    assert.equal(typeof result.report, "string");
  }
  assert.deepEqual(github.pushes, []);
  assert.deepEqual(gates, []);
  assert.equal(await git(worktree, ["rev-parse", "HEAD"]), headBefore);
});

test("merge synchronization is uncertain when the preview follow-up is not stored", async (context) => {
  const { paths, runner, followUp, target } = await boundTopic(context);
  followUp.result = false;
  await advanceMain(paths, "main-change.txt", "main\n");
  const result = await runner.synchronizeForMerge(mergeRequest(), target);
  assert.equal(result.outcome, "uncertain");
  assert.match(result.report, /no he pogut confirmar la preview/u);
});
