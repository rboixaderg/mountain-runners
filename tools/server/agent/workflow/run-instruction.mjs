// Coordinate one instruction. Model, checks and remote publication are supplied
// operations. This module has no container/GitHub transport or secret configuration.

import { sessionIdentifier } from "telegram-pi-bridge/sessions";
import {
  assertWorkBranch,
  commitAll,
  createBranch,
  currentBranch,
  ensureSessionWorktree,
  listChangedPaths,
  committedPaths,
  hasUnpublishedCommit,
} from "../repository/worktrees.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";
import {
  parseChangeSummary,
  branchNameForChange,
  fallbackTitle,
  pullRequestBody,
  instructionReports,
  publicationReport,
} from "../policy/development.mjs";

export function createInstructionRunner({
  repositoryPath,
  worktreeRoot,
  classifyRequest,
  runModel,
  runChecks,
  publishChange,
  registerCiWatch,
  logger = () => {},
}) {
  return async function runInstruction(request, { signal } = {}) {
    const identifier = sessionIdentifier(request.sessionKey);
    let publicationStarted = false;
    try {
      signal?.throwIfAborted();
      const kind = await classifyRequest({
        instruction: request.instruction,
        signal,
      });
      if (
        kind !== "implementation" &&
        kind !== "consultation" &&
        kind !== "continuation"
      ) {
        return {
          outcome: "answered",
          report: instructionReports.clarification,
        };
      }
      const worktree = await ensureSessionWorktree({
        repositoryPath,
        worktreeRoot,
        name: identifier,
        newTaskIdentifier:
          kind === "implementation" ? request.updateIdentifier : undefined,
      });
      if (
        kind === "continuation" &&
        (await listChangedPaths(worktree)).length === 0 &&
        !(await hasUnpublishedCommit(worktree))
      ) {
        return {
          outcome: "answered",
          report: instructionReports.clarification,
        };
      }
      const modelResult = await runModel({
        sessionIdentifier: identifier,
        sessionKey: request.sessionKey,
        instruction: request.instruction,
        kind,
        worktreePath: worktree.path,
        signal,
      });
      if (modelResult.preparationFailed) {
        return {
          outcome: "failed",
          report: instructionReports.preparationFailed,
        };
      }
      if (modelResult.timedOut) {
        logger("execution_timed_out", identifier);
        return { outcome: "failed", report: instructionReports.modelTimedOut };
      }
      signal?.throwIfAborted();
      if (modelResult.aborted) {
        return { outcome: "failed", report: instructionReports.aborted };
      }
      if (kind === "consultation") {
        return {
          outcome: "answered",
          report: modelResult.text.trim() || instructionReports.noAnswer,
        };
      }
      const changedPaths = await listChangedPaths(worktree);
      if (
        changedPaths.length === 0 &&
        !(await hasUnpublishedCommit(worktree))
      ) {
        return {
          outcome: "answered",
          report: modelResult.text.trim() || instructionReports.noAnswer,
        };
      }
      const summary = parseChangeSummary(modelResult.text);
      const title = fallbackTitle({ summary });
      const existingBranch = await currentBranch(worktree);
      const branch = existingBranch
        ? assertWorkBranch(existingBranch)
        : branchNameForChange({
            summary,
            updateIdentifier: request.updateIdentifier,
          });
      if (!existingBranch) {
        await createBranch({ worktree, branch });
      }
      const checks = await runChecks({
        sessionIdentifier: identifier,
        worktreePath: worktree.path,
        signal,
      });
      if (checks.timedOut) {
        return { outcome: "failed", report: instructionReports.checksTimedOut };
      }
      if (checks.exitCode !== 0) {
        logger("checks_failed", identifier);
        return { outcome: "failed", report: instructionReports.checksFailed };
      }
      signal?.throwIfAborted();
      await commitAll({ worktree, message: title });
      const body = pullRequestBody({
        title,
        changedPaths: await committedPaths(worktree),
      });
      publicationStarted = true;
      const publication = await publishChange({
        worktree,
        branch,
        title,
        body,
      });
      if (publication.refused) {
        logger("publication_refused", identifier);
        return {
          outcome: "failed",
          report: instructionReports.publicationRefused,
        };
      }
      // The watch is durable before the report is sent, and it never waits for
      // the CI of the commit: the queue keeps executing other instructions.
      const ciWatch = registerCiWatch?.({
        updateIdentifier: request.updateIdentifier,
        sessionKey: request.sessionKey,
        pullRequestNumber: publication.pullRequest.number,
        commit: publication.commit,
      });
      return {
        outcome: publication.created
          ? "pull_request_created"
          : "pull_request_updated",
        report: publicationReport({ ...publication, branch, ciWatch }),
      };
    } catch (error) {
      logger(
        "instruction_failed",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      );
      if (error instanceof SandboxCleanupError) {
        return {
          outcome: "uncertain",
          report: instructionReports.sandboxUncertain,
        };
      }
      if (publicationStarted) {
        return {
          outcome: "uncertain",
          report: instructionReports.publicationUncertain,
        };
      }
      return {
        outcome: "failed",
        report: signal?.aborted
          ? instructionReports.aborted
          : instructionReports.executionFailed,
      };
    }
  };
}
