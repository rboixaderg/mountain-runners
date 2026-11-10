// Coordinate one instruction. Model, checks and remote publication are supplied
// operations. This module has no Docker/GitHub transport or secret configuration.

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
  logger = () => {},
}) {
  return async function runInstruction(request, { signal } = {}) {
    signal?.throwIfAborted();
    const kind = await classifyRequest({
      instruction: request.instruction,
      signal,
    });
    if (kind !== "implementation" && kind !== "consultation") {
      return { outcome: "answered", report: instructionReports.clarification };
    }
    const identifier = sessionIdentifier(request.sessionKey);
    const worktree = await ensureSessionWorktree({
      repositoryPath,
      worktreeRoot,
      name: identifier,
    });
    const modelResult = await runModel({
      sessionIdentifier: identifier,
      sessionKey: request.sessionKey,
      instruction: request.instruction,
      kind,
      worktreePath: worktree.path,
      signal,
    });
    if (modelResult.timedOut) {
      logger("execution_timed_out", identifier);
      return { outcome: "uncertain", report: instructionReports.modelTimedOut };
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
    if (changedPaths.length === 0 && !(await hasUnpublishedCommit(worktree))) {
      return {
        outcome: "answered",
        report: modelResult.text.trim() || instructionReports.noAnswer,
      };
    }
    const summary = parseChangeSummary(modelResult.text);
    const title = fallbackTitle({ summary, instruction: request.instruction });
    const existingBranch = await currentBranch(worktree);
    const branch = existingBranch
      ? assertWorkBranch(existingBranch)
      : branchNameForChange({
          summary,
          instruction: request.instruction,
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
      return {
        outcome: "uncertain",
        report: instructionReports.checksTimedOut,
      };
    }
    if (checks.exitCode !== 0) {
      logger("checks_failed", identifier);
      return { outcome: "failed", report: instructionReports.checksFailed };
    }
    signal?.throwIfAborted();
    await commitAll({ worktree, message: title });
    const publication = await publishChange({
      worktree,
      branch,
      title,
      body: pullRequestBody({
        title,
        changedPaths: await committedPaths(worktree),
      }),
    });
    if (publication.refused) {
      logger("publication_refused", identifier);
      return {
        outcome: "failed",
        report: instructionReports.publicationRefused,
      };
    }
    return {
      outcome: publication.created
        ? "pull_request_created"
        : "pull_request_updated",
      report: publicationReport({ ...publication, branch }),
    };
  };
}
