// Coordinate one instruction. Model, checks and remote publication are supplied
// operations. This module has no container/GitHub transport or secret configuration.
//
// Every ordinary instruction runs a writable turn in its topic. The classifier
// identifies preview requests; /merge and automatic repairs keep their own paths.
// The turn receives service effects the topic has not been told yet.

import { sessionIdentifier } from "telegram-pi-bridge/sessions";
import { attachmentRefusalDetail } from "telegram-pi-bridge/telegram";
import { removeAttachmentDirectory } from "../attachments/destination.mjs";
import { attachmentRefusalReasons } from "../attachments/refusals.mjs";
import { needsDownscale } from "../attachments/scale.mjs";
import {
  assertWorkBranch,
  commitAll,
  createBranch,
  currentBranch,
  commitSubject,
  changeDiff,
  changedPathsAgainstMain,
  ensureSessionWorktree,
  findSessionWorktree,
  headCommit,
  listChangedPaths,
  committedPaths,
  hasUnpublishedCommit,
  publishedCommit,
  mergeMainIntoBranch,
  fastForwardPublishedBranch,
  fetchPublishedBranch,
  mergeCommitIntoBranch,
  restartConflictMerge,
  abortConflictMerge,
  commitConflictMerge,
  MergeCleanupError,
} from "../repository/worktrees.mjs";
import { runGit } from "../repository/trusted-git.mjs";
import { parseMergeCommand } from "./merge-request.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";
import {
  attachmentAcceptedDetail,
  attachmentRefusalReport,
  attachmentReports,
  buildAttachmentsInstruction,
  buildConflictInstruction,
  buildRepairInstruction,
  checkCommandForPaths,
  ciWatchOutcomes,
  continuationReports,
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
  previewRequestKind,
  repairRequestKind,
  topicTurnKind,
  pendingWorkCommitMessage,
  stripChangeSummary,
} from "../policy/development.mjs";

