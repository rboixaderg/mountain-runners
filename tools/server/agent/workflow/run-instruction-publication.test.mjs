import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PublishRefusedError } from "../repository/github.mjs";
import { PublicationStore } from "../repository/publication-store.mjs";
import { TopicJobStore } from "../repository/topic-job-store.mjs";
import {
  failedMaintainerNotice,
  instructionReports,
  savedNotice,
} from "../policy/development.mjs";
import { createAttachmentPreparation } from "../attachments/prepare.mjs";
import { createAttachmentStore } from "../attachments/store.mjs";
import { pngImage } from "../attachments/test-support/synthetic-images.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { hasUnpublishedCommit } from "../repository/worktrees.mjs";
import { git } from "../repository/test-support/git-repository.mjs";
import { publicationGithub } from "./test-support/github.mjs";
import {
  fixture,
  configFor,
  topicSessionKey,
  identifiersFor,
  topicWorktreePath,
  noteStore,
  request,
  publishedWorktree,
  attachmentRequest,
  telegramAttachment,
} from "./test-support/run-instruction.mjs";

const executeFile = promisify(execFile);

function branchSuffix(paths, updateIdentifier) {
  return identifiersFor(paths).changeSuffix(updateIdentifier);
}

test("publishes a later change to the existing pull request of the topic", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const publications = new PublicationStore(
    join(paths.state, "ci-watch.sqlite"),
  );
  context.after(() => publications.close());
  const github = publicationGithub();
  const published = await publishedWorktree(
    context,
    paths,
    github,
    publications,
  );
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    publications,
    topicJobs,
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

test("publishes a small change as a pull request after the checks pass", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const checks = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
  const github = publicationGithub();
  let checkerRan = false;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  assert.equal(
    result.report,
    `Canvi fet.\n\n${instructionReports.checksFailed}`,
  );
  assert.equal(existsSync(join(topicWorktreePath(paths), "late.md")), true);
});

test("leaves a file deleted by the checkpointed change out of the documentation inventory", async (context) => {
  const paths = await fixture(context);
  let checked = false;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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

test("publishes pending work after a later question when checks recover", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const events = [];
  let turn = 0;
  let checkCount = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  const github = publicationGithub();
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  const github = publicationGithub();
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
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

  // The pull request vanishes after the push: nobody knows the result.
  github.ensurePullRequest = async () => ({
    pullRequest: null,
    created: false,
  });
  turns = 0;
  const vanished = await runner(request({ updateIdentifier: 1005 }));
  assert.equal(vanished.outcome, "uncertain");
  assert.equal(vanished.report, instructionReports.publicationUncertain);
});

test("reports a persistent publication block after each model turn", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  let modelTurns = 0;
  let checkCount = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  assert.equal(
    retried.report,
    `Resposta.\n\n${instructionReports.checksFailed}`,
  );
  assert.equal(checkCount, 2);
  assert.equal(modelTurns, 2);
  assert.deepEqual(github.pushes, []);
});

test("does not bind a topic when local checks block publication", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
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

test("two implementation turns publish to the first bound pull request", async (context) => {
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    topicJobs,
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
  const github = publicationGithub();
  const commands = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const github = publicationGithub();
  const commands = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const github = publicationGithub();
  github.labelError = new Error("GitHub refused the label");
  const traces = [];
  const runner = createTestProjectRunner({
    recordTrace: (entry) => traces.push(entry),
    config: configFor(paths),
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
  const github = publicationGithub();
  github.labelError = new Error("GitHub refused the label");
  mkdirSync(paths.state, { recursive: true });
  const publications = new PublicationStore(
    join(paths.state, "ci-watch.sqlite"),
  );
  context.after(() => publications.close());
  publications.record = () => {
    throw new Error("The watch cannot be stored");
  };
  const traces = [];
  const runner = createTestProjectRunner({
    recordTrace: (entry) => traces.push(entry),
    config: configFor(paths),
    github,
    publications,
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const publications = new PublicationStore(
    join(paths.state, "ci-watch.sqlite"),
  );
  context.after(() => publications.close());
  const github = publicationGithub();
  github.getCommitCheckRuns = () =>
    assert.fail("the instruction must not wait for CI");
  github.getCommitStatuses = () =>
    assert.fail("the instruction must not wait for CI");
  github.getPullRequest = () =>
    assert.fail("the instruction must not wait for CI");
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    publications,
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
  const [watch] = publications.pendingCiWatches();
  assert.equal(watch.commit_sha, published);
  assert.equal(watch.pull_request_number, 200);
  assert.equal(watch.session_key, request().sessionKey);
});

test("follows the preview of every commit it publishes, without a request", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const publications = new PublicationStore(
    join(paths.state, "ci-watch.sqlite"),
  );
  context.after(() => publications.close());
  const followed = [];
  publications.record = (publication) => followed.push(publication);
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    publications,
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
      commitSha: published,
      mergeSynchronization: false,
    },
  ]);
});

test("ends the instruction unknown when the CI watch cannot be registered", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    publications: {
      topicPullRequestNumber: () => null,
      record() {
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

test("passes the configured provider credentials to the publication scanner", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const config = configFor(paths);
  config.model.providerEnvironment = {
    SYNTHETIC_PROVIDER_KEY: "synthetic-provider-secret",
  };
  const runner = createTestProjectRunner({
    config,
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
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

test("continues the unpublished branch when the previous checks failed", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  let checksPass = false;
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const github = publicationGithub();
  let attempt = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const github = publicationGithub();
  github.pushBranch = async () => {
    throw new PublishRefusedError(
      "The worktree file leaked.env contains a live credential.",
    );
  };
  const runner = createTestProjectRunner({
    config: configFor(paths),
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
  const github = publicationGithub();
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
    const github = publicationGithub();
    const operation = github[operationName].bind(github);
    const failure = new Error(
      "Synthetic connection lost after the remote action.",
    );
    github[operationName] = async (parameters) => {
      await operation(parameters);
      throw failure;
    };
    const runner = createTestProjectRunner({
      config: configFor(paths),
      github,
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
  const github = publicationGithub();
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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

test("logs a post-publication store failure without changing the result", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 200, height: 100 });
  const store = createAttachmentStore({ stateDirectory: paths.state });
  const events = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    attachmentStore: {
      ...store,
      remove: () => {
        throw new Error("synthetic manifest failure");
      },
    },
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
