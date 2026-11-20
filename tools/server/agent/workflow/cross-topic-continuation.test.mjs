import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../repository/merge-request-store.mjs";
import { PreviewRequestStore } from "../repository/preview-request-store.mjs";
import { SessionNoteStore } from "../repository/session-note-store.mjs";
import { requestSignal } from "../repository/request-signal.mjs";
import { instructionReports } from "../policy/development.mjs";
import { createProjectRunner } from "./project-runner.mjs";
import { openIdentifierNames } from "../repository/identifiers.mjs";

const executeFile = promisify(execFile);
const repository = "rboixaderg/mountain-runners";
const topicA = "-1001234567890:7";
const topicB = "-1001234567890:8";
const pullRequestNumber = 200;
// The published branch of the fixture: the service derives its suffix from the
// installation salt, so the test asks for the same name the runner will use.
function changeBranchOf(paths) {
  return `feat/tools-shared-change-${openIdentifierNames(paths.state).changeSuffix(1001)}`;
}
const changeSummary = "SUMMARY: feat(tools): shared change";

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

async function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-continuation-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const origin = join(directory, "origin.git");
  const clone = join(directory, "repository");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, clone]);
  writeFileSync(join(clone, "README.md"), "synthetic\n");
  await git(clone, ["add", "README.md"]);
  await git(clone, ["commit", "-m", "chore: initial"]);
  await git(clone, ["push", "origin", "main"]);

  return {
    directory: realpathSync(directory),
    origin: realpathSync(origin),
    repository: realpathSync(clone),
    worktrees: join(directory, "worktrees"),
    state: join(directory, "state"),
  };
}

function configFor(paths) {
  return {
    telegram: { botToken: "telegram-secret" },
    github: {
      token: "github-secret",
      repository,
      requiredChecks: ["Validate"],
    },
    model: {
      sandboxImage: "mountain-agent-pi:1.5.0",
      providerEnvironmentVariables: [],
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

/** The opaque worktree the runner uses: it reads the salt of the same state. */
function worktreeOf(paths, sessionKey) {
  return join(
    paths.worktrees,
    openIdentifierNames(paths.state).worktreeName(sessionKey),
  );
}

function archiveOf(paths, sessionKey, updateIdentifier) {
  const names = openIdentifierNames(paths.state);
  return join(
    paths.worktrees,
    names.archiveName(names.worktreeName(sessionKey), updateIdentifier),
  );
}

function request(overrides = {}) {
  return {
    updateIdentifier: 1001,
    messageIdentifier: 2001,
    sessionKey: topicA,
    authorIdentifier: 42,
    instruction: "fes un canvi sintètic",
    ...overrides,
  };
}

/** The trusted GitHub component, replaced by the same observable behaviour. */
function githubStub({ origin, state }) {
  const stub = {
    pushes: [],
    created: [],
    openedBranches: [],
    reused: [],
    comments: [],
    pullRequestReads: 0,
    pull: { number: pullRequestNumber, branch: changeBranchOf({ state }) },
    async getPullRequest({ number }) {
      stub.pullRequestReads += 1;
      assert.equal(number, stub.pull.number);
      const branch = stub.pull.headRef ?? stub.pull.branch;
      return {
        state: stub.pull.state ?? "open",
        draft: stub.pull.draft ?? false,
        merged: false,
        baseRef: stub.pull.baseRef ?? "main",
        headRepository: stub.pull.headRepository ?? repository,
        headRef: branch,
        headSha:
          stub.pull.headSha ??
          (await git(origin, ["rev-parse", `refs/heads/${branch}`])),
        mergeableState: "clean",
        mergeCommitSha: null,
      };
    },
    async pushBranch({ worktree, branch }) {
      const commit = await git(worktree.path, ["rev-parse", "HEAD"]);
      await git(worktree.path, ["push", "origin", `HEAD:refs/heads/${branch}`]);
      stub.pushes.push({ branch, commit });
      return { branch, commit };
    },
    async ensurePullRequest({ branch, title, body, createMissing = true }) {
      const pullRequest = {
        number: stub.pull.number,
        htmlUrl: `https://github.com/${repository}/pull/${stub.pull.number}`,
      };
      if (!createMissing) {
        stub.reused.push({ branch, title, body });
        return { pullRequest, created: false };
      }
      if (stub.openedBranches.includes(branch)) {
        return { pullRequest, created: false };
      }
      stub.openedBranches.push(branch);
      stub.created.push({ branch, title, body });
      return { pullRequest, created: true };
    },
    async listIssueComments() {
      return stub.comments;
    },
  };
  return stub;
}

function runnerFor({
  paths,
  github,
  ciWatches,
  previewRequests,
  mergeRequests,
  classifyRequest,
  runModel,
  runChecks = async () => ({ exitCode: 0 }),
  notifyHandover = async () => {},
  hasOtherInstructions = () => false,
  sessionNotes,
  traces,
  readCiState = async () => ({ state: "failure", failed: ["Validate"] }),
}) {
  return createProjectRunner({
    config: configFor(paths),
    github,
    ciWatches,
    previewRequests,
    mergeRequests,
    classifyRequest,
    runModel,
    runChecks,
    readCiState,
    hasOtherInstructions,
    notifyHandover,
    sessionNotes,
    recordTrace: (entry) => traces?.push(entry),
    logger: () => {},
  });
}

/** Publish one change from topic A, then deliver its CI notice. */
async function publishFromTopicA({ paths, github, ciWatches }) {
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    classifyRequest: async () => "implementation",
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: `Canvi fet.\n${changeSummary}` };
    },
  });
  const result = await runner(request());
  assert.equal(result.outcome, "pull_request_created");
  const [watch] = ciWatches.pending();
  assert.equal(ciWatches.beginSend(watch.update_identifier, "failure"), true);
  assert.equal(ciWatches.finishSend(watch.update_identifier), true);
  return { result, head: github.pushes[0].commit };
}

