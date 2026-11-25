import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PublicationBaseChangedError } from "../repository/github.mjs";
import { TopicJobStore } from "../repository/topic-job-store.mjs";
import {
  failedMaintainerNotice,
  instructionReports,
} from "../policy/development.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { createNestedRepository } from "../repository/test-support/nested-repository.mjs";
import { git } from "../repository/test-support/git-repository.mjs";
import { publicationGithub } from "./test-support/github.mjs";
import {
  fixture,
  configFor,
  topicWorktreePath,
  request,
  advanceMain,
} from "./test-support/run-instruction.mjs";

const executeFile = promisify(execFile);

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
  const github = publicationGithub();
  let checks = 0;
  let modelTurns = 0;
  let advancedMain;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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

async function assertAdvancedPullRequest(
  context,
  {
    updateBranch = false,
    pending = false,
    ignoredConflict = false,
    pendingConflict = false,
    leaveConflict = false,
    answerConflict = false,
    diverged = false,
    noEdit = false,
  } = {},
) {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const github = publicationGithub();
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
    runModel: async ({ worktreePath, instruction }) => {
      if (pendingConflict && instruction.includes("Conflicted paths")) {
        conflictTurns += 1;
        const conflictPath = join(worktreePath, "pending.txt");
        assert.match(readFileSync(conflictPath, "utf8"), /<<<<<<< /u);
        const unanswered =
          leaveConflict && !instruction.includes("Conserva les dues versions");
        if (!unanswered)
          writeFileSync(conflictPath, "pending work\nremote work\n");
        return {
          text: unanswered
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
    assert.equal(second.report, failedMaintainerNotice);
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
    assert.equal(second.report, "Quina versió vols?");
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
    if (answerConflict) {
      const answered = await runner(
        request({
          updateIdentifier: 1003,
          instruction: "Conserva les dues versions",
        }),
      );
      assert.equal(answered.outcome, "pull_request_updated", answered.report);
      assert.equal(conflictTurns, 2);
      assert.equal(modelTurns, 2);
      assert.equal(github.pushes.length, 2);
    }
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

test("the answer of the person reaches the conflict turn and resolves it", async (context) => {
  await assertAdvancedPullRequest(context, {
    pending: true,
    pendingConflict: true,
    leaveConflict: true,
    answerConflict: true,
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
  const github = publicationGithub();
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
    // The first read is the check before the model turn and the second one the
    // state of the topic; the third is the publisher's, immediately before the
    // push.
    if (reads === 3) return unreadable(options);
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
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

// One ordinary turn whose model leaves `change.txt` uncommitted while `main`
// advances with `main-change.txt`. The gate records what it saw.
async function runStaleTurn(
  context,
  { advance = true, gate, onWorktree = () => {} } = {},
) {
  const paths = await fixture(context);
  const github = publicationGithub();
  const gates = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  const github = publicationGithub();
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  const github = publicationGithub();
  let turns = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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

for (const [path, expected] of [
  ["README.md", false],
  ["package.json", true],
]) {
  test(`the conflict turn on ${path} ${expected ? "skips" : "repeats"} the preparation`, async (context) => {
    const paths = await fixture(context);
    const prepared = [];
    const runner = createTestProjectRunner({
      config: configFor(paths),
      github: publicationGithub(),
      runModel: async ({ worktreePath, worktreePrepared }) => {
        prepared.push(worktreePrepared);
        if (prepared.length === 2) return { text: "Quina versió?" };
        writeFileSync(join(worktreePath, path), "topic change\n");
        await advanceMain(paths, path, "main change\n");
        return { text: "SUMMARY: feat(tools): add synthetic change" };
      },
    });
    await runner(request());
    assert.equal(prepared[1], expected);
  });
}

test("a resolved merge ignores the whitespace main brings", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  let turns = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    runModel: async ({ worktreePath }) => {
      turns += 1;
      if (turns === 2) {
        writeFileSync(
          join(worktreePath, "README.md"),
          "main change  \ntopic change\n",
        );
        return { text: "Fet.\nCONFLICT_RESOLVED" };
      }
      writeFileSync(join(worktreePath, "README.md"), "topic change\n");
      await advanceMain(paths, "other.txt", "trailing  \n");
      await advanceMain(paths, "README.md", "main change  \n");
      return { text: "SUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0 }),
  });
  const result = await runner(request());
  assert.equal(result.outcome, "pull_request_created", result.report);
});

test("a resolved merge still refuses the whitespace its resolution adds", async (context) => {
  const { github, result } = await conflictTurn(context, (worktreePath) => {
    writeFileSync(join(worktreePath, "README.md"), "resolved  \n");
    return { text: "Fet.\nCONFLICT_RESOLVED" };
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(github.pushes, []);
});
