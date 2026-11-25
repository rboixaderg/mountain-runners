// Coordinate one instruction. Model, checks and remote publication are supplied
// operations. This module has no container/GitHub transport or secret configuration.
//
// Every ordinary instruction runs a writable turn in its topic; /merge and the
// merge confirmation keep their own path.
// The turn receives service effects the topic has not been told yet.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { PiRunError } from "telegram-pi-bridge/pi";
import { sessionIdentifier } from "telegram-pi-bridge/sessions";
import { attachmentRefusalDetail } from "telegram-pi-bridge/telegram";
import { removeAttachmentDirectory } from "../attachments/destination.mjs";
import { needsDownscale } from "../attachments/scale.mjs";
import {
  assertWorkBranch,
  commitAll,
  createBranch,
  currentBranch,
  changedPathsAgainstMain,
  ensureSessionWorktree,
  findSessionWorktree,
  headCommit,
  listChangedPaths,
  listWorkingTreeChanges,
  fetchMainHead,
  committedPaths,
  hasUnpublishedCommit,
  publishedCommit,
  synchronizeWithMain,
  fastForwardPublishedBranch,
  fetchPublishedBranch,
  mergeCommitIntoBranch,
  restartConflictMerge,
  abortConflictMerge,
  commitConflictMerge,
  addsOnlyMainMerges,
  restoreCommit,
  mergeInProgressHead,
  abortInterruptedMainMerge,
  MergeCleanupError,
  NestedRepositoryError,
} from "../repository/worktrees.mjs";
import { ignoreSubmodules, runGit } from "../repository/trusted-git.mjs";
import { parseMergeCommand } from "./merge-request.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";
import {
  attachmentAcceptedDetail,
  attachmentRefusalReport,
  answerWithNotices,
  attachmentReports,
  buildAttachmentsInstruction,
  buildConflictInstruction,
  conflictResolvedMarker,
  checkCommandForPaths,
  checkFailureDetail,
  namedPaths,
  publicationRefusalDetail,
  ciWatchOutcomes,
  mergeSynchronizationReports,
  parseChangeSummary,
  branchNameForChange,
  fallbackTitle,
  pullRequestBody,
  failedMaintainerNotice,
  finishedTopicReport,
  ciWatchUnavailableReason,
  instructionReportKeys,
  instructionReports,
  unknownFailureReason,
  maintainerAttentionAction,
  maximumPromptImageBytes,
  publicationNoteText,
  publicationReport,
  pendingWorkCommitMessage,
  stripChangeSummary,
  turnOutcomes,
} from "../policy/development.mjs";

const maximumSynchronizations = 3;

// Publishes the reviewed private candidate of the topic without a model turn.
const publishReviewedCommand = "/publica-revisio";

// What the publisher answered once the cycle ended on a settled `main`.
const publicationResults = Object.freeze({
  published: "published",
  unconfirmed: "unconfirmed",
  reviewRequired: "review_required",
  readFailed: "read_failed",
  refused: "refused",
});

// The failures after which the service cannot tell what happened.
const uncertainReasons = new Set([
  instructionReportKeys.mergeCleanupUncertain,
  instructionReportKeys.sandboxUncertain,
  instructionReportKeys.publicationUncertain,
]);

// The offline preparation cannot read a manifest or lockfile that holds
// conflict markers.
const dependencyManifestPattern =
  /(?:^|\/)(?:package\.json|pnpm-[^/]+\.yaml)$/u;

function failureReport(reason) {
  return { report: instructionReports[reason], reason };
}

function failedResult(reason) {
  return { outcome: turnOutcomes.failed, ...failureReport(reason) };
}

function uncertainResult(reason) {
  return { outcome: turnOutcomes.uncertain, ...failureReport(reason) };
}

function classifyPublication(publication) {
  if (publication.unconfirmed) {
    return publicationResults.unconfirmed;
  }
  if (!publication.refused) {
    return publicationResults.published;
  }
  if (publication.reviewId) {
    return publicationResults.reviewRequired;
  }
  if (publication.readFailed) {
    return publicationResults.readFailed;
  }
  return publicationResults.refused;
}

function privateReviewText({ worktreeName, reviewId }) {
  return `El canvi no s'ha publicat. Cal una revisió privada abans del push.\nFeina: ${worktreeName}\nRevisió: ${reviewId}`;
}

// The reason of an error that ended an instruction. The order matters: an
// unconfirmed cleanup wins over the publication state and over a stop.
function errorReason(error, { signal, publicationStarted }) {
  if (error instanceof MergeCleanupError) {
    return instructionReportKeys.mergeCleanupUncertain;
  }
  if (error instanceof SandboxCleanupError) {
    return instructionReportKeys.sandboxUncertain;
  }
  if (publicationStarted) {
    return instructionReportKeys.publicationUncertain;
  }
  // A local refusal before any publication: the worktree stays as it is.
  if (error instanceof NestedRepositoryError) {
    return instructionReportKeys.publicationRefused;
  }
  return signal?.aborted
    ? instructionReportKeys.aborted
    : instructionReportKeys.executionFailed;
}

function piRunDiagnostics(diagnostics) {
  if (diagnostics?.reason === "output_limit") {
    return { reason: "output_limit" };
  }
  if (diagnostics?.reason === "premature_exit") {
    return {
      reason: "premature_exit",
      exitCode:
        typeof diagnostics.exitCode === "number" ? diagnostics.exitCode : null,
      signal:
        typeof diagnostics.signal === "string" ? diagnostics.signal : null,
    };
  }
  return { reason: "unknown" };
}