function stateStore(paths) {
  mkdirSync(paths.state, { recursive: true });
  return new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
}

/** The workflow traces of a run, without the classification of each request. */
function workflowTraces(traces) {
  return traces.filter((entry) => entry.action !== "instruction_classified");
}

test("continues another topic's pull request and updates it without opening another", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const previewRequests = new PreviewRequestStore(
    join(paths.state, "preview-request.sqlite"),
  );
  const mergeRequests = new MergeRequestStore(
    join(paths.state, "merge-request.sqlite"),
  );
  context.after(() => {
    mergeRequests.close();
    previewRequests.close();
  });
  const notices = [];
  const traces = [];
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  const directory = mkdtempSync(join(tmpdir(), "mr-continuation-note-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  github.comments = [
    { user: { login: "someone" }, body: "Revisa el lint abans de continuar." },
  ];

  const modelCalls = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    previewRequests,
    mergeRequests,
    traces,
    sessionNotes: notes,
    classifyRequest: async () => "continuation",
    notifyHandover: async (notice) => notices.push(notice),
    runModel: async (modelRequest) => {
      modelCalls.push(modelRequest);
      writeFileSync(join(modelRequest.worktreePath, "second.txt"), "segon\n");
      return {
        text: "Continuat.\nSUMMARY: fix(tools): finish the shared change",
      };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200 i arregla el lint",
    }),
  );

  assert.equal(result.outcome, "pull_request_updated");
  assert.match(result.report, /Continuo la proposta #200/u);
  assert.match(result.report, /El canvi està publicat i l'estic comprovant/u);
  assert.doesNotMatch(result.report, new RegExp(head.slice(0, 7), "u"));
  // The note the next turn receives keeps the facts of the publication: the
  // number, the branch, the published commit and the result of the local checks.
  const [{ text: publicationNote }] = notes.claim(topicB);
  assert.match(
    publicationNote,
    /Pull request actualitzada: #200 https:\/\//u,
    "the note keeps the pull request number",
  );
  assert.match(
    publicationNote,
    /Branca feat\/tools-shared-change-\w+, commit [0-9a-f]{40}\./u,
    "the note keeps the branch and the published commit",
  );
  assert.match(publicationNote, /Comprovacions: pnpm check correcte\./u);
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].kind, "continuation");
  assert.match(modelCalls[0].instruction, /pull request #200/u);
  assert.match(modelCalls[0].instruction, /untrusted data/u);
  assert.match(modelCalls[0].instruction, /Revisa el lint/u);
  assert.match(modelCalls[0].instruction, /Failing required checks: Validate/u);
  // The turn works on another topic's pull request: the state block describes
  // that pull request and the facts of the topic that still owns it.
  assert.deepEqual(modelCalls[0].topicState.pullRequest, {
    url: `https://github.com/${repository}/pull/${pullRequestNumber}`,
    fromAnotherTopic: true,
    isClosed: false,
    isMerged: false,
  });
  assert.deepEqual(modelCalls[0].topicState.lastReported, {
    commit: head,
    description: "failed",
  });
  assert.equal(github.pushes.length, 2);
  assert.equal(github.pushes[1].branch, changeBranchOf(paths));
  assert.equal(github.created.length, 1, "the continuation never opens a PR");
  assert.equal(github.reused.length, 1);
  assert.equal(github.reused[0].branch, changeBranchOf(paths));
  assert.match(github.reused[0].body, /second\.txt/u);
  assert.equal(
    await git(worktreeOf(paths, topicB), ["rev-parse", "HEAD~1"]),
    head,
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].sessionKey, topicA);
  assert.equal(notices[0].pullRequestNumber, pullRequestNumber);
  assert.equal(
    ciWatches.latestPublication(pullRequestNumber).session_key,
    topicB,
  );
  const [pending] = ciWatches.pending();
  assert.equal(pending.session_key, topicB);
  assert.equal(pending.update_identifier, 1002);
  assert.equal(pending.commit_sha, github.pushes[1].commit);
  assert.notEqual(pending.commit_sha, head);
  const continuationTraces = traces.filter((entry) =>
    entry.action.startsWith("continuation_"),
  );
  assert.deepEqual(
    continuationTraces.map((entry) => [entry.action, entry.detail]),
    [
      ["continuation_resumed", `#200 ${head.slice(0, 7)}`],
      [
        "continuation_handover_notified",
        `#200 ${github.pushes[1].commit.slice(0, 7)}`,
      ],
    ],
  );
  assert.equal(continuationTraces[0].sessionKey, topicB);
});

