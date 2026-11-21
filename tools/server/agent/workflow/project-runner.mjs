// Composition for this application. The coordinator receives operations;
// the project policy chooses prompts/checks and the adapters execute them.

import { runAgent } from "../runtime/agent.mjs";
import { classifyRequest as classifyWithModel } from "../runtime/request-kind.mjs";
import { agentSecrets } from "../config.mjs";
import { openIdentifierNames } from "../repository/identifiers.mjs";
import {
  runSandboxedCommand,
  stopSandboxedCommands,
} from "../sandbox/commands.mjs";
import { createPublisher } from "../repository/publisher.mjs";
import { createAttachmentStore } from "../attachments/store.mjs";
import { scaleImageAttachments } from "../attachments/scale.mjs";
import { createCiWatchRegistration } from "./ci-watch.mjs";
import { mergeStates } from "../repository/merge-request-store.mjs";
import {
  buildInstructionPrompt,
  formatMadridInstant,
  sandboxCheckCommand,
  sandboxPrepareCommand,
} from "../policy/development.mjs";
import { createInstructionRunner } from "./run-instruction.mjs";
import { createCrossTopicContinuation } from "./cross-topic-continuation.mjs";
import { createOverlapWarning } from "./overlap-warning.mjs";
import {
  createTopicPullRequestFinder,
  createLiveTopicStateReader,
} from "./topic-state.mjs";

export function createProjectRunner({
  config,
  github,
  environment = process.env,
  ciWatches,
  previewRequests,
  mergeRequests,
  topicJobs,
  requestPreview,
  requestMerge,
  readCiState,
  hasOtherInstructions,
  notifyHandover,
  prepareAttachment,
  attachmentStore = createAttachmentStore({
    stateDirectory: config.paths.state,
  }),
  sessionNotes,
  recordTrace,
  // The service fixes the instant a post is published with: the sandbox clock
  // is not trusted for it.
  now = () => new Date(),
  stopCommands = stopSandboxedCommands,
  executeSandbox = runSandboxedCommand,
  executeAgent = runAgent,
  classifyRequest = (context) =>
    classifyWithModel(config, { ...context, environment }),
  runModel = async (context) => {
    if (context.kind !== "consultation" && !context.worktreePrepared) {
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
        buildInstructionPrompt(context.instruction, context.kind, {
          unclearRequest: context.unclearRequest,
          serviceNotes,
          currentInstant: formatMadridInstant(now()),
          topicState: context.topicState,
        }),
      readOnly: context.kind === "consultation",
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
  runChecks = (context) =>
    executeSandbox({
      image: config.model.sandboxImage,
      workspacePath: context.worktreePath,
      worktreeRoot: config.paths.worktrees,
      command: ["bash", "-lc", sandboxCheckCommand(context.checkCommand)],
      limits: config.limits,
      sessionIdentifier: context.sandboxIdentifier,
      timeoutMilliseconds: config.limits.executionTimeoutMs,
      signal: context.signal,
    }),
  logger,
}) {
  // One installation salt names every worktree and every public branch suffix:
  // the workflow never derives a name from a Telegram identifier itself.
  const identifiers = openIdentifierNames(config.paths.state);
  // The pull request this topic published last and still owns, from the CI
  // watches: without them the service knows none.
  // The state block still describes the change a topic closed or merged, while
  // the classifier only receives a pull request the topic can continue working
  // on.
  const findOwnedTopicPullRequest = ciWatches
    ? createTopicPullRequestFinder(ciWatches)
    : undefined;
  const findTopicPullRequest = ciWatches
    ? createTopicPullRequestFinder(ciWatches, {
        includeEnded: false,
        mergeRequests,
      })
    : undefined;
  return createInstructionRunner({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
    identifiers,
    classifyRequest,
    runModel,
    runChecks,
    logger,
    requestPreview,
    requestMerge,
    prepareAttachment,
    scaleAttachments,
    attachmentStore,
    sessionNotes,
    topicJobs,
    recordTrace,
    findTopicPullRequest,
    // The state of the topic every turn receives, from the service's own stores:
    // the model cannot read the pull request, its checks or the preview inside
    // the sandbox.
    readTopicState:
      ciWatches && previewRequests && mergeRequests
        ? createLiveTopicStateReader({
            github,
            requiredChecks: config.github.requiredChecks,
            logger,
            ciWatches,
            previewRequests,
            mergeRequests,
            findTopicPullRequest: findOwnedTopicPullRequest,
            repositoryName: config.github.repository,
          })
        : undefined,
    registerCiWatch: ciWatches
      ? createCiWatchRegistration({ store: ciWatches, logger })
      : undefined,
    publishChange: createPublisher({
      github,
      secrets: agentSecrets(config, environment),
    }),
    continueFromPullRequest: createCrossTopicContinuation({
      repositoryPath: config.paths.repository,
      worktreeRoot: config.paths.worktrees,
      identifiers,
      repositoryName: config.github.repository,
      readPullRequest: ({ number, signal }) =>
        github.getPullRequest({ number, signal }),
      readComments: ({ number, since, signal }) =>
        github.listIssueComments({ number, since, signal }),
      readCiState,
      findOwner: (pullRequestNumber) =>
        ciWatches?.latestPublication(pullRequestNumber),
      hasPendingWork: ({ sessionKey, updateIdentifier }) =>
        hasOtherInstructions(sessionKey, updateIdentifier) ||
        ciWatches.hasUnreportedWork(sessionKey),
      notifyHandover,
      recordTrace,
      logger,
    }),
    // Without the CI watches there is no known active pull request to compare
    // with, so the service never warns.
    warnAboutOverlaps: ciWatches
      ? createOverlapWarning({
          repositoryPath: config.paths.repository,
          worktreeRoot: config.paths.worktrees,
          identifiers,
          listPullRequests: () => ciWatches.latestPublications(),
          isMerged: (published) =>
            mergeRequests?.latest({
              sessionKey: published.session_key,
              pullRequestNumber: published.pull_request_number,
            })?.state === mergeStates.merged,
          recordTrace,
        })
      : undefined,
  });
}
