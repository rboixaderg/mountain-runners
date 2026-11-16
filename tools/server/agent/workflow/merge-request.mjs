// Deterministic `/merge` on request (T8.4).
//
// A verified person asks with the literal command `/merge`, `/merge <PR>` or
// `/merge <PR> <SHA>` to merge the pull request the topic last reported as
// green. Prose is never a merge and the model never sees the command. The
// service pins the request to the commit it last reported to that topic,
// verifies the person's membership again, re-reads the pull request and its
// required checks and only then asks GitHub for a squash merge of exactly that
// commit, with its own credential.
//
// The request is durable before the merge call. A result that is not known is
// never repeated: the next request, or the next start, reads the pull request
// first and closes the request as merged only if GitHub shows it merged.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import { isDefiniteRejection, statusClass } from "../repository/github.mjs";
import { classifyCommitStatus } from "../repository/ci-status.mjs";
import { mergeBeginResults } from "../repository/merge-request-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
  sleep,
} from "../repository/request-signal.mjs";
import { mergeReports, shortCommit } from "../policy/development.mjs";
import { ciResults } from "./ci-watch.mjs";

const mergeCommandPrefix = "/merge";
const mergeCommandPattern =
  /^\/merge(?:[ \t]+#?(\d+)(?:[ \t]+([a-f0-9]{40}))?)?$/u;
const mergeMethod = "squash";
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
  noReportedCommit: "no_reported_commit",
  notGreen: "not_green",
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
  reportedCommits,
  hasNewerWork,
  verifyMembership,
  github,
  repository,
  requiredChecks,
  telegram,
  retryDelayMilliseconds = 2000,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
  recordTrace = () => {},
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
    [refusals.checksNotGreen]: mergeReports.checksNotGreen,
    [refusals.behind]: mergeReports.behind,
    [refusals.notClean]: mergeReports.notClean,
    [refusals.unreadable]: mergeReports.unreadable,
  };

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
   * Re-read the live state of the pinned commit. Any picture that is not clearly
   * mergeable is a refusal; unknown mergeability after the retries is unreadable.
   */
  async function findRefusal(target, signal) {
    const pullRequest = await readPullRequest(target.pullRequestNumber, signal);
    if (pullRequest.state !== "open") return refusals.notOpen;
    if (pullRequest.draft) return refusals.draft;
    if (pullRequest.baseRef !== "main") return refusals.notMainBase;
    if (
      pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()
    ) {
      return refusals.notMainRepository;
    }
    if (pullRequest.headSha !== target.commit) return refusals.headMoved;
    // An unreadable mergeability makes the check reads pointless.
    if (pullRequest.mergeableState === mergeableStates.unknown) {
      return refusals.unreadable;
    }
    const readSignal = requestSignal(signal, requestTimeoutMilliseconds);
    const [checkRuns, statuses] = await Promise.all([
      github.getCommitCheckRuns({ commit: target.commit, signal: readSignal }),
      github.getCommitStatuses({ commit: target.commit, signal: readSignal }),
    ]);
    const classification = classifyCommitStatus({
      requiredChecks,
      checkRuns,
      statuses,
    });
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
   * is then the decision ADR 0013 requires; the full request still binds it to
   * the last reported green commit.
   */
  function confirmationTarget(row, pullRequest) {
    if (pullRequest.headSha === row.commit_sha) {
      return rowTarget(row);
    }
    return { ...rowTarget(row), commit: pullRequest.headSha };
  }

  /**
   * The request this one must settle before anything else: an earlier merge of
   * the same pull request with an unknown result. Reading the pull request
   * decides: merged closes the row; not merged waits for the person, who clears
   * it with the strict `/merge <PR> <SHA>` of the row's commit, or of the current
   * head once it has moved. Returns
   * the answer, or null when the request may go on.
   */
  async function settleUncertain(request, target, command, signal) {
    const row = store
      .uncertain()
      .find(
        (candidate) =>
          candidate.pull_request_number === target.pullRequestNumber,
      );
    if (row === undefined) {
      return null;
    }
    let pullRequest;
    try {
      pullRequest = await readPullRequestOf(row.pull_request_number, signal);
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "merge_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return refuse(
        request,
        refusals.unreadable,
        mergeReports.unreadable(target),
        target,
      );
    }
    if (pullRequest.merged) {
      closeAsReconciled(row, pullRequest.mergeCommitSha);
      return {
        outcome: "answered",
        report: mergeReports.reconciled({
          pullRequestNumber: target.pullRequestNumber,
          mergeCommit: pullRequest.mergeCommitSha,
        }),
      };
    }
    if (pullRequest.state !== "open") {
      return refuse(
        request,
        refusals.uncertainClosed,
        mergeReports.uncertainClosed(rowTarget(row)),
        target,
      );
    }
    const confirmation = confirmationTarget(row, pullRequest);
    if (command.commit !== confirmation.commit) {
      return refuse(
        request,
        refusals.uncertainPending,
        mergeReports.uncertainOpen(confirmation),
        target,
      );
    }
    // The person confirmed the commit: GitHub does not show the unknown result
    // merged, so the row ends and the full request goes on from scratch.
    store.markNotMerged(row.update_identifier);
    traceRequest(
      request,
      "merge_uncertain_cleared",
      describeTarget(rowTarget(row)),
    );
    return null;
  }

  /** The merge commit of a pull request GitHub shows merged, or null. */
  async function readMergedCommit(pullRequestNumber, signal) {
    try {
      const pullRequest = await readPullRequestOf(pullRequestNumber, signal);
      return pullRequest.merged ? pullRequest.mergeCommitSha : null;
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "merge_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return null;
    }
  }

  /** Resolve the pull request and commit this topic last reported as green. */
  async function resolveReported(request, command, signal) {
    const reported = reportedCommits.lastReported(request.sessionKey);
    if (reported === undefined) {
      return {
        answer: refuse(
          request,
          refusals.noReportedCommit,
          mergeReports.noReportedCommit,
        ),
      };
    }
    const target = {
      pullRequestNumber: reported.pull_request_number,
      commit: reported.commit_sha,
    };
    // After a merge the closed-pull-request notice is the topic's last one.
    if (reported.result === ciResults.pullRequestClosed) {
      const mergeCommit = await readMergedCommit(
        target.pullRequestNumber,
        signal,
      );
      if (mergeCommit !== null) {
        return {
          answer: refuse(
            request,
            refusals.alreadyMerged,
            mergeReports.alreadyMerged({
              pullRequestNumber: target.pullRequestNumber,
              mergeCommit,
            }),
            target,
          ),
        };
      }
    }
    if (reported.result !== ciResults.success) {
      return {
        answer: refuse(
          request,
          refusals.notGreen,
          mergeReports.notGreen(target),
          target,
        ),
      };
    }
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
      recordEnd();
      return true;
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
          report: mergeReports.failed({
            ...target,
            statusClass: statusClass(error.status),
          }),
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

  async function requestMerge(request, target, signal) {
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

  /** The instruction runner calls this for a recognised merge command. */
  async function handle(request, command, { signal } = {}) {
    if (!command.valid) {
      return refuse(request, refusals.usage, mergeReports.usage);
    }
    const { target, answer } = await resolveReported(request, command, signal);
    if (answer) {
      return answer;
    }
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
    traceRequest(request, "merge_membership_verified", describeTarget(target));

    const settled = await settleUncertain(request, target, command, signal);
    if (settled !== null) {
      return settled;
    }

    let refusal;
    try {
      refusal = await findRefusal(target, signal);
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "merge_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      refusal = refusals.unreadable;
    }
    if (refusal !== null) {
      return refuse(request, refusal, refusalTexts[refusal](target), target);
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
    return requestMerge(request, target, signal);
  }

  async function sendToTopic(row, text, signal) {
    const { chatIdentifier, threadIdentifier } = parseSessionKey(
      row.session_key,
    );
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
            }),
            signal,
          );
          closeAsReconciled(row, pullRequest.mergeCommitSha);
          continue;
        }
        if (row.notified_at !== null) continue;
        const text =
          pullRequest.state === "open"
            ? mergeReports.uncertainOpen(confirmationTarget(row, pullRequest))
            : mergeReports.uncertainClosed(rowTarget(row));
        await sendToTopic(row, text, signal);
        store.markNotified(row.update_identifier);
      } catch (error) {
        logger(
          "merge_reconcile_failed",
          error instanceof Error ? error.name : "unknown",
        );
      }
    }
  }

  return { handle, reconcileUncertain };
}