test("a continued pull request that cannot be read before the push fails locally", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const traces = [];
  await publishFromTopicA({ paths, github, ciWatches });
  const readPullRequest = github.getPullRequest.bind(github);
  github.getPullRequest = (parameters) => {
    // The continuation has read the pull request once already. The second read
    // is the publisher's, immediately before the push.
    if (github.pullRequestReads === 1) {
      const deadline = AbortSignal.timeout(10);
      const bounded = parameters.signal
        ? AbortSignal.any([parameters.signal, deadline])
        : deadline;
      return new Promise((resolve, reject) => {
        bounded.addEventListener("abort", () => reject(bounded.reason), {
          once: true,
        });
      });
    }
    return readPullRequest(parameters);
  };
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces,
    classifyRequest: async () => "continuation",
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "second.txt"), "segon\n");
      return { text: "SUMMARY: fix(tools): finish the shared change" };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  // Nothing reached GitHub, so the continuation is a local failure and the
  // queue keeps running.
  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.publicationReadFailed);
  assert.equal(github.pullRequestReads, 1);
  assert.equal(github.pushes.length, 1);
  assert.deepEqual(github.reused, []);
  // The topic resumed the branch but never published: the owner does not move
  // and the previous topic receives no handover notice.
  assert.deepEqual(
    traces
      .filter((entry) => entry.action.startsWith("continuation_"))
      .map((entry) => entry.action),
    ["continuation_resumed"],
  );
  assert.equal(
    ciWatches.latestPublication(pullRequestNumber).session_key,
    topicA,
  );
});

for (const scenario of [
  {
    name: "a closed pull request",
    pull: { state: "closed" },
    report: /ja no està oberta/u,
    reason: "not_open",
  },
  {
    name: "a draft pull request",
    pull: { draft: true },
    report: /és un esborrany/u,
    reason: "draft",
  },
  {
    name: "another base branch",
    pull: { baseRef: "develop" },
    report: /no apunta a la branca principal del projecte/u,
    reason: "not_main_base",
  },
  {
    name: "a fork",
    pull: { headRepository: "someone/mountain-runners" },
    report: /no és d'aquest projecte/u,
    reason: "not_main_repository",
  },
  {
    name: "a branch the service never writes",
    pull: { headRef: "main" },
    report: /no és d'una feina d'aquest servei/u,
    reason: "not_work_branch",
  },
  {
    name: "a pull request of another number",
    pull: { number: pullRequestNumber + 1 },
    report: /no la va preparar aquest servei/u,
    reason: "not_published_by_service",
  },
]) {
  test(`refuses ${scenario.name} without touching the worktree`, async (context) => {
    const paths = await fixture(context);
    const github = githubStub(paths);
    const ciWatches = stateStore(paths);
    context.after(() => ciWatches.close());
    await publishFromTopicA({ paths, github, ciWatches });
    Object.assign(github.pull, scenario.pull);
    const changeBranch = changeBranchOf(paths);
    const headRef = scenario.pull.headRef ?? changeBranch;
    const headSha = await git(paths.origin, [
      "rev-parse",
      `refs/heads/${headRef}`,
    ]);
    const traces = [];
    const runner = runnerFor({
      paths,
      github,
      ciWatches,
      traces,
      classifyRequest: async () => "continuation",
      notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
      runModel: async () => assert.fail("the model must not run"),
      runChecks: async () => assert.fail("checks must not run"),
    });

    const result = await runner(
      request({
        updateIdentifier: 1002,
        sessionKey: topicB,
        instruction: `Continua la PR #${scenario.pull.number ?? pullRequestNumber}`,
      }),
    );

    assert.equal(result.outcome, "answered");
    assert.match(result.report, scenario.report);
    assert.equal(github.pushes.length, 1);
    assert.equal(existsSync(worktreeOf(paths, topicB)), false);
    assert.deepEqual(
      workflowTraces(traces).map((entry) => [entry.action, entry.detail]),
      [
        [
          "continuation_refused",
          `${scenario.reason} #${scenario.pull.number ?? pullRequestNumber} ${headSha.slice(0, 7)}`,
        ],
      ],
    );
  });
}