export function createInstructionRunner({
  repositoryPath,
  worktreeRoot,
  identifiers,
  runModel,
  runChecks,
  publishChange,
  // Live credentials, redacted from the check output a note keeps.
  secrets,
  registerCiWatch,
  // Follows the preview of every commit the service publishes.
  followPreview,
  requestMerge,
  requestMergeConfirmation,
  research,
  prepareResearchJob,
  isResearchAffected,
  // The commit the current private review of a job pins, or null.
  reviewedCommit,
  prepareAttachment,
  scaleAttachments,
  attachmentStore,
  // Durable conversation state of the topic: the effects it has not been told
  // yet.
  sessionNotes,
  topicJobs,
  readBoundPullRequest,
  repositoryName,
  // The state of the topic every turn receives, read from the same stores. The
  // model cannot read it from the sandbox.
  readTopicState,
  recordTrace = () => {},
  logger = () => {},
}) {
  /**
   * What happens to the effects a turn claimed: they are delivered when the
   * prompt was written (it may have reached Pi), and undelivered again when it
   * never was. The result of the instruction is not affected.
   */
  function settleClaimedNotes({ claimedNotes, promptSent }) {
    if (claimedNotes === null) {
      return;
    }
    if (promptSent) {
      safelyWithNotes(() => sessionNotes.deliver(claimedNotes));
    } else {
      safelyWithNotes(() => sessionNotes.release(claimedNotes));
    }
  }

  /**
   * The notes are bookkeeping of the service: a failure to read or write them
   * never changes the result of an instruction nor loses a published effect.
   */
  function safelyWithNotes(operation) {
    try {
      return operation();
    } catch (error) {
      logger(
        "session_note_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return null;
    }
  }

  /**
   * The state of the topic the model cannot read inside the sandbox. A state
   * that cannot be read never stops a turn: it is logged and the turn runs
   * without the block.
   */
  async function topicStateOf(
    sessionKey,
    { continuedPullRequestNumber, signal },
  ) {
    try {
      return await readTopicState(sessionKey, {
        continuedPullRequestNumber,
        signal,
      });
    } catch (error) {
      logger(
        "topic_state_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return null;
    }
  }

  /**
   * The worktree of the topic and whether it keeps work the service has not
   * published. Read-only: no fetch and no worktree creation.
   */
  async function readTopicWorktree(worktreeName, { signal } = {}) {
    const worktree = await findSessionWorktree({
      repositoryPath,
      worktreeRoot,
      name: worktreeName,
      signal,
    });
    if (worktree === null) {
      return { worktree: null, pendingWork: false };
    }
    if ((await listChangedPaths(worktree, { signal })).length > 0) {
      return { worktree, pendingWork: true };
    }
    return {
      worktree,
      pendingWork: await hasUnpublishedCommit(worktree, { signal }),
    };
  }

  /**
   * Download, validate, downscale inside the sandbox and store the images of an
   * implementation or a continuation. The topic keeps them until they are used
   * or for seven days; this turn receives a copy in the ignored directory of
   * the worktree and the new ones as image input of the prompt.
   */
  async function applyAttachments({
    attachments,
    instruction,
    request,
    worktree,
    worktreeName,
    signal,
  }) {
    const preparedImages = [];
    for (const attachment of attachments) {
      const prepared = await prepareAttachment({
        attachment,
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
      preparedImages.push(prepared.image);
    }

    let finalImages = preparedImages;
    let scaledInSandbox = false;
    if (preparedImages.some(needsDownscale)) {
      const scaled = await scaleAttachments({
        images: preparedImages,
        worktreePath: worktree.path,
        sandboxIdentifier: worktreeName,
        signal,
      });
      if (scaled.refusal) {
        recordTrace({
          updateIdentifier: request.updateIdentifier,
          authorIdentifier: request.authorIdentifier,
          sessionKey: request.sessionKey,
          action: "attachment_refused",
          detail: attachmentRefusalDetail(scaled.refusal),
        });
        return { report: attachmentRefusalReport(scaled.refusal) };
      }
      finalImages = scaled.images;
      scaledInSandbox = true;
    }

    const newNames = [];
    const images = [];
    const omittedImageNames = [];
    let promptImageBytes = 0;
    for (const image of finalImages) {
      const stored = attachmentStore.add(worktreeName, image);
      newNames.push(stored.name);
      // One prompt line carries all the images: keep the whole request bounded.
      if (promptImageBytes + image.bytes.length <= maximumPromptImageBytes) {
        images.push({
          type: "image",
          data: image.bytes.toString("base64"),
          mimeType: image.mimeType,
        });
        promptImageBytes += image.bytes.length;
      } else {
        omittedImageNames.push(stored.name);
      }
      recordTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: "attachment_accepted",
        detail: attachmentAcceptedDetail({
          type: stored.type,
          width: stored.width,
          height: stored.height,
          bytes: stored.bytes,
        }),
      });
    }

    const stored = attachmentStore.stage(worktreeName, worktree.path);
    if (stored.length === 0) {
      return { attachments: [], images: [], instruction };
    }
    return {
      attachments: stored,
      images,
      scaledInSandbox,
      instruction: `${instruction}\n\n${buildAttachmentsInstruction({
        attachments: stored,
        newNames,
        omittedImageNames,
      })}`,
    };
  }

  async function matchesPublishedHead(worktree, remoteHead, signal) {
    const localHead = await headCommit(worktree, { signal });
    if (localHead === remoteHead) {
      return true;
    }
    if (
      publishedCommit(worktree) !== remoteHead ||
      !(await hasUnpublishedCommit(worktree, { signal }))
    ) {
      return false;
    }
    const mergeBase = await runGit(
      worktree,
      ["merge-base", localHead, remoteHead],
      {
        allowFailure: true,
        signal,
      },
    );
    return mergeBase.trim() === remoteHead;
  }

  async function checkWorktree({
    worktree,
    worktreeName,
    checkCommand,
    signal,
  }) {
    const started = performance.now();
    const checks = await runChecks({
      sandboxIdentifier: worktreeName,
      worktreePath: worktree.path,
      checkCommand,
      signal,
    });
    if (
      checks.timedOut ||
      checks.outputLimitExceeded ||
      checks.exitCode !== 0
    ) {
      let reason = "nonzero_exit";
      if (checks.outputLimitExceeded) reason = "output_limit";
      if (checks.timedOut) reason = "timeout";
      if (signal?.aborted) reason = "cancelled";
      logger("checks_failed", {
        reason,
        exitCode: checks.exitCode,
        signal: checks.signal ?? null,
        durationMs: Math.round(performance.now() - started),
      });
    }
    // An abort stops the sandbox with a failing exit code: it is never a
    // failed check.
    signal?.throwIfAborted();
    if (checks.timedOut) {
      return failureReport(instructionReportKeys.checksTimedOut);
    }
    if (checks.outputLimitExceeded || checks.exitCode !== 0) {
      return {
        ...failureReport(instructionReportKeys.checksFailed),
        detail: checkFailureDetail({ checkCommand, checks, secrets }),
      };
    }
    return null;
  }

  /**
   * The model resolves a text conflict inside the sandbox. A binary conflict
   * never reaches it, and the result is accepted only when the model touched
   * nothing but the conflicted paths. A resolution that is unsafe or needs a
   * decision is rolled back; the question of the model, if any, is returned so
   * the person can answer it.
   */
  async function resolveConflict({
    worktree,
    worktreeName,
    sessionIdentifier,
    sessionKey,
    paths,
    headSha,
    topicState,
    fromMain = false,
    personMessage,
    signal,
  }) {
    const unresolved = { resolved: false, clarification: null };
    const restarted = await restartConflictMerge({
      worktree,
      headSha,
      expectedPaths: paths,
      signal,
    });
    if (!restarted) {
      return unresolved;
    }
    let mergeInProgress = true;
    let untrackedBefore = null;
    try {
      const binaryDiff = await runGit(
        worktree,
        [
          "--literal-pathspecs",
          "diff",
          "--numstat",
          "-z",
          "HEAD",
          headSha,
          "--",
          ...paths,
        ],
        { signal },
      );
      if (binaryDiff.split("\0").some((entry) => entry.startsWith("-\t-\t"))) {
        return unresolved;
      }
      const before = await listWorkingTreeChanges(worktree, { signal });
      untrackedBefore = before.untracked;
      const resolution = await runModel({
        sessionIdentifier,
        sandboxIdentifier: worktreeName,
        sessionKey,
        instruction: buildConflictInstruction(paths, {
          fromMain,
          personMessage,
        }),
        images: [],
        attachments: [],
        // The merge may bring a new lockfile: the turn prepares the
        // dependencies again unless a conflicted manifest makes that fail.
        worktreePrepared: paths.some((path) =>
          dependencyManifestPattern.test(path),
        ),
        topicState,
        // The conflict turn is internal: it must not consume the service notes
        // that belong to the next turn of the person.
        claimServiceNotes: () => [],
        onPromptSent: () => {},
        worktreePath: worktree.path,
        signal,
      });
      if (
        resolution.timedOut ||
        resolution.aborted ||
        resolution.preparationFailed ||
        resolution.errorMessage
      ) {
        return unresolved;
      }
      signal?.throwIfAborted();
      const after = await listWorkingTreeChanges(worktree, { signal });
      const outsideConflict =
        after.modified.some((path) => !paths.includes(path)) ||
        after.untracked.some((path) => !before.untracked.includes(path));
      if (outsideConflict) {
        return unresolved;
      }
      const answerLines = (resolution.text ?? "").trim().split("\n");
      const clarification = {
        resolved: false,
        clarification:
          stripChangeSummary(
            answerLines
              .filter((line) => line.trim() !== conflictResolvedMarker)
              .join("\n"),
          ).trim() || null,
      };
      // Markers already removed are not enough: the model must say it resolved.
      if (answerLines.at(-1).trim() !== conflictResolvedMarker) {
        return clarification;
      }
      try {
        await runGit(
          worktree,
          [
            "--literal-pathspecs",
            "diff",
            "--check",
            ignoreSubmodules,
            "MERGE_HEAD",
            "--",
            ...paths,
          ],
          { signal },
        );
      } catch {
        signal?.throwIfAborted();
        return unresolved;
      }
      if (!(await commitConflictMerge({ worktree, signal }))) {
        return unresolved;
      }
      mergeInProgress = false;
      return { resolved: true };
    } finally {
      if (mergeInProgress) {
        await abortConflictMerge(worktree);
        await removeNewUntrackedPaths(worktree, untrackedBefore);
      }
    }
  }

  /**
   * `git merge --abort` keeps untracked files. After a rejected internal turn
   * only the paths that were not there when it started are removed, so the next
   * turn can never commit them and nothing that existed before is touched.
   */
  async function removeNewUntrackedPaths(worktree, untrackedBefore) {
    if (untrackedBefore === null) {
      return;
    }
    try {
      const { untracked } = await listWorkingTreeChanges(worktree);
      for (const path of untracked) {
        if (!untrackedBefore.includes(path)) {
          rmSync(join(worktree.path, path), { force: true, recursive: true });
        }
      }
    } catch (error) {
      throw new MergeCleanupError({ cause: error });
    }
  }

  /**
   * Integrate the verified `main`, checkpoint the work in a commit and run the
   * local gate on that exact state. The gate is chosen from the paths the
   * synchronized branch publishes against the verified `main` commit, so a
   * change outside the content never falls back to the fast gate. A branch that
   * already contains `main` adds no merge commit. The gate must leave the
   * worktree clean: nothing it writes is ever committed or published.
   */
  async function synchronizeAndCheck({
    worktree,
    worktreeName,
    sessionIdentifier,
    sessionKey,
    title,
    topicState,
    fetchedMainHead,
    signal,
  }) {
    const synchronization = await synchronizeWithMain({
      worktree,
      pendingWorkMessage: title,
      fetchedMainHead,
      signal,
    });
    const { mainHead } = synchronization;
    if (synchronization.conflict) {
      const resolved = await resolveConflict({
        worktree,
        worktreeName,
        sessionIdentifier,
        sessionKey,
        paths: synchronization.paths,
        headSha: mainHead,
        topicState,
        fromMain: true,
        signal,
      });
      if (!resolved.resolved) {
        return {
          report: resolved.clarification ?? instructionReports.checksFailed,
          reason: instructionReportKeys.checksFailed,
          modelAnswer: resolved.clarification !== null,
          ...(resolved.clarification === null
            ? {
                detail: `The merge with main has conflicts that were not resolved: ${namedPaths(synchronization.paths, secrets)}.`,
              }
            : {}),
        };
      }
    }
    await commitAll({ worktree, message: title, signal });
    const commit = await headCommit(worktree, { signal });
    const checkCommand = checkCommandForPaths(
      await changedPathsAgainstMain(worktree, { base: mainHead, signal }),
    );
    const checkReport = await checkWorktree({
      worktree,
      worktreeName,
      checkCommand,
      signal,
    });
    if (checkReport !== null) {
      return checkReport;
    }
    const leftover = await listChangedPaths(worktree, { signal });
    if (
      leftover.length > 0 ||
      (await headCommit(worktree, { signal })) !== commit
    ) {
      return {
        ...failureReport(instructionReportKeys.checksFailed),
        detail:
          leftover.length > 0
            ? `Local check \`${checkCommand}\` left uncommitted changes: ${namedPaths(leftover, secrets)}.`
            : `Local check \`${checkCommand}\` moved the branch head.`,
      };
    }
    return { checkCommand, mainHead, commit };
  }

  /**
   * Synchronize, gate and publish as one bounded cycle. The publisher pins the
   * synchronized commit and the `main` it was validated against; when it finds
   * a newer `main` before any remote write (`baseChanged`), the cycle starts
   * again from the synchronization, so the gate always runs on the base that is
   * pushed.
   */
  async function publishSynchronized({
    synchronization,
    publication,
    unsettledReport,
    onPublicationStarted,
    signal,
  }) {
    for (let attempt = 0; attempt < maximumSynchronizations; attempt += 1) {
      const synchronized = await synchronizeAndCheck(
        // A later attempt follows a newer `main`, so it is fetched again.
        attempt === 0
          ? synchronization
          : { ...synchronization, fetchedMainHead: undefined },
      );
      if (synchronized.report) {
        return { failure: synchronized };
      }
      const { worktree, title } = synchronization;
      const { commit } = synchronized;
      const result = await publishChange({
        worktree,
        branch: publication.branch,
        title,
        body: pullRequestBody({
          title,
          changedPaths: await committedPaths(worktree, { signal }),
          checkCommand: synchronized.checkCommand,
        }),
        repair: publication.repair,
        validated: { commit, base: synchronized.mainHead },
        researchJobId: publication.researchJobId,
        signal,
        onPublicationStarted,
      });
      if (!result.baseChanged) {
        return { synchronized, commit, publication: result };
      }
    }
    return { failure: unsettledReport };
  }

  // Reads the pull request bound to the topic and accepts it only when it is
  // an open, non-draft pull request of this repository on the branch the topic
  // owns. Returns the pull request or the plain report of the refusal.
  async function readValidBoundPullRequest({ binding, topic, signal }) {
    let pullRequest;
    try {
      pullRequest = await readBoundPullRequest(binding.pullRequestNumber, {
        signal,
      });
    } catch {
      signal?.throwIfAborted();
      return failureReport(instructionReportKeys.publicationReadFailed);
    }
    if (pullRequest.state === "closed") {
      return { report: finishedTopicReport };
    }
    if (
      topic.worktree === null ||
      (await currentBranch(topic.worktree, { signal })) !== binding.branch
    ) {
      return failureReport(instructionReportKeys.topicWorktreeMismatch);
    }
    if (
      pullRequest.state !== "open" ||
      pullRequest.draft ||
      pullRequest.baseRef !== "main" ||
      pullRequest.headRepository?.toLowerCase() !==
        repositoryName.toLowerCase() ||
      pullRequest.headRef !== binding.branch
    ) {
      return failureReport(instructionReportKeys.pullRequestNotContinuable);
    }
    return { pullRequest };
  }

  // Brings the topic worktree to the head of its pull request. Returns null, or
  // the failure when the worktree cannot follow it and the turn must not start.
  async function followBoundPullRequest({
    binding,
    topic,
    pullRequest,
    sessionKey,
    personMessage,
    worktreeName,
    sessionIdentifier,
    signal,
  }) {
    if (
      await matchesPublishedHead(topic.worktree, pullRequest.headSha, signal)
    ) {
      return null;
    }
    if (!topic.pendingWork) {
      const forwarded = await fastForwardPublishedBranch({
        worktree: topic.worktree,
        branch: binding.branch,
        headSha: pullRequest.headSha,
        signal,
      });
      return forwarded
        ? null
        : failureReport(instructionReportKeys.pullRequestHeadNotFollowed);
    }
    return mergeMovedPullRequestHead({
      binding,
      worktree: topic.worktree,
      pullRequest,
      sessionKey,
      personMessage,
      worktreeName,
      sessionIdentifier,
      signal,
    });
  }

  // Keeps the pending work in a commit and merges the moved pull request head
  // into the branch, only when both descend from the last published commit.
  // A conflict goes to the model; nothing is ever force-pushed.
  async function mergeMovedPullRequestHead({
    binding,
    worktree,
    pullRequest,
    sessionKey,
    personMessage,
    worktreeName,
    sessionIdentifier,
    signal,
  }) {
    const previousHead = publishedCommit(worktree);
    const fetched = await fetchPublishedBranch({
      worktree,
      branch: binding.branch,
      headSha: pullRequest.headSha,
      signal,
    });
    const notFollowed = failureReport(
      instructionReportKeys.pullRequestHeadNotFollowed,
    );
    if (!fetched || previousHead === null) {
      return notFollowed;
    }
    const remoteBase = (
      await runGit(
        worktree,
        ["merge-base", previousHead, pullRequest.headSha],
        { signal, allowFailure: true },
      )
    ).trim();
    const localBase = (
      await runGit(worktree, ["merge-base", previousHead, "HEAD"], {
        signal,
        allowFailure: true,
      })
    ).trim();
    if (remoteBase !== previousHead || localBase !== previousHead) {
      return notFollowed;
    }
    removeAttachmentDirectory({ worktreePath: worktree.path });
    await commitAll({
      worktree,
      message: pendingWorkCommitMessage,
      signal,
    });
    const merged = await mergeCommitIntoBranch({
      worktree,
      headSha: pullRequest.headSha,
      signal,
    });
    if (!merged.conflict) {
      return null;
    }
    const conflictState = await topicStateOf(sessionKey, {
      continuedPullRequestNumber: binding.pullRequestNumber,
      signal,
    });
    const resolution = await resolveConflict({
      worktree,
      worktreeName,
      sessionIdentifier,
      sessionKey,
      paths: merged.paths,
      headSha: pullRequest.headSha,
      topicState: conflictState,
      // This turn runs before the one of the person, whose message may answer
      // the question an earlier attempt asked.
      personMessage,
      signal,
    });
    if (resolution.resolved) {
      return null;
    }
    return resolution.clarification === null
      ? notFollowed
      : { report: resolution.clarification, modelAnswer: true };
  }

  function noteMaintainerAttention({ request, reason }) {
    try {
      recordTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: maintainerAttentionAction,
        detail: reason,
      });
    } catch (error) {
      logger("trace_failed", error instanceof Error ? error.name : "unknown");
    }
    logger(maintainerAttentionAction, reason);
  }

  function failureResult(error, { signal, publicationStarted }) {
    if (error instanceof PiRunError) {
      logger("pi_rpc_failed", piRunDiagnostics(error.diagnostics));
    } else {
      logger(
        "instruction_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    const reason = errorReason(error, { signal, publicationStarted });
    if (uncertainReasons.has(reason)) {
      return uncertainResult(reason);
    }
    if (reason === instructionReportKeys.publicationRefused) {
      return {
        ...failedResult(reason),
        detail: publicationRefusalDetail(
          "The worktree contains a nested Git repository or submodule. Remove it.",
        ),
      };
    }
    return failedResult(reason);
  }

  /**
   * What follows every confirmed publication, ordinary or merge
   * synchronization. The publisher has already recorded the published commit;
   * on a new pull request it has also tried to set the preview label.
   */
  function followUpPublication({
    request,
    publication,
    branch,
    usedAttachmentNames = [],
    mergeSynchronization = false,
  }) {
    // Record the first confirmed publication. An existing binding is never
    // replaced: later turns of the topic continue its recorded branch.
    if (topicJobs.bindingOf(request.sessionKey) === null) {
      topicJobs.bind({
        sessionKey: request.sessionKey,
        branch,
        pullRequestNumber: publication.pullRequest.number,
      });
    }
    closeUsedAttachments(request, usedAttachmentNames);
    // The watch is durable before the report is sent, and it never waits for
    // the CI of the commit: the queue keeps executing other instructions.
    const ciWatch = registerCiWatch({
      updateIdentifier: request.updateIdentifier,
      sessionKey: request.sessionKey,
      pullRequestNumber: publication.pullRequest.number,
      commit: publication.commit,
    });
    // The `preview` label makes the publisher build every pushed head, so the
    // topic receives the address of this commit without asking for it. A
    // pull request without the label simply has no preview to report.
    const previewTracked = followPreview({
      updateIdentifier: request.updateIdentifier,
      sessionKey: request.sessionKey,
      authorIdentifier: request.authorIdentifier,
      pullRequestNumber: publication.pullRequest.number,
      commit: publication.commit,
      ...(mergeSynchronization ? { mergeSynchronization } : {}),
    });
    return { ciWatch, previewTracked };
  }

  // An image is used only once the publication is confirmed: a refused or
  // unknown publication keeps it in the topic store for the next turn.
  function closeUsedAttachments(request, usedAttachmentNames) {
    if (usedAttachmentNames.length === 0) {
      return;
    }
    recordTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "attachment_used",
      detail: usedAttachmentNames.join(","),
    });
    // The publication is already done, so a bookkeeping failure only logs.
    try {
      attachmentStore.remove(
        identifiers.worktreeName(request.sessionKey),
        usedAttachmentNames,
      );
    } catch (error) {
      logger(
        "attachment_store_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  // The state one ordinary turn shares between its phases and its failure
  // handling.
  function createTurn(request, signal) {
    return {
      request,
      signal,
      // The Pi session file keeps the session identifier: it lives outside the
      // sandbox. Every name the sandbox can read is opaque.
      piSessionIdentifier: sessionIdentifier(request.sessionKey),
      worktreeName: identifiers.worktreeName(request.sessionKey),
      changeSuffix: identifiers.changeSuffix(request.updateIdentifier),
      publishReviewed: request.instruction === publishReviewedCommand,
      publicationStarted: false,
      // The model's answer, which a later failure of the checks or of the
      // publication still delivers.
      answer: "",
      // The worktree whose ignored attachment directory this turn staged, so the
      // copy disappears even when the model fails, times out or is aborted.
      stagedAttachmentPath: null,
    };
  }

  // A merge command ignores an attached image and says so.
  async function runMergeCommand(request, mergeCommand, { signal }) {
    const merged = await requestMerge(request, mergeCommand, { signal });
    if ((request.attachments ?? []).length === 0) {
      return merged;
    }
    return {
      ...merged,
      report: `${merged.report}\n${attachmentReports.ignored}`,
    };
  }

  // The worktree of the turn and, on a topic bound to a pull request, the
  // exact head this turn continues.
  async function prepareTopic(turn) {
    const { request, worktreeName, signal } = turn;
    const topic = await readTopicWorktree(worktreeName, { signal });
    const binding = topicJobs.bindingOf(request.sessionKey);
    // The topic state decides whether the job is new. A queue row that never
    // reached a turn (rejected, merge or confirmation) leaves none.
    prepareResearchJob(worktreeName, {
      newJob: !topic.worktree && binding === null,
    });
    if (turn.publishReviewed && !isResearchAffected(worktreeName)) {
      return {
        endedWith: {
          outcome: turnOutcomes.answered,
          report: "Aquesta feina no té cap revisió de recerca pendent.",
        },
      };
    }
    if (binding !== null) {
      return continueBoundTopic(turn, { binding, topic });
    }
    const worktree = await ensureSessionWorktree({
      repositoryPath,
      worktreeRoot,
      name: worktreeName,
      signal,
    });
    return { worktree, continuedPullRequest: undefined };
  }

  async function continueBoundTopic(turn, { binding, topic }) {
    const { request, signal } = turn;
    const bound = await readValidBoundPullRequest({ binding, topic, signal });
    if (bound.report) {
      return { endedWith: { outcome: turnOutcomes.failed, ...bound } };
    }
    const notFollowed = await followBoundPullRequest({
      binding,
      topic,
      pullRequest: bound.pullRequest,
      sessionKey: request.sessionKey,
      personMessage: request.instruction,
      worktreeName: turn.worktreeName,
      sessionIdentifier: turn.piSessionIdentifier,
      signal,
    });
    if (notFollowed !== null) {
      return { endedWith: { outcome: turnOutcomes.failed, ...notFollowed } };
    }
    // A resumed pull request and a continuation that happens in place only
    // update that exact pull request: the publisher revalidates it before the
    // push and never opens another one.
    return {
      worktree: topic.worktree,
      continuedPullRequest: {
        pullRequestNumber: binding.pullRequestNumber,
        commit: bound.pullRequest.headSha,
      },
    };
  }

  // The prompt of the turn, with the stored and new images of the topic.
  async function prepareModelInput(turn, { worktree, instruction }) {
    const attachments = turn.request.attachments ?? [];
    const withoutAttachments = {
      instruction,
      attachments: [],
      images: [],
      worktreePrepared: false,
    };
    if (turn.publishReviewed) {
      return withoutAttachments;
    }
    if (
      attachments.length === 0 &&
      attachmentStore.list(turn.worktreeName).length === 0
    ) {
      return withoutAttachments;
    }
    turn.stagedAttachmentPath = worktree.path;
    const applied = await applyAttachments({
      attachments,
      instruction,
      request: turn.request,
      worktree,
      worktreeName: turn.worktreeName,
      signal: turn.signal,
    });
    if (applied.report) {
      return {
        endedWith: { outcome: turnOutcomes.failed, report: applied.report },
      };
    }
    return {
      instruction: applied.instruction,
      attachments: applied.attachments,
      images: applied.images,
      worktreePrepared: applied.scaledInSandbox === true,
    };
  }

  async function runModelTurn(
    turn,
    { worktree, input, topicState, resumedResearch },
  ) {
    if (turn.publishReviewed) {
      return { modelResult: { text: "" }, webTurn: undefined };
    }
    const { request, worktreeName, signal } = turn;
    // The effects of the service are claimed at the one point where the turn
    // really starts: the sandbox and the profile are ready and Pi is about to
    // receive the prompt. A preparation that never reached the model leaves
    // them undelivered. Once claimed, they are returned only when the prompt
    // was never written: `onPromptSent` is that fact, so it holds even when a
    // cleanup failure wins over an error of the launch or of the stop.
    let claimedNotes = null;
    let promptSent = false;
    const claimServiceNotes = () => {
      if (claimedNotes === null) {
        claimedNotes =
          safelyWithNotes(() => sessionNotes.claim(request.sessionKey)) ?? [];
      }
      return claimedNotes.map((note) => note.text);
    };
    const webTurn = research?.turn(request, {
      worktreeName,
      signal,
      resumedResearch,
    });
    try {
      const modelResult = await runModel({
        sessionIdentifier: turn.piSessionIdentifier,
        sandboxIdentifier: worktreeName,
        sessionKey: request.sessionKey,
        instruction: input.instruction,
        images: input.images,
        attachments: input.attachments,
        worktreePrepared: input.worktreePrepared,
        webResearch: webTurn?.tool,
        topicState,
        claimServiceNotes,
        // The runtime calls this immediately before it writes the prompt: it
        // is the one fact that says a prompt may have reached Pi.
        onPromptSent: () => {
          promptSent = true;
        },
        worktreePath: worktree.path,
        signal,
      });
      return { modelResult, webTurn };
    } finally {
      settleClaimedNotes({ claimedNotes, promptSent });
    }
  }

  // The result that ends the instruction when the model turn gave nothing to
  // publish, or null.
  function modelTurnEnding(turn, { modelResult, webTurn }) {
    if (webTurn?.waitingForConfirmation()) {
      return {
        outcome: turnOutcomes.answered,
        report:
          "La cerca espera la teva confirmació. No he publicat cap canvi.",
      };
    }
    if (modelResult.preparationFailed) {
      return failedResult(instructionReportKeys.preparationFailed);
    }
    if (modelResult.timedOut) {
      logger("execution_timed_out", turn.worktreeName);
      return failedResult(instructionReportKeys.modelTimedOut);
    }
    turn.signal?.throwIfAborted();
    if (modelResult.aborted) {
      return failedResult(instructionReportKeys.aborted);
    }
    // The provider failed the turn: its partial edits stay in the worktree
    // unpublished and the text is not an answer.
    if (modelResult.errorMessage) {
      return failedResult(instructionReportKeys.modelProviderFailed);
    }
    return null;
  }

  /**
   * The model copies an image it uses to a content path. Before the copy in the
   * ignored directory disappears, the service remembers which stored images
   * reached the worktree outside it, including the ones a previous attempt
   * already committed and this publication retries. A published change closes
   * them.
   */
  async function readUsedAttachmentNames(turn, worktree) {
    const { signal } = turn;
    const attachmentPaths = [
      ...(await listChangedPaths(worktree, { signal })),
      ...(await committedPaths(worktree, { signal })),
    ];
    return attachmentStore.used(
      turn.worktreeName,
      worktree.path,
      attachmentPaths,
    );
  }

  // The person reads the model's answer, never its change summary: the service
  // owns the summary and strips the line from every text.
  function personAnswer({ modelResult, webTurn }, resumedResearch) {
    const plainAnswer = stripChangeSummary(modelResult.text);
    if (webTurn) {
      return webTurn.withSources(plainAnswer);
    }
    return resumedResearch?.withSources(plainAnswer) ?? plainAnswer;
  }

  // Whatever the model moved is already outside the attachment directory.
  // Removing it before the checks and the commit means a received image never
  // reaches a commit or a publication, even on a branch whose .gitignore lacks
  // the rule.
  function discardStagedAttachments(turn, worktree) {
    removeAttachmentDirectory({ worktreePath: worktree.path });
    turn.stagedAttachmentPath = null;
  }

  async function hasWorkToPublish(worktree, { signal }) {
    const changedPaths = await listChangedPaths(worktree, { signal });
    return (
      changedPaths.length > 0 ||
      (await hasUnpublishedCommit(worktree, { signal }))
    );
  }

  function answerWithoutChanges(answer) {
    return {
      outcome: turnOutcomes.answered,
      modelAnswer: answer !== "",
      serviceText: null,
      report: answer || instructionReports.clarification,
    };
  }

  async function prepareWorkBranch(turn, { worktree, modelText }) {
    const { signal } = turn;
    const summary = isResearchAffected(turn.worktreeName)
      ? null
      : parseChangeSummary(modelText);
    const title = fallbackTitle({ summary });
    const existingBranch = await currentBranch(worktree, { signal });
    if (existingBranch) {
      return { title, branch: assertWorkBranch(existingBranch) };
    }
    const branch = branchNameForChange({ summary, suffix: turn.changeSuffix });
    await createBranch({ worktree, branch, signal });
    return { title, branch };
  }

  // `main` is integrated before the gate, and the gate depends on what the
  // synchronized publication would contain: a change that stays inside the
  // content never runs the operational server tests.
  function publishTurn(
    turn,
    { worktree, title, branch, continuedPullRequest, topicState },
  ) {
    const { signal } = turn;
    return publishSynchronized({
      synchronization: {
        worktree,
        worktreeName: turn.worktreeName,
        sessionIdentifier: turn.piSessionIdentifier,
        sessionKey: turn.request.sessionKey,
        title,
        topicState,
        signal,
      },
      publication: {
        branch,
        repair: continuedPullRequest,
        researchJobId: turn.worktreeName,
      },
      unsettledReport: {
        ...failureReport(instructionReportKeys.publicationRefused),
        detail: publicationRefusalDetail(
          "main kept advancing while the change was being published.",
        ),
      },
      // The instruction only becomes possibly published when the publisher is
      // about to write to GitHub: a read of the pull request that fails before
      // the push is a local failure, never an unknown result.
      onPublicationStarted: () => {
        turn.publicationStarted = true;
      },
      signal,
    });
  }

  // The result of a turn whose publisher did not confirm a publication.
  function unpublishedTurnResult(turn, { publicationResult, publication }) {
    const { worktreeName, answer } = turn;
    if (publicationResult === publicationResults.unconfirmed) {
      return uncertainResult(instructionReportKeys.publicationUncertain);
    }
    if (publicationResult === publicationResults.reviewRequired) {
      const serviceText = privateReviewText({
        worktreeName,
        reviewId: publication.reviewId,
      });
      return {
        outcome: turnOutcomes.researchReviewRequired,
        serviceText,
        report: [answer, serviceText].filter(Boolean).join("\n\n"),
      };
    }
    if (publicationResult === publicationResults.readFailed) {
      logger("publication_read_failed", worktreeName);
      return failedResult(instructionReportKeys.publicationReadFailed);
    }
    logger("publication_refused", worktreeName);
    return {
      ...failedResult(instructionReportKeys.publicationRefused),
      detail: publicationRefusalDetail(publication.reason, { secrets }),
      answer,
    };
  }

  function publishedTurnResult(
    turn,
    { publication, ciWatch, branch, checkCommand },
  ) {
    const publicationNotices = {
      pullRequest: publication.pullRequest,
      ciWatch,
      previewLabelFailed: publication.previewLabelFailed,
    };
    if (ciWatch === ciWatchOutcomes.unavailable) {
      noteMaintainerAttention({
        request: turn.request,
        reason: ciWatchUnavailableReason,
      });
    }
    if (publication.previewLabelFailed) {
      noteMaintainerAttention({
        request: turn.request,
        reason: instructionReportKeys.previewLabelFailed,
      });
    }
    const report = publicationReport({
      ...publicationNotices,
      answer: turn.answer,
    });
    // The publication happened, but no durable CI watch records it: an older
    // notice of the topic must not authorize anything from now on, so the
    // instruction ends unknown and a person reconciles it.
    let outcome = publication.created
      ? turnOutcomes.pullRequestCreated
      : turnOutcomes.pullRequestUpdated;
    if (ciWatch === ciWatchOutcomes.unavailable) {
      outcome = turnOutcomes.uncertain;
    }
    return {
      outcome,
      report,
      serviceText: publicationNoteText({
        ...publicationNotices,
        created: publication.created,
        branch,
        commit: publication.commit,
        checkCommand,
      }),
    };
  }

  // A writable turn in the topic, read as its phases.
  async function runTopicTurn(turn) {
    const { request, signal } = turn;
    const resumedResearch = await research?.resume(request, { signal });
    if (resumedResearch?.report) {
      return {
        outcome: turnOutcomes.answered,
        report: resumedResearch.report,
      };
    }

    const topic = await prepareTopic(turn);
    if (topic.endedWith) {
      return topic.endedWith;
    }
    const { worktree, continuedPullRequest } = topic;

    const input = await prepareModelInput(turn, {
      worktree,
      instruction: resumedResearch?.instruction ?? request.instruction,
    });
    if (input.endedWith) {
      return input.endedWith;
    }

    // The topic state is service data; the model cannot read it in the sandbox.
    const topicState = await topicStateOf(request.sessionKey, {
      continuedPullRequestNumber:
        continuedPullRequest?.pullRequestNumber ?? null,
      signal,
    });
    const modelTurn = await runModelTurn(turn, {
      worktree,
      input,
      topicState,
      resumedResearch,
    });
    const ending = modelTurnEnding(turn, modelTurn);
    if (ending !== null) {
      return ending;
    }

    const usedAttachmentNames = await readUsedAttachmentNames(turn, worktree);
    turn.answer = personAnswer(modelTurn, resumedResearch);
    discardStagedAttachments(turn, worktree);
    if (!(await hasWorkToPublish(worktree, { signal }))) {
      return answerWithoutChanges(turn.answer);
    }

    const { title, branch } = await prepareWorkBranch(turn, {
      worktree,
      modelText: modelTurn.modelResult.text,
    });
    const cycle = await publishTurn(turn, {
      worktree,
      title,
      branch,
      continuedPullRequest,
      topicState,
    });
    if (cycle.failure) {
      return {
        outcome: turnOutcomes.failed,
        ...cycle.failure,
        answer: turn.answer,
      };
    }
    const { publication, synchronized } = cycle;
    const publicationResult = classifyPublication(publication);
    if (publicationResult !== publicationResults.published) {
      return unpublishedTurnResult(turn, { publicationResult, publication });
    }

    const { ciWatch } = followUpPublication({
      request,
      publication,
      branch,
      usedAttachmentNames,
    });
    return publishedTurnResult(turn, {
      publication,
      ciWatch,
      branch,
      checkCommand: synchronized.checkCommand,
    });
  }

  // The copy is best-effort bookkeeping: a directory the model or the runtime
  // already removed is the wanted state.
  function cleanUpStagedAttachments({ stagedAttachmentPath }) {
    if (stagedAttachmentPath === null) {
      return;
    }
    try {
      removeAttachmentDirectory({ worktreePath: stagedAttachmentPath });
    } catch (error) {
      logger(
        "attachment_cleanup_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  async function execute(request, { signal } = {}) {
    const turn = createTurn(request, signal);
    try {
      signal?.throwIfAborted();
      // A merge is recognised from the literal command, so the model never sees
      // it.
      const mergeCommand = parseMergeCommand(request.instruction);
      if (mergeCommand !== null) {
        return await runMergeCommand(request, mergeCommand, { signal });
      }
      const confirmation = requestMergeConfirmation.contextualIntent(request);
      if (confirmation !== null) {
        // Not awaited: a rejection of the confirmation reaches the caller as it
        // is, not as a failed instruction.
        return requestMergeConfirmation.handleConfirmation(
          request,
          confirmation,
          { signal },
        );
      }
      return await runTopicTurn(turn);
    } catch (error) {
      return {
        ...failureResult(error, {
          signal,
          publicationStarted: turn.publicationStarted,
        }),
        answer: turn.answer,
      };
    } finally {
      cleanUpStagedAttachments(turn);
    }
  }

  /**
   * Trusted synchronization before a merge. The caller (the merge flow) pins the
   * pull request number, its exact head `commit` and the `branch` from its own
   * state; the current base comes from `origin/main`, not the PR's base SHA.
   * Only the internal conflict turn uses the model. The runner never creates
   * or moves a worktree:
   * the worktree must already be on the topic branch at `commit` with no work
   * the service has not published. A branch that already contains `main` is left
   * untouched and reported (`up_to_date`, fail closed). Otherwise `main` is
   * integrated with a merge commit, the local gate runs and the same publisher
   * guards update that exact pull request. When nothing is published, the
   * worktree returns to `commit`, except while a private review pins the local
   * commit or the result is uncertain. It never merges.
   */
  async function synchronizeForMerge(
    request,
    { pullRequestNumber, commit, branch },
    { signal } = {},
  ) {
    let publicationStarted = false;
    // The worktree to bring back to `commit` when this preparation ends without
    // a publication.
    let unpublishedWorktree = null;
    const failed = (failure) => ({ outcome: turnOutcomes.failed, ...failure });
    try {
      signal?.throwIfAborted();
      const binding = topicJobs.bindingOf(request.sessionKey);
      if (
        binding === null ||
        binding.pullRequestNumber !== pullRequestNumber ||
        binding.branch !== branch
      ) {
        return failed(
          failureReport(instructionReportKeys.topicBindingMismatch),
        );
      }
      const worktreeName = identifiers.worktreeName(request.sessionKey);
      const topic = await readTopicWorktree(worktreeName, { signal });
      const bound = await readValidBoundPullRequest({ binding, topic, signal });
      if (bound.report) {
        return failed(bound);
      }
      if (bound.pullRequest.headSha !== commit) {
        return failed(failureReport(instructionReportKeys.reviewedHeadChanged));
      }
      const { worktree } = topic;
      let { pendingWork } = topic;
      const mergeHead = await mergeInProgressHead(worktree, { signal });
      if (mergeHead !== null) {
        // A process that stopped during a conflict turn left the merge open.
        if (
          !(await abortInterruptedMainMerge(worktree, {
            commit,
            mergeHead,
            signal,
          }))
        ) {
          return failed(
            failureReport(instructionReportKeys.interruptedMergeNotRecovered),
          );
        }
        pendingWork = false;
      }
      if (pendingWork) {
        // Local work that is not part of the pull request head is never mixed
        // into a merge preparation. The merge a restart interrupted holds none,
        // but a private review may pin it.
        if (
          !(await addsOnlyMainMerges(worktree, { commit, signal })) ||
          (await reviewedCommit(worktreeName)) ===
            (await headCommit(worktree, { signal }))
        ) {
          return failed(
            failureReport(instructionReportKeys.unpublishedLocalWork),
          );
        }
        await restoreCommit({ worktree, commit });
      }
      if ((await headCommit(worktree, { signal })) !== commit) {
        return failed(failureReport(instructionReportKeys.localHeadMismatch));
      }
      const mainHead = await fetchMainHead({ worktree, signal });
      const mergeBase = await runGit(
        worktree,
        ["merge-base", "HEAD", mainHead],
        {
          allowFailure: true,
          signal,
        },
      );
      if (mergeBase.trim() === mainHead) {
        // Nothing to integrate: no commit, no gate, no publication.
        return {
          outcome: turnOutcomes.upToDate,
          report: mergeSynchronizationReports.upToDate({ pullRequestNumber }),
          mainHead,
          commit,
        };
      }
      // The same neutral title the reviewed publication uses, so an approval
      // of unchanged state stays valid.
      const title = fallbackTitle({ summary: null });
      const topicState = await topicStateOf(request.sessionKey, {
        continuedPullRequestNumber: pullRequestNumber,
        signal,
      });
      unpublishedWorktree = worktree;
      const cycle = await publishSynchronized({
        synchronization: {
          worktree,
          worktreeName,
          sessionIdentifier: sessionIdentifier(request.sessionKey),
          sessionKey: request.sessionKey,
          title,
          topicState,
          fetchedMainHead: mainHead,
          signal,
        },
        publication: {
          branch,
          repair: { pullRequestNumber, commit, synchronization: true },
          researchJobId: worktreeName,
        },
        unsettledReport: {
          report: mergeSynchronizationReports.baseUnsettled({
            pullRequestNumber,
          }),
        },
        onPublicationStarted: () => {
          publicationStarted = true;
        },
        signal,
      });
      if (cycle.failure) {
        return failed(cycle.failure);
      }
      const { publication, synchronized } = cycle;
      const publicationResult = classifyPublication(publication);
      if (publicationResult === publicationResults.unconfirmed) {
        // The push happened: the branch is not brought back.
        unpublishedWorktree = null;
        return uncertainResult(instructionReportKeys.publicationUncertain);
      }
      if (publicationResult === publicationResults.reviewRequired) {
        unpublishedWorktree = null;
        return {
          outcome: turnOutcomes.researchReviewRequired,
          report: privateReviewText({
            worktreeName,
            reviewId: publication.reviewId,
          }),
        };
      }
      if (publicationResult === publicationResults.readFailed) {
        return failedResult(instructionReportKeys.publicationReadFailed);
      }
      if (publicationResult === publicationResults.refused) {
        return {
          ...failedResult(instructionReportKeys.publicationRefused),
          detail: publicationRefusalDetail(publication.reason, { secrets }),
        };
      }
      unpublishedWorktree = null;
      const { ciWatch, previewTracked } = followUpPublication({
        request,
        publication,
        branch,
        mergeSynchronization: true,
      });
      const trackingFailed =
        ciWatch === ciWatchOutcomes.unavailable || previewTracked === false;
      return {
        outcome: trackingFailed
          ? turnOutcomes.uncertain
          : turnOutcomes.synchronized,
        report: trackingFailed
          ? mergeSynchronizationReports.followUpUnconfirmed({
              pullRequestNumber,
            })
          : mergeSynchronizationReports.synchronized({ pullRequestNumber }),
        pullRequest: publication.pullRequest,
        commit: publication.commit,
        previousCommit: commit,
        mainHead: synchronized.mainHead,
        ciWatch,
        previewLabelFailed: publication.previewLabelFailed,
      };
    } catch (error) {
      const result = failureResult(error, { signal, publicationStarted });
      // An uncertain result or a nested repository stays for a person to see.
      if (
        result.outcome === turnOutcomes.uncertain ||
        error instanceof NestedRepositoryError
      ) {
        unpublishedWorktree = null;
      }
      return result;
    } finally {
      if (unpublishedWorktree !== null) {
        try {
          await restoreCommit({ worktree: unpublishedWorktree, commit });
        } catch (error) {
          // The next merge request reports the work that stayed unpublished.
          logger(
            "merge_sync_restore_failed",
            error instanceof Error ? error.name : "unknown",
          );
        }
      }
    }
  }

  /**
   * One instruction, with the conversation state the service owns around it.
   * The report of an instruction reaches the topic exactly as this function
   * returns it. A note only ever carries what the service wrote: a report that
   * mixes service text and the model's own answer names its service part
   * (`serviceText`), and the answer itself stays in the session of the model.
   */
  async function runInstruction(request, options = {}) {
    const {
      modelAnswer = false,
      serviceText = null,
      reason = null,
      // The technical reason of a failure, for the note only.
      detail = null,
      answer = "",
      ...result
    } = await execute(request, options);
    // The failure notice tells the person the maintainer can review the case:
    // this trace and journal line are the note that makes it true.
    if (result.report === failedMaintainerNotice) {
      noteMaintainerAttention({
        request,
        reason: reason ?? unknownFailureReason,
      });
    }
    let noteText = serviceText;
    if (detail !== null) {
      noteText = `${result.report}\n${detail}`;
      result.report = answerWithNotices(answer, result.report);
    }
    if (typeof result.report !== "string") {
      return result;
    }
    const effectKey = `instruction:${request.updateIdentifier}`;
    // The model's own answer is never a service note.
    if (noteText !== null || !modelAnswer) {
      safelyWithNotes(() =>
        sessionNotes.addNote({
          sessionKey: request.sessionKey,
          text: noteText ?? result.report,
          // One instruction has one result: a repeated completion of the same
          // update never duplicates the effect in the session.
          effectKey,
        }),
      );
    }
    return result;
  }
  runInstruction.synchronizeForMerge = synchronizeForMerge;
  return runInstruction;
}
