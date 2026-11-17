// Coordinate one instruction. Model, checks and remote publication are supplied
// operations. This module has no container/GitHub transport or secret configuration.

import { sessionIdentifier } from "telegram-pi-bridge/sessions";
import { attachmentRefusalDetail } from "telegram-pi-bridge/telegram";
import { removeAttachmentDirectory } from "../attachments/destination.mjs";
import {
  assertWorkBranch,
  commitAll,
  createBranch,
  currentBranch,
  commitSubject,
  changeDiff,
  ensureSessionWorktree,
  findSessionWorktree,
  headCommit,
  listChangedPaths,
  committedPaths,
  hasUnpublishedCommit,
} from "../repository/worktrees.mjs";
import { parseMergeCommand } from "./merge-request.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";
import {
  attachmentAcceptedDetail,
  attachmentRefusalReport,
  attachmentReports,
  buildAttachmentInstruction,
  buildRepairInstruction,
  ciWatchOutcomes,
  continuationReports,
  parseChangeSummary,
  branchNameForChange,
  fallbackTitle,
  pullRequestBody,
  instructionReports,
  publicationReport,
  previewRequestKind,
  repairRequestKind,
} from "../policy/development.mjs";

export function createInstructionRunner({
  repositoryPath,
  worktreeRoot,
  classifyRequest,
  runModel,
  runChecks,
  publishChange,
  registerCiWatch,
  requestPreview,
  requestMerge,
  continueFromPullRequest,
  warnAboutOverlaps,
  prepareAttachment,
  recordTrace,
  logger = () => {},
}) {
  /**
   * A repair continues a published commit: the worktree and its branch must
   * already exist and stay at that commit. The service never creates, resets or
   * moves anything to repair a failure.
   */
  async function repairTarget(request, identifier, signal) {
    const worktree = await findSessionWorktree({
      repositoryPath,
      worktreeRoot,
      name: identifier,
      signal,
    });
    if (worktree === null) {
      return { report: instructionReports.repairWorktreeMissing };
    }
    const branch = await currentBranch(worktree, { signal });
    if (
      branch === null ||
      (await headCommit(worktree, { signal })) !== request.commit
    ) {
      return { report: instructionReports.repairCommitChanged };
    }
    // Leftovers of a later instruction (for example a failed check) are not
    // part of the failed commit and must never be committed by a repair.
    if ((await listChangedPaths(worktree, { signal })).length > 0) {
      return { report: instructionReports.repairWorktreeDirty };
    }
    signal?.throwIfAborted();
    return {
      worktree,
      branch,
      instruction: buildRepairInstruction({
        pullRequestNumber: request.pullRequestNumber,
        commit: request.commit,
        branch,
        changeSummary: await commitSubject(worktree, request.commit, {
          signal,
        }),
        failedChecks: request.failedChecks,
        evidence: request.evidence,
        diff: await changeDiff({ worktree, signal }),
      }),
    };
  }

  /**
   * Download, validate and place the attached image of an implementation or a
   * continuation. A refusal returns the report that tells the person why, and
   * the file is never used without its origin, rights and credit.
   */
  async function applyAttachment({
    attachment,
    instruction,
    request,
    worktreePath,
    signal,
  }) {
    const prepared = await prepareAttachment({
      attachment,
      worktreePath,
      signal,
    });
    if (prepared.refusal) {
      recordTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: "attachment_refused",
        detail: attachmentRefusalDetail(prepared.refusal),
      });
      return { report: attachmentRefusalReport(prepared.refusal) };
    }
    recordTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "attachment_accepted",
      detail: attachmentAcceptedDetail(prepared.prepared),
    });
    return {
      instruction: `${instruction}\n\n${buildAttachmentInstruction(prepared.prepared)}`,
    };
  }

  return async function runInstruction(request, { signal } = {}) {
    const identifier = sessionIdentifier(request.sessionKey);
    const repair = request.kind === repairRequestKind;
    const attachment = request.attachment ?? null;
    // Only an implementation and a continuation use an attached image. Every
    // other request ignores it, and its report says so in one sentence.
    const ignoringAttachment = (report) =>
      attachment === null ? report : `${report}\n${attachmentReports.ignored}`;
    let publicationStarted = false;
    try {
      signal?.throwIfAborted();
      // A merge is recognised from the literal command before the classifier,
      // so neither the classifier nor the model ever sees it. The internal
      // repair instruction is service text, never a person's command.
      const mergeCommand = repair
        ? null
        : parseMergeCommand(request.instruction);
      if (mergeCommand !== null) {
        const merged = await requestMerge(request, mergeCommand, { signal });
        return { ...merged, report: ignoringAttachment(merged.report) };
      }
      // Only the trusted internal repair request fixes its kind; every other
      // request is classified from its text.
      const kind = repair
        ? repairRequestKind
        : await classifyRequest({
            instruction: request.instruction,
            signal,
          });
      // A preview is decided by the service, never by the model: no worktree
      // is touched and no model run starts.
      if (kind === previewRequestKind) {
        const preview = await requestPreview(request, { signal });
        return { ...preview, report: ignoringAttachment(preview.report) };
      }
      if (
        kind !== "implementation" &&
        kind !== "consultation" &&
        kind !== "continuation" &&
        kind !== repairRequestKind
      ) {
        return {
          outcome: "answered",
          report: ignoringAttachment(instructionReports.clarification),
        };
      }
      const target = repair
        ? await repairTarget(request, identifier, signal)
        : null;
      if (target?.report) {
        return { outcome: "failed", report: target.report };
      }
      // A continuation that names another topic's pull request resumes that
      // pull request here. Null keeps the pending work of this same topic.
      const continuation =
        kind === "continuation" && !repair
          ? await continueFromPullRequest(request, { signal })
          : null;
      if (continuation?.report) {
        return { outcome: "answered", report: continuation.report };
      }
      const resumed = continuation?.resume ?? null;
      const resumedLine =
        resumed === null
          ? null
          : continuationReports.resumed({
              pullRequestNumber: resumed.pullRequestNumber,
              baseHeadSha: resumed.baseHeadSha,
            });
      let worktree;
      if (resumed !== null) {
        worktree = resumed.worktree;
      } else if (repair) {
        worktree = target.worktree;
      } else {
        worktree = await ensureSessionWorktree({
          repositoryPath,
          worktreeRoot,
          name: identifier,
          newTaskIdentifier:
            kind === "implementation" ? request.updateIdentifier : undefined,
          signal,
        });
      }
      if (
        kind === "continuation" &&
        resumed === null &&
        (await listChangedPaths(worktree, { signal })).length === 0 &&
        !(await hasUnpublishedCommit(worktree, { signal }))
      ) {
        return {
          outcome: "answered",
          report: ignoringAttachment(instructionReports.clarification),
        };
      }
      // The service writes the instruction of an automatic repair and of a
      // resumed pull request; every other request is the person's own text.
      let instruction = request.instruction;
      if (repair) {
        instruction = target.instruction;
      }
      if (resumed !== null) {
        instruction = resumed.instruction;
      }
      // The attachment reaches the model as service text appended to the
      // instruction: its path, its type and its dimensions, never its content.
      const kindUsesAttachment =
        kind === "implementation" || kind === "continuation";
      if (attachment !== null && kindUsesAttachment) {
        const applied = await applyAttachment({
          attachment,
          instruction,
          request,
          worktreePath: worktree.path,
          signal,
        });
        if (applied.report) {
          return { outcome: "failed", report: applied.report };
        }
        instruction = applied.instruction;
      }
      const modelResult = await runModel({
        sessionIdentifier: identifier,
        sessionKey: request.sessionKey,
        instruction,
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
          report: ignoringAttachment(
            modelResult.text.trim() || instructionReports.noAnswer,
          ),
        };
      }
      // Whatever the model moved is already outside this directory. Removing it
      // before the checks and the commit means a received image never reaches a
      // commit or a publication, even on a branch whose .gitignore lacks the
      // rule.
      removeAttachmentDirectory({ worktreePath: worktree.path });
      const changedPaths = await listChangedPaths(worktree, { signal });
      if (
        changedPaths.length === 0 &&
        !(await hasUnpublishedCommit(worktree, { signal }))
      ) {
        const answer = modelResult.text.trim() || instructionReports.noAnswer;
        return {
          outcome: "answered",
          report: resumedLine === null ? answer : `${resumedLine}\n${answer}`,
        };
      }
      const summary = parseChangeSummary(modelResult.text);
      const title = fallbackTitle({ summary });
      const existingBranch = repair
        ? target.branch
        : await currentBranch(worktree, { signal });
      const branch = existingBranch
        ? assertWorkBranch(existingBranch)
        : branchNameForChange({
            summary,
            updateIdentifier: request.updateIdentifier,
          });
      if (!existingBranch) {
        await createBranch({ worktree, branch, signal });
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
      // Only a change a person asked for warns about the work of other topics:
      // an automatic repair only fixes an already published commit. The warning
      // never blocks, so an error while computing it is logged and ignored.
      let overlapWarning = null;
      if (!repair) {
        try {
          overlapWarning =
            (await warnAboutOverlaps?.({
              updateIdentifier: request.updateIdentifier,
              sessionKey: request.sessionKey,
              worktree,
              branch,
              continuedPullRequestNumber: resumed?.pullRequestNumber,
              signal,
            })) ?? null;
        } catch (error) {
          logger(
            "overlap_warning_failed",
            error instanceof Error ? error.name : "unknown",
          );
        }
      }
      // A swallowed warning error never hides an abort: nothing is committed.
      signal?.throwIfAborted();
      await commitAll({ worktree, message: title, signal });
      const body = pullRequestBody({
        title,
        changedPaths: await committedPaths(worktree, { signal }),
      });
      // A repair and a resumed pull request only update the pull request they
      // continue: the publisher checks it is still open at that commit and
      // never opens a new one.
      let continuedPullRequest;
      if (repair) {
        continuedPullRequest = {
          pullRequestNumber: request.pullRequestNumber,
          commit: request.commit,
        };
      }
      if (resumed !== null) {
        continuedPullRequest = {
          pullRequestNumber: resumed.pullRequestNumber,
          commit: resumed.baseHeadSha,
        };
      }
      // The instruction only becomes possibly published when the publisher is
      // about to write to GitHub: a read of the pull request that fails before
      // the push is a local failure, never an unknown result.
      const publication = await publishChange({
        worktree,
        branch,
        title,
        body,
        repair: continuedPullRequest,
        signal,
        onPublicationStarted: () => {
          publicationStarted = true;
        },
      });
      if (publication.refused) {
        if (publication.readFailed) {
          logger("publication_read_failed", identifier);
          return {
            outcome: "failed",
            report: instructionReports.publicationReadFailed,
          };
        }
        logger("publication_refused", identifier);
        return {
          outcome: "failed",
          report: instructionReports.publicationRefused,
        };
      }
      // The watch is durable before the report is sent, and it never waits for
      // the CI of the commit: the queue keeps executing other instructions. A
      // repair reopens the watch of the instruction it continues, so the topic
      // follows the new commit in the same conversation slot.
      const ciWatch = registerCiWatch?.({
        updateIdentifier: request.updateIdentifier,
        sessionKey: request.sessionKey,
        pullRequestNumber: publication.pullRequest.number,
        commit: publication.commit,
        automatic: repair,
      });
      // The new topic owns the pull request only once its watch is durable: the
      // previous topic keeps the CI notices and is not told otherwise. A notice
      // that fails never changes the published result.
      let ownersMoved = false;
      if (resumed !== null) {
        ownersMoved = ciWatch === ciWatchOutcomes.registered;
        if (ownersMoved) {
          await resumed.notifyPublished({
            commit: publication.commit,
            signal,
          });
        } else {
          resumed.recordOwnerUnregistered(publication.commit);
        }
      }
      let publicationText = publicationReport({
        ...publication,
        branch,
        ciWatch,
      });
      if (resumedLine !== null) {
        publicationText = `${resumedLine}\n${publicationText}`;
      }
      if (resumed !== null && !ownersMoved) {
        publicationText = `${publicationText}\n${continuationReports.ownerUnregistered(
          { pullRequestNumber: resumed.pullRequestNumber },
        )}`;
      }
      if (overlapWarning !== null) {
        publicationText = `${publicationText}\n${overlapWarning}`;
      }
      // The publication happened, but no durable CI watch records it: an older
      // notice of the topic must not authorize anything from now on, so the
      // instruction ends unknown and a person reconciles it.
      if (ciWatch === ciWatchOutcomes.unavailable) {
        return {
          outcome: "uncertain",
          report: `${publicationText}\n${instructionReports.ciWatchUnavailable}`,
        };
      }
      return {
        outcome: publication.created
          ? "pull_request_created"
          : "pull_request_updated",
        report: publicationText,
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