for (const scenario of [
  "another instruction",
  "unreported CI work",
  "an unknown CI notice",
]) {
  test(`refuses to resume while the owner topic has ${scenario}`, async (context) => {
    const paths = await fixture(context);
    const github = githubStub(paths);
    const ciWatches = stateStore(paths);
    context.after(() => ciWatches.close());
    const { head } = await publishFromTopicA({
      paths,
      github,
      ciWatches,
    });
    if (scenario === "unreported CI work") {
      // The delivered notice of the publication is pending again.
      ciWatches.add({
        updateIdentifier: 1003,
        sessionKey: topicA,
        pullRequestNumber,
        commitSha: head,
      });
    }
    if (scenario === "an unknown CI notice") {
      // An older notice of the owner topic was never confirmed: it blocks the
      // handover even though a later notice was delivered.
      ciWatches.add({
        updateIdentifier: 999,
        sessionKey: topicA,
        pullRequestNumber,
        commitSha: head,
      });
      ciWatches.markUncertain(999);
    }
    const runner = runnerFor({
      paths,
      github,
      ciWatches,
      traces: [],
      classifyRequest: async () => "continuation",
      hasOtherInstructions: (sessionKey) =>
        scenario === "another instruction" && sessionKey === topicA,
      notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
      runModel: async () => assert.fail("the model must not run"),
    });

    const result = await runner(
      request({
        updateIdentifier: 1002,
        sessionKey: topicB,
        instruction: "Continua la PR #200",
      }),
    );

    assert.match(result.report, /encara té feina pendent/u);
    assert.equal(github.pushes.length, 1);
  });
}

test("asks for one pull request when a continuation names two", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    traces,
    classifyRequest: async () => "continuation",
    notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
    runModel: async () => assert.fail("the model must not run"),
  });

  const result = await runner(
    request({ instruction: "Continua #200 i #201, si us plau" }),
  );

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /nomena més d'una proposta/u);
  assert.deepEqual(
    workflowTraces(traces).map((entry) => [entry.action, entry.detail]),
    [["continuation_refused", "multiple_pull_requests"]],
  );
});

test("keeps the pending work of the same topic when it already has the branch", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  const worktreeA = worktreeOf(paths, topicA);
  writeFileSync(join(worktreeA, "pending.txt"), "pendent\n");
  const notices = [];
  const modelCalls = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces: [],
    classifyRequest: async () => "continuation",
    notifyHandover: async (notice) => notices.push(notice),
    runModel: async (modelRequest) => {
      modelCalls.push(modelRequest);
      writeFileSync(join(modelRequest.worktreePath, "change.txt"), "canvi 2\n");
      return { text: "SUMMARY: fix(tools): finish the pending change" };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Continua la PR #200 i acaba el canvi pendent",
    }),
  );

  assert.equal(result.outcome, "pull_request_updated");
  assert.equal(modelCalls[0].worktreePath, realpathSync(worktreeA));
  assert.equal(github.pushes[1].branch, changeBranchOf(paths));
  assert.equal(
    existsSync(archiveOf(paths, topicA, 1002)),
    false,
    "the same-topic path never archives the worktree",
  );
  assert.deepEqual(notices, []);
  assert.equal(
    ciWatches.latestPublication(pullRequestNumber).session_key,
    topicA,
  );
});

