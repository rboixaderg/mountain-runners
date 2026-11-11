// Composition for this application. The coordinator receives operations;
// the project policy chooses prompts/checks and the adapters execute them.

import { runAgent } from "../runtime/agent.mjs";
import { classifyRequest as classifyWithModel } from "../runtime/request-kind.mjs";
import {
  runSandboxedCommand,
  stopSandboxedCommands,
} from "../sandbox/commands.mjs";
import { createPublisher } from "../repository/publisher.mjs";
import {
  buildInstructionPrompt,
  sandboxCheckCommand,
  sandboxPrepareCommand,
} from "../policy/development.mjs";
import { createInstructionRunner } from "./run-instruction.mjs";

export function createProjectRunner({
  config,
  github,
  environment = process.env,
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
    publishChange: createPublisher({
      github,
      secrets: [
        config.telegram.botToken,
        config.github.token,
        ...config.model.providerEnvironmentVariables.map(
          (name) => environment[name],
        ),
      ],
    }),
  });
}