export function createInstructionRunner({
  repositoryPath,
  worktreeRoot,
  identifiers,
  classifyRequest,
  runModel,
  runChecks,
  publishChange,
  registerCiWatch,
  // Follows the preview of every commit the service publishes.
  followPreview,
  requestPreview,
  requestMerge,
  prepareAttachment,
  scaleAttachments = () => ({
    refusal: { reason: attachmentRefusalReasons.scaleFailed },
  }),
  attachmentStore,
  // Durable conversation state of the topic: the effects it has not been told
  // yet and the last text it received. Without it the service keeps neither.
  sessionNotes,
  topicJobs,
  migrateTopicJob,
  readBoundPullRequest,
  repositoryName,
  // The pull request the topic published and still owns, or null. Without the
  // CI watches the service knows no published pull request.
  findTopicPullRequest = () => null,
  // The state of the topic every turn receives, read from the same stores. The
  // model cannot read it from the sandbox.
  readTopicState = undefined,
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
      safelyWithNotes(() => sessionNotes?.deliver(claimedNotes));
    } else {
      safelyWithNotes(() => sessionNotes?.release(claimedNotes));
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
   * A repair continues a published commit: the worktree and its branch must
   * already exist and stay at that commit. The service never creates, resets or
   * moves anything to repair a failure.
   */
  async function repairTarget(request, worktreeName, signal) {
    const worktree = await findSessionWorktree({
      repositoryPath,
      worktreeRoot,
      name: worktreeName,
      signal,
    });
    if (worktree === null) {
      return {
        report: instructionReports.repairWorktreeMissing,
        reason: instructionReportKeys.repairWorktreeMissing,
      };
    }
    const branch = await currentBranch(worktree, { signal });
    if (
      branch === null ||
      (await headCommit(worktree, { signal })) !== request.commit
    ) {
      return {
        report: instructionReports.repairCommitChanged,
        reason: instructionReportKeys.repairCommitChanged,
      };
    }
    // Leftovers of a later instruction (for example a failed check) are not
    // part of the failed commit and must never be committed by a repair.
    if ((await listChangedPaths(worktree, { signal })).length > 0) {
      return {
        report: instructionReports.repairWorktreeDirty,
        reason: instructionReportKeys.repairWorktreeDirty,
      };
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

  /** The pull request of the topic, read from the durable CI watches. */
  function topicPullRequestNumber(sessionKey) {
    try {
      return findTopicPullRequest(sessionKey) ?? null;
    } catch (error) {
      // An unreadable state never turns a publication into a failed
      // instruction: the service continues without the pull request of the
      // topic and logs the real failure.
      logger(
        "topic_pull_request_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return null;
    }
  }

  /**
   * The state of the topic the model cannot read inside the sandbox. A state
   * that cannot be read never stops a turn: it is logged and the turn runs
   * without the block, exactly as the classifier runs without the pull request.
   * A turn that continues another topic's pull request reports that pull
   * request and the facts of the topic that owns it.
   */
  async function topicStateOf(
    sessionKey,
    { continuedPullRequestNumber, signal },
  ) {
    if (readTopicState === undefined) {
      return null;
    }
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
    const checks = await runChecks({
      sandboxIdentifier: worktreeName,
      worktreePath: worktree.path,
      checkCommand,
      signal,
    });
    if (checks.timedOut) {
      return {
        report: instructionReports.checksTimedOut,
        reason: instructionReportKeys.checksTimedOut,
      };
    }
    if (checks.exitCode !== 0) {
      logger("checks_failed", worktreeName);
      return {
        report: instructionReports.checksFailed,
        reason: instructionReportKeys.checksFailed,
      };
    }
    signal?.throwIfAborted();
    return null;
  }

  async function resolveConflict({
    worktree,
    worktreeName,
    sessionIdentifier,
    sessionKey,
    paths,
    headSha,
    topicState,
    worktreePrepared,
    signal,
  }) {
    const restarted = await restartConflictMerge({
      worktree,
      headSha,
      expectedPaths: paths,
      signal,
    });
    if (!restarted) {
      return false;
    }
    let mergeInProgress = true;
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
      const hasBinaryConflict = binaryDiff
        .split("\0")
        .some((entry) => entry.startsWith("-\t-\t"));
      const resolution = await runModel({
        sessionIdentifier,
        sandboxIdentifier: worktreeName,
        sessionKey,
        instruction: buildConflictInstruction(paths),
        images: [],
        attachments: [],
        worktreePrepared,
        kind: topicTurnKind,
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
        hasBinaryConflict
      ) {
        return false;
      }
      signal?.throwIfAborted();
      try {
        await runGit(worktree, ["diff", "--check"], { signal });
      } catch {
        signal?.throwIfAborted();
        return false;
      }
      if (!(await commitConflictMerge({ worktree, signal }))) {
        return false;
      }
      mergeInProgress = false;
      return true;
    } finally {
      if (mergeInProgress) {
        await abortConflictMerge(worktree);
      }
    }
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
      return {
        report: instructionReports.publicationReadFailed,
        reason: instructionReportKeys.publicationReadFailed,
      };
    }
    if (pullRequest.state === "closed") {
      return { report: finishedTopicReport };
    }
    const movedHeadReport = continuationReports.movedHead({
      pullRequestNumber: binding.pullRequestNumber,
    });
    if (
      topic.worktree === null ||
      (await currentBranch(topic.worktree, { signal })) !== binding.branch
    ) {
      return { report: movedHeadReport };
    }
    if (
      pullRequest.state !== "open" ||
      pullRequest.draft ||
      pullRequest.baseRef !== "main" ||
      pullRequest.headRepository?.toLowerCase() !==
        repositoryName.toLowerCase() ||
      pullRequest.headRef !== binding.branch
    ) {
      return { report: movedHeadReport };
    }
    return { pullRequest };
  }

  // Brings the topic worktree to the head of its pull request. Returns false
  // when the worktree cannot follow it and the turn must not start.
  async function followBoundPullRequest({
    binding,
    topic,
    pullRequest,
    sessionKey,
    worktreeName,
    sessionIdentifier,
    signal,
  }) {
    if (
      await matchesPublishedHead(topic.worktree, pullRequest.headSha, signal)
    ) {
      return true;
    }
    if (!topic.pendingWork) {
      return fastForwardPublishedBranch({
        worktree: topic.worktree,
        branch: binding.branch,
        headSha: pullRequest.headSha,
        signal,
      });
    }
    return mergeMovedPullRequestHead({
      binding,
      worktree: topic.worktree,
      pullRequest,
      sessionKey,
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
    if (!fetched || previousHead === null) {
      return false;
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
      return false;
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
      return true;
    }
    const conflictState = await topicStateOf(sessionKey, {
      continuedPullRequestNumber: binding.pullRequestNumber,
      signal,
    });
    return resolveConflict({
      worktree,
      worktreeName,
      sessionIdentifier,
      sessionKey,
      paths: merged.paths,
      headSha: pullRequest.headSha,
      topicState: conflictState,
      worktreePrepared: false,
      signal,
    });
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

  async function execute(request, { signal } = {}) {
    // The Pi session file keeps the session identifier: it lives outside the
    // sandbox. Every name the sandbox can read is opaque.
    const piSessionIdentifier = sessionIdentifier(request.sessionKey);
    const worktreeName = identifiers.worktreeName(request.sessionKey);
    const newTaskSuffix = identifiers.changeSuffix(request.updateIdentifier);
    const repair = request.kind === repairRequestKind;
    const attachments = request.attachments ?? [];
    // A merge or preview ignores an attached image and says so.
    const ignoringAttachment = (report) =>
      attachments.length === 0
        ? report
        : `${report}\n${attachmentReports.ignored}`;
    let publicationStarted = false;
    // The worktree whose ignored attachment directory this turn staged, so the
    // copy disappears even when the model fails, times out or is aborted.
    let stagedAttachmentPath = null;
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
      if (!repair && migrateTopicJob) {
        const migrationReport = await migrateTopicJob(request.sessionKey, {
          signal,
        });
        if (migrationReport !== null) {
          return {
            outcome: "failed",
            report: ignoringAttachment(migrationReport),
          };
        }
      }
      // Only the trusted internal repair request fixes its kind; every other
      // request is classified from its text and from the bounded context of the
      // topic, which the service reads without touching anything.
      const topic = repair
        ? null
        : await readTopicWorktree(worktreeName, { signal });
      const topicPullRequest = repair
        ? null
        : topicPullRequestNumber(request.sessionKey);
      const lastAgentReply =
        repair || sessionNotes === undefined
          ? null
          : safelyWithNotes(() => sessionNotes.lastReply(request.sessionKey));
      let kind;
      if (repair) {
        kind = repairRequestKind;
      } else {
        const classification = await classifyRequest({
          instruction: request.instruction,
          context: {
            lastAgentReply,
            pendingLocalWork: topic.pendingWork,
            topicPullRequest,
          },
          signal,
        });
        kind = classification.kind;
        // The last reply is untrusted text: it may describe a preview, but it
        // can never authorise one. When it was part of the context, the
        // classifier must reach the same kind without it, or the preview is
        // decided from the current request alone.
        if (kind === previewRequestKind && lastAgentReply !== null) {
          const withoutLastReply = await classifyRequest({
            instruction: request.instruction,
            context: {
              lastAgentReply: null,
              pendingLocalWork: topic.pendingWork,
              topicPullRequest,
            },
            signal,
          });
          kind = withoutLastReply.kind;
        }
        recordTrace({
          updateIdentifier: request.updateIdentifier,
          authorIdentifier: request.authorIdentifier,
          sessionKey: request.sessionKey,
          action: "instruction_classified",
          detail: kind,
        });
      }
      // A preview is decided by the service, never by the model: no worktree
      // is touched and no model run starts.
      if (kind === previewRequestKind) {
        const preview = await requestPreview(request, { signal });
        return { ...preview, report: ignoringAttachment(preview.report) };
      }
      const topicTurn = !repair;
      const target = repair
        ? await repairTarget(request, worktreeName, signal)
        : null;
      if (target?.report) {
        return {
          outcome: "failed",
          report: target.report,
          reason: target.reason,
        };
      }
      const binding = topicTurn
        ? (topicJobs?.bindingOf(request.sessionKey) ?? null)
        : null;
      let boundContinuation = null;
      if (binding !== null) {
        const bound = await readValidBoundPullRequest({
          binding,
          topic,
          signal,
        });
        if (bound.report) {
          return {
            outcome: "failed",
            report: bound.report,
            reason: bound.reason,
          };
        }
        const followed = await followBoundPullRequest({
          binding,
          topic,
          pullRequest: bound.pullRequest,
          sessionKey: request.sessionKey,
          worktreeName,
          sessionIdentifier: piSessionIdentifier,
          signal,
        });
        if (!followed) {
          return {
            outcome: "failed",
            report: continuationReports.movedHead({
              pullRequestNumber: binding.pullRequestNumber,
            }),
          };
        }
        boundContinuation = {
          pullRequestNumber: binding.pullRequestNumber,
          baseHeadSha: bound.pullRequest.headSha,
        };
      }
      const continuedPullRequestNumber =
        boundContinuation?.pullRequestNumber ?? null;
      const continuedBaseHeadSha = boundContinuation?.baseHeadSha ?? null;
      let worktree;
      if (boundContinuation) {
        worktree = topic.worktree;
      } else if (repair) {
        worktree = target.worktree;
      } else {
        worktree = await ensureSessionWorktree({
          repositoryPath,
          worktreeRoot,
          name: worktreeName,
          signal,
        });
      }
      let instruction = repair ? target.instruction : request.instruction;
      let stagedAttachments = [];
      let promptImages = [];
      let worktreePrepared = false;
      const hasStoredAttachments =
        attachmentStore !== undefined &&
        attachmentStore.list(worktreeName).length > 0;
      if (topicTurn && (attachments.length > 0 || hasStoredAttachments)) {
        stagedAttachmentPath = worktree.path;
        const applied = await applyAttachments({
          attachments,
          instruction,
          request,
          worktree,
          worktreeName,
          signal,
        });
        if (applied.report) {
          return { outcome: "failed", report: applied.report };
        }
        instruction = applied.instruction;
        stagedAttachments = applied.attachments;
        promptImages = applied.images;
        worktreePrepared = applied.scaledInSandbox === true;
      }
      // The effects of the service are claimed at the one point where the turn
      // really starts: the sandbox and the profile are ready and Pi is about to
      // receive the prompt. A preparation that never reached the model leaves
      // them undelivered. Once claimed, they are returned only when the prompt
      // was never written: `onPromptSent` is that fact, so it holds even when a
      // cleanup failure wins over an error of the launch or of the stop.
      let claimedNotes = null;
      let promptSent = false;
      // The topic state is service data; the model cannot read it in the sandbox.
      const topicState = await topicStateOf(request.sessionKey, {
        continuedPullRequestNumber,
        signal,
      });
      const claimServiceNotes = () => {
        if (claimedNotes === null) {
          claimedNotes =
            sessionNotes === undefined
              ? []
              : (safelyWithNotes(() =>
                  sessionNotes.claim(request.sessionKey),
                ) ?? []);
        }
        return claimedNotes.map((note) => note.text);
      };
      let modelResult;
      try {
        modelResult = await runModel({
          sessionIdentifier: piSessionIdentifier,
          sandboxIdentifier: worktreeName,
          sessionKey: request.sessionKey,
          instruction,
          images: promptImages,
          attachments: stagedAttachments,
          worktreePrepared,
          kind: repair ? repairRequestKind : topicTurnKind,
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
      } catch (error) {
        settleClaimedNotes({ claimedNotes, promptSent });
        throw error;
      }
      settleClaimedNotes({ claimedNotes, promptSent });
      if (modelResult.preparationFailed) {
        return {
          outcome: "failed",
          report: instructionReports.preparationFailed,
          reason: instructionReportKeys.preparationFailed,
        };
      }
      if (modelResult.timedOut) {
        logger("execution_timed_out", worktreeName);
        return {
          outcome: "failed",
          report: instructionReports.modelTimedOut,
          reason: instructionReportKeys.modelTimedOut,
        };
      }
      signal?.throwIfAborted();
      if (modelResult.aborted) {
        return {
          outcome: "failed",
          report: instructionReports.aborted,
          reason: instructionReportKeys.aborted,
        };
      }
      // The model copies an image it uses to a content path. Before the copy in
      // the ignored directory disappears, the service remembers which stored
      // images reached the worktree outside it, including the ones a previous
      // attempt already committed and this publication retries. A published
      // change closes them.
      const attachmentPaths =
        attachmentStore === undefined
          ? []
          : [
              ...(await listChangedPaths(worktree, { signal })),
              ...(await committedPaths(worktree, { signal })),
            ];
      const usedAttachmentNames =
        attachmentStore === undefined
          ? []
          : attachmentStore.used(worktreeName, worktree.path, attachmentPaths);
      // The person reads the model's answer, never its change summary: the
      // service owns the summary and strips the line from every text.
      const answer = stripChangeSummary(modelResult.text);
      // Whatever the model moved is already outside this directory. Removing it
      // before the checks and the commit means a received image never reaches a
      // commit or a publication, even on a branch whose .gitignore lacks the
      // rule.
      removeAttachmentDirectory({ worktreePath: worktree.path });
      stagedAttachmentPath = null;
      const changedPaths = await listChangedPaths(worktree, { signal });
      if (
        changedPaths.length === 0 &&
        !(await hasUnpublishedCommit(worktree, { signal }))
      ) {
        return {
          outcome: "answered",
          modelAnswer: answer !== "",
          serviceText: null,
          report:
            answer ||
            (repair
              ? instructionReports.noAnswer
              : instructionReports.clarification),
        };
      }
      const summary = parseChangeSummary(modelResult.text);
      const title = fallbackTitle({ summary });
      const existingBranch = repair
        ? target.branch
        : await currentBranch(worktree, { signal });
      const branch = existingBranch
        ? assertWorkBranch(existingBranch)
        : branchNameForChange({ summary, suffix: newTaskSuffix });
      if (!existingBranch) {
        await createBranch({ worktree, branch, signal });
      }
      // The gate depends on what the publication would contain: a change that
      // stays inside the content never runs the operational server tests.
      const checkCommand = checkCommandForPaths(
        await changedPathsAgainstMain(worktree, { signal }),
      );
      const checkReport = await checkWorktree({
        worktree,
        worktreeName,
        checkCommand,
        signal,
      });
      if (checkReport !== null) {
        return { outcome: "failed", ...checkReport };
      }
      await commitAll({ worktree, message: title, signal });
      const synchronization = await mergeMainIntoBranch({ worktree, signal });
      if (synchronization.conflict) {
        const mainHead = (
          await runGit(worktree, ["rev-parse", "origin/main"], { signal })
        ).trim();
        const resolved = await resolveConflict({
          worktree,
          worktreeName,
          sessionIdentifier: piSessionIdentifier,
          sessionKey: request.sessionKey,
          paths: synchronization.paths,
          headSha: mainHead,
          topicState,
          worktreePrepared: true,
          signal,
        });
        if (!resolved) {
          return {
            outcome: "failed",
            report: instructionReports.checksFailed,
            reason: instructionReportKeys.checksFailed,
          };
        }
      }
      if (synchronization.merged || synchronization.conflict) {
        const checkReport = await checkWorktree({
          worktree,
          worktreeName,
          checkCommand,
          signal,
        });
        if (checkReport !== null) {
          return { outcome: "failed", ...checkReport };
        }
      }
      const body = pullRequestBody({
        title,
        changedPaths: await committedPaths(worktree, { signal }),
        checkCommand,
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
      if (continuedPullRequestNumber !== null) {
        // A resumed pull request and a continuation that happens in place
        // update that exact pull request: the publisher revalidates it before
        // the push and never opens another one.
        continuedPullRequest = {
          pullRequestNumber: continuedPullRequestNumber,
          commit: continuedBaseHeadSha,
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
          logger("publication_read_failed", worktreeName);
          return {
            outcome: "failed",
            report: instructionReports.publicationReadFailed,
            reason: instructionReportKeys.publicationReadFailed,
          };
        }
        logger("publication_refused", worktreeName);
        return {
          outcome: "failed",
          report: instructionReports.publicationRefused,
          reason: instructionReportKeys.publicationRefused,
        };
      }
      // Record the first confirmed publication. An existing binding is never
      // replaced: later turns of the topic continue its recorded branch.
      if (
        !repair &&
        topicJobs &&
        topicJobs.bindingOf(request.sessionKey) === null
      ) {
        topicJobs.bind({
          sessionKey: request.sessionKey,
          branch,
          pullRequestNumber: publication.pullRequest.number,
        });
      }
      // The image is used only once the publication is confirmed: a refused or
      // unknown publication keeps it available for the next turn.
      if (usedAttachmentNames.length > 0) {
        recordTrace({
          updateIdentifier: request.updateIdentifier,
          authorIdentifier: request.authorIdentifier,
          sessionKey: request.sessionKey,
          action: "attachment_used",
          detail: usedAttachmentNames.join(","),
        });
      }
      // The image is part of a published change: it no longer needs to stay in
      // the topic store. A refused publication keeps it for the next turn. The
      // publication is already done, so a bookkeeping failure only logs.
      if (attachmentStore !== undefined && usedAttachmentNames.length > 0) {
        try {
          attachmentStore.remove(worktreeName, usedAttachmentNames);
        } catch (error) {
          logger(
            "attachment_store_failed",
            error instanceof Error ? error.name : "unknown",
          );
        }
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
      // The `preview` label makes the publisher build every pushed head, so the
      // topic receives the address of this commit without asking for it. A
      // pull request without the label simply has no preview to report.
      followPreview?.({
        updateIdentifier: request.updateIdentifier,
        sessionKey: request.sessionKey,
        authorIdentifier: request.authorIdentifier,
        pullRequestNumber: publication.pullRequest.number,
        commit: publication.commit,
        repair,
      });
      const publicationNotices = {
        pullRequest: publication.pullRequest,
        ciWatch,
        previewLabelFailed: publication.previewLabelFailed,
      };
      if (ciWatch === ciWatchOutcomes.unavailable) {
        noteMaintainerAttention({ request, reason: ciWatchUnavailableReason });
      }
      if (publication.previewLabelFailed) {
        noteMaintainerAttention({
          request,
          reason: instructionReportKeys.previewLabelFailed,
        });
      }
      const publicationText = publicationReport({
        ...publicationNotices,
        answer,
      });
      // The publication happened, but no durable CI watch records it: an older
      // notice of the topic must not authorize anything from now on, so the
      // instruction ends unknown and a person reconciles it.
      let outcome = publication.created
        ? "pull_request_created"
        : "pull_request_updated";
      if (ciWatch === ciWatchOutcomes.unavailable) {
        outcome = "uncertain";
      }
      return {
        outcome,
        report: publicationText,
        serviceText: publicationNoteText({
          ...publicationNotices,
          created: publication.created,
          branch,
          commit: publication.commit,
          checkCommand,
        }),
      };
    } catch (error) {
      logger(
        "instruction_failed",
        error instanceof Error ? error.name : "unknown",
      );
      if (error instanceof MergeCleanupError) {
        return {
          outcome: "uncertain",
          report: instructionReports.mergeCleanupUncertain,
          reason: instructionReportKeys.mergeCleanupUncertain,
        };
      }
      if (error instanceof SandboxCleanupError) {
        return {
          outcome: "uncertain",
          report: instructionReports.sandboxUncertain,
          reason: instructionReportKeys.sandboxUncertain,
        };
      }
      if (publicationStarted) {
        return {
          outcome: "uncertain",
          report: instructionReports.publicationUncertain,
          reason: instructionReportKeys.publicationUncertain,
        };
      }
      return {
        outcome: "failed",
        reason: signal?.aborted
          ? instructionReportKeys.aborted
          : instructionReportKeys.executionFailed,
        report: signal?.aborted
          ? instructionReports.aborted
          : instructionReports.executionFailed,
      };
    } finally {
      if (stagedAttachmentPath !== null) {
        try {
          removeAttachmentDirectory({ worktreePath: stagedAttachmentPath });
        } catch (error) {
          // The copy is best-effort bookkeeping: a directory the model or the
          // runtime already removed is the wanted state.
          logger(
            "attachment_cleanup_failed",
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
  return async function runInstruction(request, options = {}) {
    const {
      modelAnswer = false,
      serviceText = null,
      reason = null,
      ...result
    } = await execute(request, options);
    // The failure notice tells the person the maintainer can review the case:
    // this trace and journal line are the note that makes it true.
    if (
      request.kind !== repairRequestKind &&
      result.report === failedMaintainerNotice
    ) {
      noteMaintainerAttention({
        request,
        reason: reason ?? unknownFailureReason,
      });
    }
    if (request.kind === repairRequestKind) {
      // An automatic repair sends the text the topic receives from its own
      // executor, which wraps this report and records that text. That executor
      // also writes the note, so the service-only part of this turn travels
      // with the result and never becomes the model's words.
      return serviceText === null ? result : { ...result, serviceText };
    }
    if (sessionNotes === undefined || typeof result.report !== "string") {
      return result;
    }
    const effectKey = `instruction:${request.updateIdentifier}`;
    if (serviceText !== null) {
      safelyWithNotes(() =>
        sessionNotes.addNote({
          sessionKey: request.sessionKey,
          text: serviceText,
          receivedText: result.report,
          effectKey,
        }),
      );
    } else if (modelAnswer) {
      safelyWithNotes(() =>
        sessionNotes.recordReply({
          sessionKey: request.sessionKey,
          text: result.report,
        }),
      );
    } else {
      safelyWithNotes(() =>
        sessionNotes.addNote({
          sessionKey: request.sessionKey,
          text: result.report,
          // One instruction has one result: a repeated completion of the same
          // update never duplicates the effect in the session.
          effectKey,
        }),
      );
    }
    return result;
  };
}