test("refuses a resume when an unpushed worktree holds the branch", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  writeFileSync(join(worktreeOf(paths, topicA), "pending.txt"), "pendent\n");
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces: [],
    classifyRequest: async () => "continuation",
    notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
    runModel: async () => assert.fail("the model must not run"),
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  assert.match(result.report, /canvis sense publicar/u);
  assert.equal(github.pushes.length, 1);
  assert.equal(existsSync(worktreeOf(paths, topicB)), false);
  assert.equal(
    readFileSync(join(worktreeOf(paths, topicA), "pending.txt"), "utf8"),
    "pendent\n",
    "nothing is overwritten",
  );
});

test("refuses a resume whose head moved before the branch was fetched", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  github.pull.headSha = await git(paths.origin, ["rev-parse", "main"]);
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces: [],
    classifyRequest: async () => "continuation",
    notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
    runModel: async () => assert.fail("the model must not run"),
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  assert.match(result.report, /ha canviat mentre la reprenia/u);
  assert.equal(github.pushes.length, 1);
});

test("publishes nothing when the resumed pull request does not change", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces: [],
    classifyRequest: async () => "continuation",
    runModel: async () => ({ text: "Ja està tot fet." }),
    runChecks: async () => assert.fail("checks must not run without changes"),
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  assert.equal(result.outcome, "answered");
  assert.equal(
    result.report,
    "Continuo la proposta #200, des del punt que ja teníem.\nJa està tot fet.",
  );
  assert.equal(github.pushes.length, 1);
  assert.equal(github.reused.length, 0);
  assert.equal(
    ciWatches.latestPublication(pullRequestNumber).session_key,
    topicA,
  );
});

test("continues from the head a person pushed after the service", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  const person = join(paths.directory, "person");
  await executeFile("git", ["clone", paths.origin, person]);
  const changeBranch = changeBranchOf(paths);
  await git(person, ["checkout", changeBranch]);
  writeFileSync(join(person, "person.txt"), "canvi d'una persona\n");
  await git(person, ["add", "person.txt"]);
  await git(person, ["commit", "-m", "fix: change by a person"]);
  await git(person, ["push", "origin", changeBranch]);
  const personHead = await git(paths.origin, ["rev-parse", changeBranch]);

  const modelCalls = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces: [],
    classifyRequest: async () => "continuation",
    runModel: async (modelRequest) => {
      modelCalls.push(modelRequest);
      writeFileSync(join(modelRequest.worktreePath, "service.txt"), "servei\n");
      return { text: "SUMMARY: fix(tools): continue after a person" };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  assert.equal(result.outcome, "pull_request_updated");
  assert.doesNotMatch(result.report, new RegExp(personHead.slice(0, 7), "u"));
  assert.match(result.report, /Continuo la proposta #200/u);
  assert.equal(
    readFileSync(join(modelCalls[0].worktreePath, "person.txt"), "utf8"),
    "canvi d'una persona\n",
  );
  assert.match(modelCalls[0].instruction, /person\.txt/u);
  assert.equal(
    await git(worktreeOf(paths, topicB), ["rev-parse", "HEAD~1"]),
    personHead,
  );
  assert.equal(github.pushes[1].branch, changeBranchOf(paths));
});

test("keeps the instruction when the handover notice fails", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces,
    classifyRequest: async () => "continuation",
    notifyHandover: async () => {
      throw new Error("Synthetic Telegram failure");
    },
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "second.txt"), "segon\n");
      return { text: "SUMMARY: fix(tools): finish the shared change" };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  assert.equal(result.outcome, "pull_request_updated");
  assert.equal(github.pushes.length, 2);
  assert.equal(
    ciWatches.latestPublication(pullRequestNumber).session_key,
    topicB,
  );
  assert.deepEqual(
    traces
      .filter((entry) => entry.action.startsWith("continuation_"))
      .map((entry) => entry.action),
    ["continuation_resumed", "continuation_handover_failed"],
  );
});

test("refuses a fork that reuses the branch of this topic's pull request", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  const worktreeA = worktreeOf(paths, topicA);
  writeFileSync(join(worktreeA, "pending.txt"), "pendent\n");
  github.pull = {
    number: pullRequestNumber + 1,
    headRef: changeBranchOf(paths),
    headRepository: "someone/mountain-runners",
  };
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces,
    classifyRequest: async () => "continuation",
    notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
    runModel: async () => assert.fail("the model must not run"),
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Continua la PR #201",
    }),
  );

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /no és d'aquest projecte/u);
  assert.equal(github.pushes.length, 1);
  assert.deepEqual(
    workflowTraces(traces).map((entry) => entry.detail),
    [`not_main_repository #201 ${head.slice(0, 7)}`],
  );
  assert.equal(
    readFileSync(join(worktreeA, "pending.txt"), "utf8"),
    "pendent\n",
    "the pending work of the topic is untouched",
  );
});

