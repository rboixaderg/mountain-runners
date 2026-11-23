// Deterministic `/merge` on request (T8.4).
//
// A verified person asks with the literal command `/merge`, `/merge <PR>` or
// `/merge <PR> <SHA>` to merge the pull request and commit of the newest
// confirmed and delivered preview notice of the topic. Prose is never a merge
// and the model never sees the command. A green CI result is not delivery. The
// service pins the request to that notice, verifies the person's membership
// again, re-reads the pull request, its preview label and its required checks
// and only then asks GitHub for a squash merge of exactly that commit, with its
// own credential.
//
// The request is durable before the merge call. A result that is not known is
// never repeated: the next request, or the next start, reads the pull request
// first and closes the request as merged only if GitHub shows it merged. A
// request that clears an unknown result never merges: the person asks again.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import {
  isDefiniteRejection,
  readLivePullRequest,
  statusClass,
} from "../repository/github.mjs";
import { mergeBeginResults } from "../repository/merge-request-store.mjs";
import { isNoticeMessageIdentifier } from "../repository/preview-request-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
  sleep,
} from "../repository/request-signal.mjs";
import { mergeReports, shortCommit } from "../policy/development.mjs";

const mergeCommandPrefix = "/merge";
const mergeCommandPattern =
  /^\/merge(?:[ \t]+#?(\d+)(?:[ \t]+([a-f0-9]{40}))?)?$/u;
const mergeMethod = "squash";
export const mergeConfirmationOutcome = "merge_context";
const quietConfirmation = { outcome: mergeConfirmationOutcome };

const confirmationPattern = /^si(?:\s*,\s*|\s+)(?:a\s+)?produccio$/u;

function stripDiacritics(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
}

export function mergeConfirmationIntent(text) {
  const normalized = text.trim().toLowerCase();
  const simplifiedConfirmation = stripDiacritics(
    normalized.replace(/[.!]+$/u, "").trimEnd(),
  ).replace(/\s+/gu, " ");
  if (confirmationPattern.test(simplifiedConfirmation)) {
    return "confirm";
  }
  if (
    normalized
      .replace(/[.!?]+$/u, "")
      .trimEnd()
      .replace(/\s+/gu, " ") === "la feina està validada"
  ) {
    return "validate";
  }
  return null;
}

const mergeableStates = {
  clean: "clean",
  behind: "behind",
  unknown: "unknown",
};
// GitHub computes mergeability lazily: `unknown` is read again a bounded number
// of times before the request is refused as unreadable.
const mergeabilityAttempts = 3;

const refusals = {
  usage: "usage",
  membershipRevoked: "membership_revoked",
  membershipUnavailable: "membership_unavailable",
  noDeliveredPreview: "no_delivered_preview",
  otherPullRequest: "other_pull_request",
  commitMismatch: "commit_mismatch",
  newerWork: "newer_work",
  alreadyHandled: "already_handled",
  alreadyInProgress: "already_in_progress",
  uncertainPending: "uncertain_pending",
  uncertainClosed: "uncertain_closed",
  alreadyMerged: "already_merged",
  notOpen: "not_open",
  draft: "draft",
  notMainBase: "not_main_base",
  notMainRepository: "not_main_repository",
  headMoved: "head_moved",
  previewRevoked: "preview_revoked",
  noPreviewLabel: "no_preview_label",
  checksNotGreen: "checks_not_green",
  behind: "behind",
  notClean: "not_clean",
  unreadable: "unreadable",
};

/**
 * Recognise the merge command in the whole instruction text. Returns null when
 * the text is not a merge command, `{ valid: false }` for anything that starts
 * with `/merge` but is not one of the three accepted forms, and the optional
 * pull request number and full commit otherwise.
 */
export function parseMergeCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith(mergeCommandPrefix)) {
    return null;
  }
  const parsed = mergeCommandPattern.exec(trimmed);
  if (parsed === null) {
    return { valid: false };
  }
  const [, number, commit] = parsed;
  if (number === undefined) {
    return { valid: true };
  }
  const pullRequestNumber = Number(number);
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    return { valid: false };
  }
  return { valid: true, pullRequestNumber, commit };
}

