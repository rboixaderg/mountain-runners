import assert from "node:assert/strict";
import { PiRunError } from "telegram-pi-bridge/pi";
import {
  chmodSync,
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PublishRefusedError } from "../repository/github.mjs";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { PublicationRuleError } from "../repository/secret-scan.mjs";
import { noteLimits } from "../repository/session-note-store.mjs";
import { instructionReports } from "../policy/development.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { createNestedRepository } from "../repository/test-support/nested-repository.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";
import { git } from "../repository/test-support/git-repository.mjs";
import { publicationGithub } from "./test-support/github.mjs";
import {
  fixture,
  configFor,
  topicWorktreePath,
  noteStore,
  request,
} from "./test-support/run-instruction.mjs";

test("keeps an unconfirmed sandbox stop uncertain even if inventory cleanup fails", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  let directory;
  context.after(() => {
    if (directory && existsSync(directory)) {
      chmodSync(directory, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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

test("keeps the worktree and publishes nothing when the checks fail", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const entries = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
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

for (const scenario of [
  {
    name: "a failed check",
    expectedReport: instructionReports.checksFailed,
    runChecks: async () => ({
      exitCode: 1,
      stdout: `${"earlier line\n".repeat(200)}\u001b[31mbroken-test failed\u001b[0m github-secret\n`,
      stderr: "telegram-secret\n",
      timedOut: false,
    }),
    expectedDetail: [
      /Local check `pnpm check` failed with exit code 1\./u,
      /\| broken-test failed \*\*\*$/mu,
    ],
  },
  {
    name: "a check that leaves changes",
    expectedReport: instructionReports.checksFailed,
    runChecks: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "generated.txt"), "generated\n");
      return { exitCode: 0, timedOut: false };
    },
    expectedDetail: [/left uncommitted changes: "generated\.txt"\./u],
  },
  {
    name: "a nested repository",
    expectedReport: instructionReports.publicationRefused,
    edit: (worktreePath, paths) =>
      createNestedRepository(worktreePath, join(paths.directory, "filter-ran")),
    expectedDetail: [/Publication refused: .*nested Git repository/u],
  },
  {
    name: "a publication rule",
    expectedReport: instructionReports.publicationRefused,
    refusal: new PublishRefusedError("raw", {
      cause: new PublicationRuleError(
        'Publication changes a protected GitHub or CODEOWNERS path: "CODEOWNERS".',
      ),
    }),
    expectedDetail: [/Publication refused: .*"CODEOWNERS"\./u],
  },
  {
    name: "an unexplained publisher refusal",
    expectedReport: instructionReports.publicationRefused,
    refusal: new PublishRefusedError("raw tool output", {
      cause: new Error("raw tool output"),
    }),
    expectedDetail: [/Publication refused: A preflight check/u],
  },
]) {
  test(`delivers the answer and keeps the reason of ${scenario.name} for the next turn`, async (context) => {
    const paths = await fixture(context);
    const github = publicationGithub();
    if (scenario.refusal) {
      github.pushBranch = async () => {
        throw scenario.refusal;
      };
    }
    const sessionNotes = noteStore(context, paths);
    const prompts = [];
    const runner = createTestProjectRunner({
      config: configFor(paths),
      github,
      sessionNotes,
      runModel: async (options) => {
        prompts.push(options.claimServiceNotes().join("\n"));
        options.onPromptSent();
        if (prompts.length > 1) return { text: "Resposta.", errorMessage: "x" };
        writeFileSync(join(options.worktreePath, "change.txt"), "canvi\n");
        await scenario.edit?.(options.worktreePath, paths);
        return { text: "He fet el canvi.\nSUMMARY: fix(tools): a change" };
      },
      runChecks:
        scenario.runChecks ??
        (async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    });

    const result = await runner(request());
    await runner(request({ updateIdentifier: 1002 }));

    const report = `He fet el canvi.\n\n${scenario.expectedReport}`;
    assert.equal(result.outcome, "failed");
    assert.equal(result.report, report);
    for (const pattern of scenario.expectedDetail) {
      assert.match(prompts[1], pattern);
    }
    assert.ok(prompts[1].startsWith(scenario.expectedReport));
    assert.ok(prompts[1].length <= noteLimits.characters);
    assert.doesNotMatch(
      prompts[1],
      /He fet el canvi|raw|github-secret|telegram-secret/u,
    );
    assert.equal(prompts[1].includes("\u001b"), false);
  });
}

test("refuses a nested repository locally without entering it and keeps the work", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const entries = [];
  const marker = join(paths.directory, "filter-ran");
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
    expectedReason: "checksTimedOut",
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
    expectedReason: "checksFailed",
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
    expectedReport: instructionReports.aborted,
    expectedReason: "aborted",
    expectedDiagnostics: {
      reason: "cancelled",
      exitCode: -1,
      signal: "SIGKILL",
    },
  },
]) {
  test(`logs checks_failed diagnostics for ${scenario.name}`, async (context) => {
    const paths = await fixture(context);
    const github = publicationGithub();
    const entries = [];
    const controller = new AbortController();
    const runner = createTestProjectRunner({
      config: configFor(paths),
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
    assert.deepEqual(
      entries.find(([event]) => event === "maintainer_attention"),
      ["maintainer_attention", scenario.expectedReason],
    );
    assert.deepEqual(github.pushes, []);
  });
}

for (const edits of [false, true]) {
  test(`fails a topic turn with a provider error ${edits ? "with" : "without"} edits and publishes nothing`, async (context) => {
    const paths = await fixture(context);
    const github = publicationGithub();
    const runner = createTestProjectRunner({
      config: configFor(paths),
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  "model",
  "checks",
  "checks_timeout",
  "model_aborted",
  "signal",
]) {
  test(`does not mark a local ${failureStage} failure as a remote uncertainty`, async (context) => {
    const paths = await fixture(context);
    const github = publicationGithub();
    const controller = new AbortController();
    const runner = createTestProjectRunner({
      config: configFor(paths),
      github,
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    logger: (event, detail) => entries.push([event, detail]),
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
    const runner = createTestProjectRunner({
      config: configFor(paths),
      github: publicationGithub(),
      logger: (event, detail) => entries.push([event, detail]),
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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

test("records a failed gate for the maintainer once and publishes the work later", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const traces = [];
  let checksPass = false;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    ciWatches,
    recordTrace: (entry) => traces.push(entry),
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "pending.txt"), "pendent\n");
      return { text: "SUMMARY: feat(tools): keep the pending work" };
    },
    runChecks: async () => (checksPass ? { exitCode: 0 } : { exitCode: 1 }),
  });
  assert.equal((await runner(request())).outcome, "failed");
  checksPass = true;
  const result = await runner(
    request({
      updateIdentifier: 1002,
      instruction: "Continua la feina pendent.",
    }),
  );

  assert.equal(result.outcome, "pull_request_created");
  assert.deepEqual(
    traces.map((entry) => entry.action),
    ["maintainer_attention"],
  );
});

test("keeps the checkpointed work unpublished when the signal aborts during checks", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const controller = new AbortController();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    ciWatches: {
      topicPullRequestNumber: () => null,
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