test("does not move the owner when the new watch cannot be registered", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  // The watch insert fails: the publication is done, but the topic change is
  // not recorded, so the previous topic keeps the CI notices.
  const unregistrable = {
    latestPublication: (pullRequestNumber) =>
      ciWatches.latestPublication(pullRequestNumber),
    hasUnreportedWork: (sessionKey) => ciWatches.hasUnreportedWork(sessionKey),
    add() {
      throw new Error("Synthetic state failure");
    },
  };
  const notices = [];
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches: unregistrable,
    traces,
    classifyRequest: async () => "continuation",
    notifyHandover: async (notice) => notices.push(notice),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "second.txt"), "segon\n");
      return { text: "SUMMARY: fix(tools): finish the shared change" };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  // Without a durable watch the instruction ends unknown, and the previous
  // topic keeps the ownership of the pull request.
  assert.equal(result.outcome, "uncertain");
  assert.match(
    result.report,
    /els avisos de les comprovacions continuaran arribant al tema anterior/u,
  );
  assert.equal(github.pushes.length, 2);
  assert.deepEqual(notices, []);
  assert.equal(
    ciWatches.latestPublication(pullRequestNumber).session_key,
    topicA,
    "the previous topic keeps the ownership",
  );
  assert.deepEqual(
    traces
      .filter((entry) => entry.action.startsWith("continuation_"))
      .map((entry) => [entry.action, entry.detail]),
    [
      ["continuation_resumed", `#200 ${head.slice(0, 7)}`],
      [
        "continuation_owner_unregistered",
        `#200 ${github.pushes[1].commit.slice(0, 7)}`,
      ],
    ],
  );
});

test("bounds the handover notice and keeps the published result", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  const controller = new AbortController();
  const noticeSignals = [];
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces,
    classifyRequest: async () => "continuation",
    notifyHandover: ({ signal }) => {
      noticeSignals.push(signal);
      // The transport never answers: the notice ends on its own deadline.
      const bounded = requestSignal(signal, 50);
      return new Promise((resolve, reject) => {
        bounded.addEventListener(
          "abort",
          () => reject(new Error("Synthetic notice timeout")),
          { once: true },
        );
      });
    },
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "second.txt"), "segon\n");
      return { text: "SUMMARY: fix(tools): finish the shared change" };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
    { signal: controller.signal },
  );

  assert.equal(result.outcome, "pull_request_updated");
  assert.deepEqual(noticeSignals, [controller.signal]);
  assert.equal(
    ciWatches.latestPublication(pullRequestNumber).session_key,
    topicB,
  );
  assert.deepEqual(
    traces
      .filter((entry) => entry.action.startsWith("continuation_"))
      .map((entry) => entry.action),
    ["continuation_resumed", "continuation_handover_failed"],
  );
  assert.match(
    traces.at(-1).detail,
    new RegExp(`^#200 ${github.pushes[1].commit.slice(0, 7)}$`, "u"),
  );
  assert.notEqual(head, github.pushes[1].commit);
});

test("omits the head SHA when the pull request cannot be read", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  github.pull = {
    number: pullRequestNumber,
    headRef: "feat/a-branch-nobody-pushed",
  };
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    traces,
    classifyRequest: async () => "continuation",
    notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
    runModel: async () => assert.fail("the model must not run"),
  });

  const result = await runner(request({ instruction: "Continua la PR #200" }));

  assert.match(result.report, /No he pogut llegir la proposta #200/u);
  assert.equal(github.pullRequestReads, 1);
  assert.deepEqual(
    workflowTraces(traces).map((entry) => entry.detail),
    ["unreadable #200"],
  );
});

test("ignores a number that is part of another token", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    traces,
    classifyRequest: async () => "continuation",
    runModel: async () => ({ text: "No hi ha cap PR per continuar." }),
  });

  let updateIdentifier = 1001;
  for (const instruction of [
    "Continua issue#200",
    "Continua la #200a",
    "Continua ##200",
    "Continua #200_",
  ]) {
    const result = await runner(request({ updateIdentifier, instruction }));
    updateIdentifier += 1;
    assert.equal(result.outcome, "answered");
    assert.equal(result.report, "No hi ha cap PR per continuar.");
  }

  assert.equal(github.pullRequestReads, 0);
  assert.deepEqual(workflowTraces(traces), []);
});

