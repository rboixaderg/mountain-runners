// Composition for this application. The coordinator receives operations;
// the project policy chooses prompts/checks and the adapters execute them.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../runtime/agent.mjs";
import { agentSecrets } from "../config.mjs";
import { openIdentifierNames } from "../repository/identifiers.mjs";
import { registeredWorktree, runGit } from "../repository/trusted-git.mjs";
import {
  runSandboxedCommand,
  stopSandboxedCommands,
} from "../sandbox/commands.mjs";
import { createPublisher } from "../repository/publisher.mjs";
import { createAttachmentStore } from "../attachments/store.mjs";
import { scaleImageAttachments } from "../attachments/scale.mjs";
import { createCiWatchRegistration } from "./ci-watch.mjs";
import {
  buildInstructionPrompt,
  formatMadridInstant,
  sandboxCheckCommand,
  sandboxPrepareCommand,
} from "../policy/development.mjs";
import { createInstructionRunner } from "./run-instruction.mjs";
import { createLiveTopicStateReader } from "./topic-state.mjs";

export function createProjectRunner({
  config,
  github,
  environment = process.env,
  ciWatches,
  mergeRequests,
  topicJobs,
  followPreview,
  requestMerge,
  requestMergeConfirmation,
  prepareAttachment,
  attachmentStore = createAttachmentStore({
    stateDirectory: config.paths.state,
  }),
  sessionNotes,
  research,
  researchReview,
  recordTrace,
  // The service fixes the instant a post is published with: the sandbox clock
  // is not trusted for it.
  now = () => new Date(),
  stopCommands = stopSandboxedCommands,
  executeSandbox = runSandboxedCommand,
  executeAgent = runAgent,
  runModel = async (context) => {
    if (!context.worktreePrepared) {
      const preparation = await executeSandbox({
        image: config.model.sandboxImage,
        workspacePath: context.worktreePath,
        worktreeRoot: config.paths.worktrees,
        command: ["bash", "-lc", sandboxPrepareCommand],
        limits: config.limits,
        sessionIdentifier: context.sandboxIdentifier,
        timeoutMilliseconds: config.limits.executionTimeoutMs,
        signal: context.signal,
      });
      context.signal?.throwIfAborted();
      if (preparation.timedOut) {
        return { timedOut: true };
      }
      if (preparation.exitCode !== 0) {
        return { preparationFailed: true };
      }
    }
    // The turn starts inside the runtime, after the profile is ready and right
    // before Pi receives the prompt: the message is built there with the effects
    // of the topic, and a preparation that failed keeps them undelivered.
    return executeAgent(config, {
      ...context,
      environment,
      stopCommands,
      buildMessage: (serviceNotes) =>
        buildInstructionPrompt(context.instruction, {
          serviceNotes,
          currentInstant: formatMadridInstant(now()),
          topicState: context.topicState,
        }),
    });
  },
  // Reading the pixels of an untrusted image happens only inside the sandbox.
  // The command installs the offline dependencies first, so the runtime turn
  // that follows does not repeat the preparation.
  scaleAttachments = ({ images, worktreePath, sandboxIdentifier, signal }) =>
    scaleImageAttachments({
      images,
      worktreePath,
      signal,
      prepareCommand: sandboxPrepareCommand,
      execute: (command, { signal: commandSignal }) =>
        executeSandbox({
          image: config.model.sandboxImage,
          workspacePath: worktreePath,
          worktreeRoot: config.paths.worktrees,
          command,
          limits: config.limits,
          sessionIdentifier: sandboxIdentifier,
          timeoutMilliseconds: config.limits.executionTimeoutMs,
          signal: commandSignal,
        }),
    }),
  runChecks = async (context) => {
    const worktree = registeredWorktree(
      config.paths.repository,
      context.worktreePath,
    );
    const files = await runGit(
      worktree,
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        signal: context.signal,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "buffer",
      },
    );
    const deletedFiles = await runGit(
      worktree,
      ["ls-files", "--deleted", "-z"],
      {
        signal: context.signal,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "buffer",
      },
    );
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const deleted = new Set(decoder.decode(deletedFiles).split("\0"));
    const inventory = `${decoder
      .decode(files)
      .split("\0")
      .filter(Boolean)
      .map((file) => `${deleted.has(file) ? "D" : "P"}${file}`)
      .join("\0")}\0`;
    const directory = await mkdtemp(join(tmpdir(), "mountain-agent-docs-"));
    const documentationFilesPath = join(directory, "files");
    let failure;
    let result;
    try {
      await writeFile(documentationFilesPath, inventory, { mode: 0o600 });
      result = await executeSandbox({
        image: config.model.sandboxImage,
        workspacePath: context.worktreePath,
        worktreeRoot: config.paths.worktrees,
        command: ["bash", "-lc", sandboxCheckCommand(context.checkCommand)],
        limits: config.limits,
        sessionIdentifier: context.sandboxIdentifier,
        timeoutMilliseconds: config.limits.executionTimeoutMs,
        signal: context.signal,
        documentationFilesPath,
      });
    } catch (error) {
      failure = error;
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
    return result;
  },
  logger,
}) {
  // One installation salt names every worktree and every public branch suffix:
  // the workflow never derives a name from a Telegram identifier itself.
  const identifiers = openIdentifierNames(config.paths.state);
  return createInstructionRunner({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
    identifiers,
    runModel,
    runChecks,
    secrets: agentSecrets(config),
    logger,
    followPreview,
    requestMerge,
    requestMergeConfirmation,
    research,
    prepareResearchJob: (jobId, options) =>
      researchReview.ensure(jobId, options),
    isResearchAffected: (jobId) => researchReview.isTainted(jobId),
    reviewedCommit: async (jobId) => {
      const { reviewId } = await researchReview.status(jobId);
      return reviewId === null
        ? null
        : (await researchReview.candidate(jobId, reviewId)).commit;
    },
    prepareAttachment,
    scaleAttachments,
    attachmentStore,
    sessionNotes,
    topicJobs,
    repositoryName: config.github.repository,
    readBoundPullRequest: (number, { signal }) =>
      github.getPullRequest({ number, signal }),
    recordTrace,
    // The state of the topic every turn receives, from the service's own stores:
    // the model cannot read the pull request, its checks or the preview inside
    // the sandbox.
    readTopicState: createLiveTopicStateReader({
      github,
      requiredChecks: config.github.requiredChecks,
      logger,
      ciWatches,
      mergeRequests,
      repositoryName: config.github.repository,
    }),
    registerCiWatch: createCiWatchRegistration({ store: ciWatches, logger }),
    publishChange: createPublisher({
      github,
      repository: config.github.repository,
      secrets: agentSecrets(config),
      researchReview,
    }),
  });
}
