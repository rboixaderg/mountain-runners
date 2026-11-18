// Coordinate one instruction. Model, checks and remote publication are supplied
// operations. This module has no container/GitHub transport or secret configuration.
//
// Every accepted instruction that is neither a merge nor a preview runs one Pi
// turn in the session of its topic (T8.7). A request the classifier cannot place,
// or a continuation with nothing pending and no pull request of the topic, runs
// the model as a consultation and the answer is the report: the fixed
// clarification text survives only as the fallback of an empty answer. The turn
// also receives the service effects the topic has not been told yet, and the
// service keeps the last text the topic received for the classifier.

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
  buildAttachmentsInstruction,
  buildRepairInstruction,
  ciWatchOutcomes,
  continuationReports,
  parseChangeSummary,
  branchNameForChange,
  fallbackTitle,
  pullRequestBody,
  instructionReports,
  maximumPromptImageBytes,
  publicationNoteText,
  publicationReport,
  previewRequestKind,
  repairRequestKind,
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
  requestPreview,
  requestMerge,
  continueFromPullRequest,
  warnAboutOverlaps,
  prepareAttachment,
  scaleAttachments = () => ({
    refusal: { reason: attachmentRefusalReasons.scaleFailed },
  }),
  attachmentStore,
  // Durable conversation state of the topic: the effects it has not been told
  // yet and the last text it received. Without it the service keeps neither.
  sessionNotes,
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
  function topicStateOf(sessionKey, { continuedPullRequestNumber }) {
    if (readTopicState === undefined) {
      return null;
    }
    try {
      return readTopicState(sessionKey, { continuedPullRequestNumber });
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

  async function execute(request, { signal } = {}) {
    // The Pi session file keeps the session identifier: it lives outside the
    // sandbox. Every name the sandbox can read is opaque.
    const piSessionIdentifier = sessionIdentifier(request.sessionKey);
    const worktreeName = identifiers.worktreeName(request.sessionKey);
    const newTaskSuffix = identifiers.changeSuffix(request.updateIdentifier);
    const repair = request.kind === repairRequestKind;
    const attachments = request.attachments ?? [];
    // Only an implementation and a continuation use an attached image. Every
    // other request ignores it, and its report says so in one sentence.
    const ignoringAttachment = (report) =>
      attachments.length === 0
        ? report
        : `${report}\n${attachmentReports.ignored}`;
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
      // request is classified from its text and from the bounded context of the
      // topic, which the service reads without touching anything.
      const topic = repair
        ? null
        : await readTopicWorktree(worktreeName, { signal });
      const topicPullRequest = repair
        ? null
        : topicPullRequestNumber(request.sessionKey);
      let kind;
      if (repair) {
        kind = repairRequestKind;
      } else {
        kind = await classifyRequest({
          instruction: request.instruction,
          context: {
            lastAgentReply:
              sessionNotes === undefined
                ? null
                : safelyWithNotes(() =>
                    sessionNotes.lastReply(request.sessionKey),
                  ),
            pendingLocalWork: topic.pendingWork,
            topicPullRequest,
          },
          signal,
        });
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
      // The fixed clarification text is only the fallback of an empty answer:
      // the request reaches the session as a consultation turn instead.
      let unclearRequest = false;
      if (
        kind !== "implementation" &&
        kind !== "consultation" &&
        kind !== "continuation" &&
        kind !== repairRequestKind
      ) {
        kind = "consultation";
        unclearRequest = true;
      }
      const target = repair
        ? await repairTarget(request, worktreeName, signal)
        : null;
      if (target?.report) {
        return { outcome: "failed", report: target.report };
      }
      // A continuation that names another topic's pull request resumes that
      // pull request here. A continuation that names none resumes the open pull
      // request of this topic, but only while the topic keeps no pending work:
      // pending work is the work it must continue.
      const continuation =
        kind === "continuation"
          ? await continueFromPullRequest(request, {
              signal,
              unnamedTopicPullRequest:
                topic !== null && !topic.pendingWork ? topicPullRequest : null,
            })
          : null;
      if (continuation?.report) {
        return { outcome: "answered", report: continuation.report };
      }
      // The topic already holds the branch of its own pull request at the head
      // the pull request reports: it continues there, without moving anything.
      const continuesInPlace = continuation?.inPlace === true;
      const resumed = continuation?.resume ?? null;
      const resumedLine =
        resumed === null
          ? null
          : continuationReports.resumed({
              pullRequestNumber: resumed.pullRequestNumber,
            });
      // The pull request a continuation of this topic must update: the resumed
      // one, or the one it continues in place. Null keeps a new change.
      const continuedPullRequestNumber = continuesInPlace
        ? continuation.pullRequestNumber
        : (resumed?.pullRequestNumber ?? null);
      const continuedBaseHeadSha = continuesInPlace
        ? continuation.baseHeadSha
        : (resumed?.baseHeadSha ?? null);
      let worktree;
      if (continuesInPlace) {
        worktree = topic.worktree;
      } else if (resumed !== null) {
        worktree = resumed.worktree;
      } else if (repair) {
        worktree = target.worktree;
      } else {
        worktree = await ensureSessionWorktree({
          repositoryPath,
          worktreeRoot,
          name: worktreeName,
          newTaskSuffix: kind === "implementation" ? newTaskSuffix : undefined,
          signal,
        });
      }
      if (
        kind === "continuation" &&
        resumed === null &&
        !continuesInPlace &&
        (await listChangedPaths(worktree, { signal })).length === 0 &&
        !(await hasUnpublishedCommit(worktree, { signal }))
      ) {
        // Nothing to continue: the request is answered as a consultation, in
        // the same session, instead of with the fixed clarification text.
        kind = "consultation";
        unclearRequest = true;
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
      // The images reach the model as service text appended to the instruction
      // and, for the new ones, as image input of the prompt. The topic keeps the
      // stored copies for its later turns.
      const kindUsesAttachment =
        kind === "implementation" || kind === "continuation";
      let stagedAttachments = [];
      let promptImages = [];
      let worktreePrepared = false;
      const hasStoredAttachments =
        attachmentStore !== undefined &&
        attachmentStore.list(worktreeName).length > 0;
      if (
        kindUsesAttachment &&
        (attachments.length > 0 || hasStoredAttachments)
      ) {
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
      // Every turn of the topic receives the state the service already holds,
      // as data, so the model never answers that it has no access or guesses a
      // preview URL. A continuation into another topic's pull request reports
      // that pull request until this topic owns it.
      const topicState = topicStateOf(request.sessionKey, {
        continuedPullRequestNumber,
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
          kind,
          unclearRequest,
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
        };
      }
      if (modelResult.timedOut) {
        logger("execution_timed_out", worktreeName);
        return { outcome: "failed", report: instructionReports.modelTimedOut };
      }
      signal?.throwIfAborted();
      if (modelResult.aborted) {
        return { outcome: "failed", report: instructionReports.aborted };
      }
      // The model copies an image it uses to a content path. Before the copy in
      // the ignored directory disappears, the service remembers which stored
      // images reached the worktree outside it; a published change closes them.
      const usedAttachmentNames =
        kind === "consultation" || attachmentStore === undefined
          ? []
          : attachmentStore.used(
              worktreeName,
              worktree.path,
              await listChangedPaths(worktree, { signal }),
            );
      // The person reads the model's answer, never its change summary: the
      // service owns the summary and strips the line from every text.
      const answer = stripChangeSummary(modelResult.text);
      if (kind === "consultation") {
        // The model's own answer is only the last text of the topic: it never
        // becomes a service note, because the session already holds it. Only the
        // notice of an ignored attachment is written by the service, and an
        // empty answer is reported with the fixed text instead of nothing. Both
        // compose the report like any other answer.
        const fixedText = unclearRequest
          ? instructionReports.clarification
          : instructionReports.noAnswer;
        return {
          outcome: "answered",
          modelAnswer: answer !== "",
          serviceText:
            attachments.length === 0 ? null : attachmentReports.ignored,
          report: ignoringAttachment(answer === "" ? fixedText : answer),
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
        // The resume line is written by the service and stays in the report; an
        // empty answer is reported with the fixed text instead of nothing.
        const report =
          resumedLine === null
            ? answer || instructionReports.noAnswer
            : `${resumedLine}\n${answer || instructionReports.noAnswer}`;
        return {
          outcome: "answered",
          modelAnswer: answer !== "",
          serviceText: resumedLine,
          report,
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
      const checks = await runChecks({
        sandboxIdentifier: worktreeName,
        worktreePath: worktree.path,
        signal,
      });
      if (checks.timedOut) {
        return { outcome: "failed", report: instructionReports.checksTimedOut };
      }
      if (checks.exitCode !== 0) {
        logger("checks_failed", worktreeName);
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
      if (usedAttachmentNames.length > 0) {
        recordTrace({
          updateIdentifier: request.updateIdentifier,
          authorIdentifier: request.authorIdentifier,
          sessionKey: request.sessionKey,
          action: "attachment_used",
          detail: usedAttachmentNames.join(","),
        });
      }
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
          };
        }
        logger("publication_refused", worktreeName);
        return {
          outcome: "failed",
          report: instructionReports.publicationRefused,
        };
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
      // The person reads what the model did, then the notices of the service:
      // the resumed pull request, the owner that could not be told and the
      // overlap warning, if any. The review link is the last line.
      const publicationNotices = {
        pullRequest: publication.pullRequest,
        ciWatch,
        notices: [
          ...(resumedLine === null ? [] : [resumedLine]),
          ...(resumed !== null && !ownersMoved
            ? [
                continuationReports.ownerUnregistered({
                  pullRequestNumber: resumed.pullRequestNumber,
                }),
              ]
            : []),
          ...(overlapWarning === null ? [] : [overlapWarning]),
        ],
      };
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
        }),
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
      ...result
    } = await execute(request, options);
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