test("reads a repeated pull request number as one target", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  github.pull = { number: pullRequestNumber, headRef: "main" };
  const headSha = await git(paths.origin, ["rev-parse", "main"]);
  const traces = [];
  const runner = runnerFor({
    paths,
    github,
    traces,
    classifyRequest: async () => "continuation",
    notifyHandover: async () => assert.fail("no notice is sent on a refusal"),
    runModel: async () => assert.fail("the model must not run"),
  });

  const result = await runner(
    request({ instruction: "Continua #200 i després #200" }),
  );

  assert.match(result.report, /no és d'una feina d'aquest servei/u);
  assert.equal(github.pullRequestReads, 1);
  assert.deepEqual(
    workflowTraces(traces).map((entry) => [entry.action, entry.detail]),
    [["continuation_refused", `not_work_branch #200 ${headSha.slice(0, 7)}`]],
  );
});

// T8.7: a continuation without pending work resumes the pull request the topic
// published, instead of answering with the fixed clarification text.

test("continues the open pull request of the topic in place at its published head", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  const traces = [];
  const modelCalls = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces,
    classifyRequest: async () => "continuation",
    runModel: async (modelRequest) => {
      modelCalls.push(modelRequest);
      writeFileSync(join(modelRequest.worktreePath, "second.txt"), "segon\n");
      return {
        text: "Continuat.\nSUMMARY: fix(tools): finish the shared change",
      };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "canvia també el segon fitxer",
    }),
  );

  assert.equal(result.outcome, "pull_request_updated", result.report);
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].kind, "continuation");
  assert.equal(
    modelCalls[0].instruction,
    "canvia també el segon fitxer",
    "an in-place continuation keeps the request of the person",
  );
  assert.equal(
    modelCalls[0].worktreePath,
    realpathSync(worktreeOf(paths, topicA)),
  );
  assert.doesNotMatch(result.report, /Continuo la proposta/u);
  assert.equal(github.pushes.length, 2);
  assert.equal(github.pushes[1].branch, changeBranchOf(paths));
  assert.equal(
    github.created.length,
    1,
    "the pull request is updated, not reopened",
  );
  assert.equal(
    await git(worktreeOf(paths, topicA), ["rev-parse", "HEAD~1"]),
    head,
  );
  assert.deepEqual(workflowTraces(traces), []);
});

test("continues in place when the topic names its own open pull request", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  const modelCalls = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    classifyRequest: async () => "continuation",
    runModel: async (modelRequest) => {
      modelCalls.push(modelRequest);
      writeFileSync(join(modelRequest.worktreePath, "second.txt"), "segon\n");
      return {
        text: "Continuat.\nSUMMARY: fix(tools): finish the shared change",
      };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Continua la PR #200 i canvia el segon fitxer",
    }),
  );

  assert.equal(result.outcome, "pull_request_updated", result.report);
  assert.equal(modelCalls[0].kind, "continuation");
  assert.equal(
    modelCalls[0].worktreePath,
    realpathSync(worktreeOf(paths, topicA)),
    "the named pull request of the topic continues in its own worktree",
  );
  assert.equal(
    await git(worktreeOf(paths, topicA), ["branch", "--show-current"]),
    changeBranchOf(paths),
    "the worktree never detaches to origin/main",
  );
  assert.equal(
    await git(worktreeOf(paths, topicA), ["rev-parse", "HEAD~1"]),
    head,
  );
  assert.equal(github.created.length, 1, "no second pull request is opened");
  assert.equal(github.pushes[1].branch, changeBranchOf(paths));
});

test("answers the continuation as a consultation when the pull request of the topic is closed", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  github.pull.state = "closed";
  const modelCalls = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    classifyRequest: async () => "continuation",
    runModel: async (modelRequest) => {
      modelCalls.push(modelRequest);
      return { text: "La PR ja està tancada; què vols fer?" };
    },
  });

  const result = await runner(
    request({ updateIdentifier: 1002, instruction: "continua la feina" }),
  );

  assert.equal(result.outcome, "answered");
  assert.equal(result.report, "La PR ja està tancada; què vols fer?");
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].kind, "consultation");
  assert.equal(modelCalls[0].unclearRequest, true);
  assert.equal(github.pushes.length, 1, "a consultation publishes nothing");
});

