import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { PublishRefusedError } from "../repository/github.mjs";
import { PublicationStore } from "../repository/publication-store.mjs";
import { MergeRequestStore } from "../repository/merge-request-store.mjs";
import { TopicJobStore } from "../repository/topic-job-store.mjs";
import {
  attachmentRefusalReport,
  attachmentReports,
  instructionReports,
  savedNotice,
  serviceNotesHeader,
  topicStateHeader,
} from "../policy/development.mjs";
import { createAttachmentPreparation } from "../attachments/prepare.mjs";
import { createAttachmentStore } from "../attachments/store.mjs";
import { attachmentRefusalReasons } from "../attachments/refusals.mjs";
import {
  jpegImage,
  pngImage,
} from "../attachments/test-support/synthetic-images.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { git } from "../repository/test-support/git-repository.mjs";
import { publicationGithub } from "./test-support/github.mjs";
import {
  fixture,
  configFor,
  topicSessionKey,
  topicWorktreePath,
  promptOf,
  noteStore,
  request,
  attachmentRequest,
  telegramAttachment,
} from "./test-support/run-instruction.mjs";

test("places an attached image and appends the service text to the instruction", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 1200, height: 800 });
  const traces = [];
  const instructions = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
  const publications = new PublicationStore(
    join(paths.state, "ci-watch.sqlite"),
  );
  const mergeRequests = new MergeRequestStore(
    join(paths.state, "merge-request.sqlite"),
  );
  context.after(() => {
    mergeRequests.close();
    publications.close();
  });
  // The topic already reported a green pull request before this turn.
  publications.record({
    authorIdentifier: 42,
    updateIdentifier: 900,
    sessionKey: topicSessionKey,
    pullRequestNumber: 239,
    commitSha: "a".repeat(40),
  });
  publications.finishCiNotice(900, "success");
  const prompts = [];
  const config = configFor(paths);
  config.github.requiredChecks = ["Validate"];
  const runner = createTestProjectRunner({
    config,
    github: {
      ...publicationGithub(),
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
    publications,
    mergeRequests,
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

test("passes an image to a consultation with web research enabled", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 200, height: 100 });
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
    runModel: async ({ instruction, images }) => {
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
  assert.equal(
    result.report,
    attachmentRefusalReport({
      reason: attachmentRefusalReasons.fakeType,
    }),
  );
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    recordTrace: () => {},
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
  const github = publicationGithub();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    recordTrace: () => {},
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
  const github = publicationGithub();
  const first = createTestProjectRunner({
    config: configFor(paths),
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "pending.txt"), "canvi pendent\n");
      return { text: "Canvi.\nSUMMARY: feat(content): pending change" };
    },
    runChecks: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
  });
  const failed = await first(attachmentRequest({ attachments: [] }));

  assert.equal(failed.outcome, "failed");
  assert.deepEqual(github.pushes, []);

  const continuation = createTestProjectRunner({
    config: configFor(paths),
    github,
    recordTrace: () => {},
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

test("applies the image of a continuation to the pull request of the topic", async (context) => {
  const paths = await fixture(context);
  mkdirSync(paths.state, { recursive: true });
  const publications = new PublicationStore(
    join(paths.state, "ci-watch.sqlite"),
  );
  context.after(() => publications.close());
  const topicJobs = new TopicJobStore(join(paths.state, "topic-jobs.sqlite"));
  context.after(() => topicJobs.close());
  const notes = noteStore(context, paths);
  const github = publicationGithub();
  const image = pngImage({ width: 1200, height: 800 });
  const prompts = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    publications,
    topicJobs,
    sessionNotes: notes,
    prepareAttachment: createAttachmentPreparation({
      telegram: telegramAttachment(image),
    }),
    hasOtherInstructions: () => false,
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

test("keeps the clarification fallback when an image turn answers nothing", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
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
  assert.deepEqual(
    notes.claim(topicSessionKey).map((note) => note.text),
    [result.report],
    "the fixed text is a service note",
  );
});

// T8.8: the topic keeps its images and the model receives them as image input.

test("keeps listing the stored image on a later turn without a new attachment", async (context) => {
  const paths = await fixture(context);
  const github = publicationGithub();
  const prompts = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  const github = publicationGithub();
  const modelAttachments = [];
  const instructions = [];
  let downloads = 0;
  let turn = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
  const github = publicationGithub();
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    attachmentStore: store,
    recordTrace: (entry) => traces.push(entry),
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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

test("omits the image that does not fit the prompt byte budget and names it", async (context) => {
  const paths = await fixture(context);
  const image = pngImage({ width: 800, height: 600, filler: 4_500_000 });
  let prompt = null;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
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