function describeTarget({ pullRequestNumber, commit }) {
  return `#${pullRequestNumber} ${shortCommit(commit)}`;
}

function rowTarget(row) {
  return {
    pullRequestNumber: row.pull_request_number,
    commit: row.commit_sha,
  };
}

export function createMergeRequests({
  store,
  findDeliveredPreview,
  hasNewerWork,
  hasInterveningInstructions,
  verifyMembership,
  github,
  repository,
  requiredChecks,
  telegram,
  retryDelayMilliseconds = 2000,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
  recordTrace = () => {},
  // The text of a report is an effect the next turn of the topic must know.
  recordServiceNote = () => {},
  logger = () => {},
}) {
  function safeTrace(entry) {
    try {
      recordTrace(entry);
    } catch (error) {
      logger(
        "merge_trace_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  function traceRequest(request, action, detail) {
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action,
      detail,
    });
  }

  function refuse(request, reason, text, target) {
    traceRequest(
      request,
      "merge_refused",
      target ? `${reason} ${describeTarget(target)}` : reason,
    );
    return { outcome: "answered", report: text };
  }

  const refusalTexts = {
    [refusals.notOpen]: mergeReports.notOpen,
    [refusals.draft]: mergeReports.draft,
    [refusals.notMainBase]: mergeReports.notMainBase,
    [refusals.notMainRepository]: mergeReports.notMainRepository,
    [refusals.headMoved]: mergeReports.headMoved,
    [refusals.previewRevoked]: mergeReports.previewRevoked,
    [refusals.noPreviewLabel]: mergeReports.noPreviewLabel,
    [refusals.checksNotGreen]: mergeReports.checksNotGreen,
    [refusals.behind]: mergeReports.behind,
    [refusals.notClean]: mergeReports.notClean,
    [refusals.unreadable]: mergeReports.unreadable,
  };

  function alreadyMergedAnswer(request, target, pullRequest) {
    return refuse(
      request,
      refusals.alreadyMerged,
      mergeReports.alreadyMerged({
        pullRequestNumber: target.pullRequestNumber,
        mergeCommit: pullRequest.mergeCommitSha,
        pullRequestUrl: pullRequest.htmlUrl,
      }),
      target,
    );
  }

  /** Read the pull request, reading again while GitHub still computes it. */
  async function readPullRequest(number, signal) {
    let pullRequest;
    for (let attempt = 1; attempt <= mergeabilityAttempts; attempt += 1) {
      pullRequest = await github.getPullRequest({
        number,
        signal: requestSignal(signal, requestTimeoutMilliseconds),
      });
      if (pullRequest.mergeableState !== mergeableStates.unknown) {
        return pullRequest;
      }
      if (attempt < mergeabilityAttempts) {
        await sleep(retryDelayMilliseconds, signal);
        signal?.throwIfAborted();
      }
    }
    return pullRequest;
  }

  /**
   * The refusal of a live pull request that is not clearly mergeable, or null.
   * Unknown mergeability after the retries is unreadable.
   */
  function refusalFor(pullRequest, target, classification) {
    // A merged pull request is not simply "not open": the person must learn that
    // the change is already in the project, not that it can never be merged.
    if (pullRequest.merged === true) return refusals.alreadyMerged;
    if (pullRequest.state !== "open") return refusals.notOpen;
    if (pullRequest.draft) return refusals.draft;
    if (pullRequest.baseRef !== "main") return refusals.notMainBase;
    if (
      pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()
    ) {
      return refusals.notMainRepository;
    }
    if (pullRequest.headSha !== target.commit) return refusals.headMoved;
    // A maintainer's revocation wins over the label in the final live read.
    if (pullRequest.previewRevoked) return refusals.previewRevoked;
    if (!pullRequest.previewLabeled) return refusals.noPreviewLabel;
    // An unreadable mergeability makes the check reads pointless.
    if (pullRequest.mergeableState === mergeableStates.unknown) {
      return refusals.unreadable;
    }
    if (classification.state !== "success") return refusals.checksNotGreen;
    switch (pullRequest.mergeableState) {
      case mergeableStates.clean:
        return null;
      case mergeableStates.behind:
        return refusals.behind;
      default:
        return refusals.notClean;
    }
  }

  /**
   * Re-read the live state of the pinned commit. The pull request is returned
   * with its refusal so the reply can use its review URL without a second read.
   */
  async function readMergeState(target, signal) {
    const initial = await readPullRequest(target.pullRequestNumber, signal);
    if (initial.mergeableState === mergeableStates.unknown) {
      return { pullRequest: initial, refusal: refusals.unreadable };
    }
    // Keep the mergeability retries, then check a consistent live head and its checks.
    const live = await readLivePullRequest({
      github,
      number: target.pullRequestNumber,
      requiredChecks,
      signal: requestSignal(signal, requestTimeoutMilliseconds),
    });
    const pullRequest = live.pullRequest;
    const refusal = refusalFor(pullRequest, target, live.classification);
    return { pullRequest, refusal };
  }

  function readPullRequestOf(pullRequestNumber, signal) {
    return github.getPullRequest({
      number: pullRequestNumber,
      signal: requestSignal(signal, requestTimeoutMilliseconds),
    });
  }

  function closeAsReconciled(row, mergeCommit) {
    if (!store.markMerged(row.update_identifier, mergeCommit)) {
      return false;
    }
    safeTrace({
      updateIdentifier: row.update_identifier,
      authorIdentifier: row.author_identifier,
      sessionKey: row.session_key,
      action: "merge_reconciled",
      detail: `${describeTarget(rowTarget(row))} ${mergeCommit}`,
    });
    return true;
  }

  /**
   * The pull request and commit a person confirms to clear an unknown result.
   * The unknown PUT was pinned to the row's commit with `sha`, so once the head
   * has moved and GitHub shows the pull request unmerged, that merge can no
   * longer happen. The explicit SHA of the current head, from a verified member,
   * is then the decision ADR 0013 requires to reconcile, not to merge.
   */
  function confirmationTarget(row, pullRequest) {
    if (pullRequest.headSha === row.commit_sha) {
      return rowTarget(row);
    }
    return { ...rowTarget(row), commit: pullRequest.headSha };
  }

  /**
   * The request this one must settle before anything else: an earlier merge of
   * the same pull request, in this topic, with an unknown result. Reading the
   * pull request decides: merged closes the row; closed without merging closes
   * it for good; an open one waits for the person, who clears it with the strict
   * `/merge <PR> <SHA>` of the row's commit, or of the current head once it has
   * moved. A short form only reads that result and never clears it.
   *
   * Returns `{ answer }` when the request ends here, `{ cleared }` with the
   * confirmed target when the row was cleared, or null when this topic has no
   * unknown result for the pull request. A cleared row never merges from the
   * same request.
   */
  async function settleUncertain(
    request,
    pullRequestNumber,
    command,
    { signal } = {},
  ) {
    const row = store
      .uncertain()
      .find(
        (candidate) =>
          candidate.pull_request_number === pullRequestNumber &&
          candidate.session_key === request.sessionKey,
      );
    if (row === undefined) {
      return null;
    }
    const target = rowTarget(row);
    let pullRequest;
    try {
      pullRequest = await readPullRequestOf(row.pull_request_number, signal);
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "merge_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return {
        answer: refuse(
          request,
          refusals.unreadable,
          mergeReports.unreadable(target),
          target,
        ),
      };
    }
    if (pullRequest.merged) {
      tryRecord(() => closeAsReconciled(row, pullRequest.mergeCommitSha));
      return {
        answer: {
          outcome: "answered",
          report: mergeReports.reconciled({
            pullRequestNumber: row.pull_request_number,
            mergeCommit: pullRequest.mergeCommitSha,
            pullRequestUrl: pullRequest.htmlUrl,
          }),
        },
      };
    }
    if (pullRequest.state !== "open") {
      // The pull request is closed without merging: that merge can never happen,
      // so it never waits for a person again on every start.
      tryRecord(() => store.markNotMerged(row.update_identifier));
      return {
        answer: refuse(
          request,
          refusals.uncertainClosed,
          mergeReports.uncertainClosed(target),
          target,
        ),
      };
    }
    const confirmation = confirmationTarget(row, pullRequest);
    // A short form names no commit, so it can never confirm and clear the row.
    if (command.commit !== confirmation.commit) {
      return {
        answer: refuse(
          request,
          refusals.uncertainPending,
          mergeReports.uncertainOpen(confirmation),
          target,
        ),
      };
    }
    // The person confirmed the commit: GitHub does not show the unknown result
    // merged, so the row ends. A row that cannot be closed still blocks the
    // request: it must never be passed with the unknown result still open.
    if (!tryRecord(() => store.markNotMerged(row.update_identifier))) {
      return {
        answer: refuse(
          request,
          refusals.uncertainPending,
          mergeReports.uncertainOpen(confirmation),
          target,
        ),
      };
    }
    traceRequest(
      request,
      "merge_uncertain_cleared",
      describeTarget(confirmation),
    );
    return { cleared: confirmation };
  }

  /** Resolve the pull request and commit of the newest delivered preview. */
  function resolveDelivered(request, command, delivered) {
    if (delivered === undefined) {
      return {
        answer: refuse(
          request,
          refusals.noDeliveredPreview,
          mergeReports.noDeliveredPreview,
        ),
      };
    }
    const target = {
      pullRequestNumber: delivered.pull_request_number,
      commit: delivered.commit_sha,
    };
    if (
      command.pullRequestNumber !== undefined &&
      command.pullRequestNumber !== target.pullRequestNumber
    ) {
      return {
        answer: refuse(
          request,
          refusals.otherPullRequest,
          mergeReports.otherPullRequest({
            requestedNumber: command.pullRequestNumber,
            pullRequestNumber: target.pullRequestNumber,
          }),
          target,
        ),
      };
    }
    if (command.commit !== undefined && command.commit !== target.commit) {
      return {
        answer: refuse(
          request,
          refusals.commitMismatch,
          mergeReports.commitMismatch(target),
          target,
        ),
      };
    }
    if (
      hasNewerWork({
        sessionKey: request.sessionKey,
        updateIdentifier: request.updateIdentifier,
      })
    ) {
      return {
        answer: refuse(
          request,
          refusals.newerWork,
          mergeReports.newerWork(target),
          target,
        ),
      };
    }
    return { target };
  }

  /** Record the end of a merge whose result is known; the answer never depends on it. */
  function tryRecord(recordEnd) {
    try {
      return recordEnd() !== false;
    } catch (error) {
      logger(
        "merge_state_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return false;
    }
  }

  function answerRejectedOrUnknown(request, target, error) {
    if (isDefiniteRejection(error)) {
      logger("merge_failed", error.name);
      traceRequest(
        request,
        "merge_failed",
        `${describeTarget(target)} HTTP ${statusClass(error.status)}`,
      );
      // If the end cannot be saved the row stays `merging` and the restart reads
      // the pull request, so the answer is the unknown-result one.
      if (tryRecord(() => store.markFailed(request.updateIdentifier))) {
        return {
          outcome: "answered",
          report: mergeReports.failed(target),
        };
      }
      return { outcome: "answered", report: mergeReports.uncertain(target) };
    }
    // The merge may or may not have happened: it is never requested again
    // blindly, and the next request reads the pull request first.
    logger("merge_uncertain", error instanceof Error ? error.name : "unknown");
    traceRequest(request, "merge_uncertain", describeTarget(target));
    tryRecord(() => store.markUncertain(request.updateIdentifier));
    return { outcome: "answered", report: mergeReports.uncertain(target) };
  }

  async function requestMerge(request, target, signal, pullRequestUrl) {
    traceRequest(request, "merge_requested", describeTarget(target));
    let merged;
    try {
      merged = await github.mergePullRequest({
        number: target.pullRequestNumber,
        sha: target.commit,
        signal: requestSignal(signal, requestTimeoutMilliseconds),
      });
    } catch (error) {
      return answerRejectedOrUnknown(request, target, error);
    }
    traceRequest(
      request,
      "merge_completed",
      `#${target.pullRequestNumber} ${target.commit} ${mergeMethod} ${merged.mergeCommitSha}`,
    );
    const report = {
      pullRequestNumber: target.pullRequestNumber,
      mergeCommit: merged.mergeCommitSha,
      pullRequestUrl,
    };
    // The merge happened. If the end cannot be saved the row stays `merging` and
    // the restart reads the pull request and closes it as merged.
    const saved = tryRecord(() =>
      store.markMerged(request.updateIdentifier, merged.mergeCommitSha),
    );
    return {
      outcome: "answered",
      report: saved
        ? mergeReports.merged(report)
        : mergeReports.mergedUnsaved(report),
    };
  }

  async function membershipRefusal(request, signal) {
    // The membership is verified before GitHub is asked anything: a person who
    // left the group can neither merge nor make the service read a pull request
    // for them.
    const membership = await verifyMembership(request.authorIdentifier, signal);
    // A service stop is an abort, not a refusal; a read that ran out of its own
    // deadline is a failed check below and asks the person to try again.
    signal?.throwIfAborted();
    if (!membership.verified) {
      if (membership.reason === "membership_check_failed") {
        return refuse(
          request,
          refusals.membershipUnavailable,
          mergeReports.membershipUnavailable,
        );
      }
      return refuse(
        request,
        refusals.membershipRevoked,
        mergeReports.membershipRevoked,
      );
    }
    return null;
  }

  /** The instruction runner calls this for a recognised merge command. */
  async function handle(request, command, { signal } = {}) {
    if (!command.valid) {
      return refuse(request, refusals.usage, mergeReports.usage);
    }
    const denied = await membershipRefusal(request, signal);
    if (denied !== null) return denied;

    const delivered = findDeliveredPreview(request.sessionKey) ?? undefined;
    // The unknown result of this topic's pull request is settled first: a short
    // form only reads it, and only the full form clears it. Neither clears and
    // merges in the same request.
    const pullRequestNumber =
      command.pullRequestNumber ?? delivered?.pull_request_number;
    if (pullRequestNumber !== undefined) {
      const settled = await settleUncertain(
        request,
        pullRequestNumber,
        command,
        { signal },
      );
      if (settled?.answer) return settled.answer;
      if (settled?.cleared) {
        return {
          outcome: "answered",
          report: mergeReports.uncertainCleared(settled.cleared),
        };
      }
    }
    return mergeDelivered(request, command, delivered, signal);
  }

  async function mergeDelivered(request, command, delivered, signal) {
    const { target, answer } = resolveDelivered(request, command, delivered);
    if (answer) {
      return answer;
    }
    traceRequest(request, "merge_membership_verified", describeTarget(target));

    let mergeState;
    try {
      mergeState = await readMergeState(target, signal);
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "merge_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      mergeState = { pullRequest: null, refusal: refusals.unreadable };
    }
    if (mergeState.refusal === refusals.alreadyMerged) {
      return alreadyMergedAnswer(request, target, mergeState.pullRequest);
    }
    if (mergeState.refusal !== null) {
      return refuse(
        request,
        mergeState.refusal,
        refusalTexts[mergeState.refusal](target),
        target,
      );
    }

    // The live reads awaited GitHub. Immediately before the durable request and
    // the PUT, the delivered preview and the work of the topic are read again:
    // a newer notice, another pull request or commit, or newer work refuses
    // instead of merging a state the person no longer confirmed.
    const current = findDeliveredPreview(request.sessionKey) ?? undefined;
    const rechecked = resolveDelivered(request, command, current);
    if (rechecked.answer) {
      return rechecked.answer;
    }
    if (
      current.notice_message_identifier !==
        delivered.notice_message_identifier ||
      rechecked.target.pullRequestNumber !== target.pullRequestNumber ||
      rechecked.target.commit !== target.commit
    ) {
      return refuse(
        request,
        refusals.noDeliveredPreview,
        mergeReports.noDeliveredPreview,
      );
    }

    const begun = store.begin({
      updateIdentifier: request.updateIdentifier,
      sessionKey: request.sessionKey,
      authorIdentifier: request.authorIdentifier,
      pullRequestNumber: target.pullRequestNumber,
      commitSha: target.commit,
    });
    if (begun === mergeBeginResults.duplicate) {
      return refuse(
        request,
        refusals.alreadyHandled,
        mergeReports.alreadyHandled,
        target,
      );
    }
    if (begun === mergeBeginResults.open) {
      return refuse(
        request,
        refusals.alreadyInProgress,
        mergeReports.alreadyInProgress(target),
        target,
      );
    }
    return requestMerge(
      request,
      target,
      signal,
      mergeState.pullRequest.htmlUrl,
    );
  }

  async function offerQuestion(request, signal) {
    const delivered = findDeliveredPreview(request.sessionKey) ?? undefined;
    if (
      delivered?.notice_message_identifier !== request.replyMessageIdentifier
    ) {
      return quietConfirmation;
    }
    const { target, answer } = resolveDelivered(request, {}, delivered);
    if (answer || store.hasOpenRequest(target.pullRequestNumber)) {
      return quietConfirmation;
    }
    const key = {
      sessionKey: request.sessionKey,
      noticeMessageIdentifier: delivered.notice_message_identifier,
      authorIdentifier: request.authorIdentifier,
    };
    if (store.hasQuestion(key)) return quietConfirmation;

    const stillCurrent = () => {
      const current = findDeliveredPreview(request.sessionKey);
      return (
        current?.update_identifier === delivered.update_identifier &&
        current.notice_message_identifier === key.noticeMessageIdentifier &&
        current.pull_request_number === target.pullRequestNumber &&
        current.commit_sha === target.commit &&
        !hasNewerWork(request) &&
        !store.hasOpenRequest(target.pullRequestNumber)
      );
    };
    try {
      const live = await readMergeState(target, signal);
      if (live.refusal !== null || !stillCurrent()) return quietConfirmation;
      const { chatIdentifier, threadIdentifier } = parseSessionKey(
        request.sessionKey,
      );
      const sent = await telegram.sendMessage({
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text: mergeReports.question,
        signal: requestSignal(signal, requestTimeoutMilliseconds),
      });
      if (isNoticeMessageIdentifier(sent?.message_id) && stillCurrent()) {
        const saved = store.saveQuestion({
          ...key,
          questionMessageIdentifier: sent.message_id,
          publicationUpdateIdentifier: delivered.update_identifier,
          validationUpdateIdentifier: request.updateIdentifier,
          pullRequestNumber: target.pullRequestNumber,
          commitSha: target.commit,
        });
        if (saved) {
          traceRequest(
            request,
            "merge_question_asked",
            `#${target.pullRequestNumber} ${target.commit}`,
          );
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "merge_question_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    return quietConfirmation;
  }

  async function handleConfirmation(request, intent, { signal } = {}) {
    if (
      !isNoticeMessageIdentifier(request.replyMessageIdentifier) ||
      intent === null ||
      intent !== mergeConfirmationIntent(request.instruction)
    ) {
      return quietConfirmation;
    }
    if (intent === "validate") {
      if ((await membershipRefusal(request, signal)) !== null)
        return quietConfirmation;
      return offerQuestion(request, signal);
    }
    const key = {
      sessionKey: request.sessionKey,
      questionMessageIdentifier: request.replyMessageIdentifier,
      authorIdentifier: request.authorIdentifier,
    };
    const question = store.question(key);
    if (
      !question ||
      question.consumed_at !== null ||
      question.author_identifier !== request.authorIdentifier
    ) {
      return quietConfirmation;
    }
    const denied = await membershipRefusal(request, signal);
    if (denied !== null)
      return { ...denied, outcome: mergeConfirmationOutcome };
    if (!store.consumeQuestion(key)) return quietConfirmation;

    const target = rowTarget(question);
    const delivered = findDeliveredPreview(request.sessionKey);
    if (
      delivered?.update_identifier !== question.publication_update_identifier ||
      delivered.notice_message_identifier !==
        question.notice_message_identifier ||
      delivered.pull_request_number !== target.pullRequestNumber ||
      delivered.commit_sha !== target.commit ||
      hasInterveningInstructions({
        sessionKey: request.sessionKey,
        afterUpdateIdentifier: question.validation_update_identifier,
        updateIdentifier: request.updateIdentifier,
      })
    ) {
      return {
        ...refuse(
          request,
          refusals.newerWork,
          mergeReports.staleQuestion,
          target,
        ),
        outcome: mergeConfirmationOutcome,
      };
    }
    if (store.hasOpenRequest(target.pullRequestNumber)) {
      const settled = await settleUncertain(
        request,
        target.pullRequestNumber,
        {},
        { signal },
      );
      return {
        ...(settled?.answer ??
          refuse(
            request,
            refusals.alreadyInProgress,
            mergeReports.alreadyInProgress(target),
            target,
          )),
        outcome: mergeConfirmationOutcome,
      };
    }
    traceRequest(
      request,
      "merge_confirmation_used",
      `#${target.pullRequestNumber} ${target.commit} ${mergeMethod}`,
    );
    const result = await mergeDelivered(request, target, delivered, signal);
    return { ...result, outcome: mergeConfirmationOutcome };
  }

  function contextualIntent(request, text = request.instruction) {
    if (!isNoticeMessageIdentifier(request.replyMessageIdentifier)) return null;
    const intent = mergeConfirmationIntent(text);
    if (intent === "validate") {
      const delivered = findDeliveredPreview(request.sessionKey);
      return delivered?.notice_message_identifier ===
        request.replyMessageIdentifier
        ? intent
        : null;
    }
    if (intent === "confirm") {
      return store.question({
        sessionKey: request.sessionKey,
        questionMessageIdentifier: request.replyMessageIdentifier,
      })
        ? intent
        : null;
    }
    return null;
  }

  /**
   * Tell the topic an unknown result it must decide on. A failed send is retried
   * on the next start, so the note carries the identity of the effect: the
   * session receives it once, whatever the number of attempts.
   */
  async function sendToTopic(row, text, { signal, state }) {
    const { chatIdentifier, threadIdentifier } = parseSessionKey(
      row.session_key,
    );
    recordServiceNote({
      sessionKey: row.session_key,
      text,
      effectKey: `merge:${row.update_identifier}:${state}`,
    });
    await telegram.sendMessage({
      chatIdentifier,
      messageThreadIdentifier: threadIdentifier,
      text,
      signal: requestSignal(signal, requestTimeoutMilliseconds),
    });
  }

  /**
   * At startup, read every request with an unknown result. A pull request that
   * GitHub shows merged closes the request and is reported. Otherwise the topic
   * is told once, with the strict command that lets a person decide. A read or a
   * send that fails leaves the request as it was for the next start or request.
   */
  async function reconcileUncertain({ signal } = {}) {
    for (const row of store.uncertain()) {
      if (signal?.aborted) return;
      try {
        const pullRequest = await readPullRequestOf(
          row.pull_request_number,
          signal,
        );
        if (pullRequest.merged) {
          await sendToTopic(
            row,
            mergeReports.reconciled({
              pullRequestNumber: row.pull_request_number,
              mergeCommit: pullRequest.mergeCommitSha,
              pullRequestUrl: pullRequest.htmlUrl,
            }),
            { signal, state: "reconciled" },
          );
          tryRecord(() => closeAsReconciled(row, pullRequest.mergeCommitSha));
          continue;
        }
        if (pullRequest.state !== "open") {
          // Closed without merging: that merge can never happen, so the row ends
          // instead of staying uncertain on every start.
          if (row.notified_at === null) {
            await sendToTopic(
              row,
              mergeReports.uncertainClosed(rowTarget(row)),
              { signal, state: "uncertain" },
            );
            store.markNotified(row.update_identifier);
          }
          tryRecord(() => store.markNotMerged(row.update_identifier));
          continue;
        }
        if (row.notified_at !== null) continue;
        await sendToTopic(
          row,
          mergeReports.uncertainOpen(confirmationTarget(row, pullRequest)),
          { signal, state: "uncertain" },
        );
        store.markNotified(row.update_identifier);
      } catch (error) {
        logger(
          "merge_reconcile_failed",
          error instanceof Error ? error.name : "unknown",
        );
      }
    }
  }

  return { handle, handleConfirmation, contextualIntent, reconcileUncertain };
}