test("resumes the pull request of the topic when the worktree holds another branch", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  const topicWorktree = worktreeOf(paths, topicA);
  await git(topicWorktree, [
    "checkout",
    "-b",
    "feat/tools-another-pending-task",
  ]);
  const traces = [];
  const modelCalls = [];
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    traces,
    classifyRequest: async () => "continuation",
    runModel: async (modelRequest) => {
      modelCalls.push(modelRequest);
      writeFileSync(join(modelRequest.worktreePath, "third.txt"), "tercer\n");
      return {
        text: "Continuat.\nSUMMARY: fix(tools): finish the shared change",
      };
    },
  });

  const result = await runner(
    request({ updateIdentifier: 1002, instruction: "afegeix una cosa més" }),
  );

  assert.equal(result.outcome, "pull_request_updated", result.report);
  assert.equal(modelCalls.length, 1);
  assert.match(modelCalls[0].instruction, /Continue pull request #200/u);
  assert.match(result.report, /Continuo la proposta #200/u);
  assert.equal(github.pushes.length, 2);
  assert.equal(github.pushes[1].branch, changeBranchOf(paths));
  assert.equal(
    github.reused.length,
    1,
    "the resumed publication updates the PR",
  );
  assert.equal(
    await git(topicWorktree, ["rev-parse", "HEAD~1"]),
    head,
    "the branch starts at the published head",
  );
  assert.equal(
    existsSync(archiveOf(paths, topicA, 1002)),
    true,
    "the previous worktree is preserved",
  );
  assert.deepEqual(
    workflowTraces(traces).map((entry) => entry.action),
    ["continuation_resumed"],
  );
});

test("updates the pull request of the topic even when it closes during the turn", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  const { head } = await publishFromTopicA({ paths, github, ciWatches });
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    classifyRequest: async () => "continuation",
    runModel: async (modelRequest) => {
      // The topic validated the pull request before the turn; it closes while
      // the model is working.
      github.pull.state = "closed";
      writeFileSync(join(modelRequest.worktreePath, "second.txt"), "segon\n");
      return {
        text: "Continuat.\nSUMMARY: fix(tools): finish the shared change",
      };
    },
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "canvia també el segon fitxer",
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.match(
    result.report,
    /un control de seguretat del servei l'ha aturat/u,
  );
  assert.equal(github.pushes.length, 1, "nothing is pushed to a closed PR");
  assert.equal(github.created.length, 1, "no other pull request is opened");
  assert.equal(github.openedBranches.length, 1);
  assert.equal(github.reused.length, 0);
  assert.notEqual(
    await git(worktreeOf(paths, topicA), ["rev-parse", "HEAD"]),
    head,
    "the work of the turn is kept locally",
  );
});

test("keeps the resume line as the service part of a mixed answer", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  const directory = mkdtempSync(join(tmpdir(), "mr-continuation-notes-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    sessionNotes: notes,
    classifyRequest: async () => "continuation",
    runModel: async () => ({ text: "Ja està tot fet." }),
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  assert.equal(result.outcome, "answered");
  assert.match(result.report, /Continuo la proposta #200/u);
  assert.match(result.report, /Ja està tot fet\./u);
  assert.deepEqual(
    notes.claim(topicB).map((note) => note.text),
    ["Continuo la proposta #200, des del punt que ja teníem."],
    "only the line the service wrote becomes a note",
  );
  assert.equal(
    notes.lastReply(topicB),
    result.report,
    "the classifier reads the whole text the topic received",
  );
});

test("keeps the resume line when a resumed turn answers nothing", async (context) => {
  const paths = await fixture(context);
  const github = githubStub(paths);
  const ciWatches = stateStore(paths);
  context.after(() => ciWatches.close());
  await publishFromTopicA({ paths, github, ciWatches });
  const directory = mkdtempSync(join(tmpdir(), "mr-continuation-blank-"));
  context.after(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const notes = new SessionNoteStore(join(directory, "session-notes.sqlite"));
  context.after(() => notes.close());
  const runner = runnerFor({
    paths,
    github,
    ciWatches,
    sessionNotes: notes,
    classifyRequest: async () => "continuation",
    runModel: async () => ({ text: "   " }),
  });

  const result = await runner(
    request({
      updateIdentifier: 1002,
      sessionKey: topicB,
      instruction: "Continua la PR #200",
    }),
  );

  const resumeLine = "Continuo la proposta #200, des del punt que ja teníem.";
  assert.equal(result.outcome, "answered");
  assert.match(result.report, new RegExp(resumeLine, "u"));
  assert.match(result.report, /No he pogut preparar cap resposta/u);
  assert.deepEqual(
    notes.claim(topicB).map((note) => note.text),
    [resumeLine],
    "the service line of the resume survives an empty answer",
  );
  assert.equal(notes.lastReply(topicB), result.report);
});
