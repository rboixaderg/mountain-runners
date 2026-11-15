// Composition for this application. The coordinator receives operations;
// the project policy chooses prompts/checks and the adapters execute them.

import { runAgent } from "../runtime/agent.mjs";
import { classifyRequest as classifyWithModel } from "../runtime/request-kind.mjs";
import { agentSecrets } from "../config.mjs";
import {
  runSandboxedCommand,
  stopSandboxedCommands,
} from "../sandbox/commands.mjs";
import { createPublisher } from "../repository/publisher.mjs";
import { createCiWatchRegistration } from "./ci-watch.mjs";
import {
  buildInstructionPrompt,
  sandboxCheckCommand,
  sandboxPrepareCommand,
} from "../policy/development.mjs";
import { createInstructionRunner } from "./run-instruction.mjs";
import { createCrossTopicContinuation } from "./cross-topic-continuation.mjs";

export function createProjectRunner({
  config,
  github,
  environment = process.env,
  ciWatches,
  requestPreview,
  requestMerge,
  readCiState,
  hasOtherInstructions,
  notifyHandover,
  recordTrace,
  stopCommands = stopSandboxedCommands,
  executeSandbox = runSandboxedCommand,
  executeAgent = runAgent,
  classifyRequest = (context) =>
    classifyWithModel(config, { ...context, environment }),
  runModel = async (context) => {
    if (context.kind !== "consultation") {
      const preparation = await executeSandbox({
        image: config.model.sandboxImage,
        workspacePath: context.worktreePath,
        worktreeRoot: config.paths.worktrees,
        command: ["bash", "-lc", sandboxPrepareCommand],
        limits: config.limits,
        sessionIdentifier: context.sessionIdentifier,
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
    return executeAgent(config, {
      ...context,
      environment,
      stopCommands,
      message: buildInstructionPrompt(context.instruction, context.kind),
      readOnly: context.kind === "consultation",
    });
  },
  runChecks = (context) =>
    executeSandbox({
      image: config.model.sandboxImage,
      workspacePath: context.worktreePath,
      worktreeRoot: config.paths.worktrees,
      command: ["bash", "-lc", sandboxCheckCommand],
      limits: config.limits,
      sessionIdentifier: context.sessionIdentifier,
      timeoutMilliseconds: config.limits.executionTimeoutMs,
      signal: context.signal,
    }),
  logger,
}) {
  return createInstructionRunner({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
    classifyRequest,
    runModel,
    runChecks,
    logger,
    requestPreview,
    requestMerge,
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
  });
}
