// Deterministic `/preview` on request (T8.4).
//
// A verified person asks in natural language for the preview of the pull
// request the topic reported as green. The model is never started for it: the
// service pins the request to the commit it last reported to that topic,
// re-reads the pull request and its required checks, posts the constant
// `/preview` comment with its own GitHub credential and then waits for the
// trusted publisher of phase 6 to confirm it. The URL is never built or
// guessed: only the publisher's own comment, written after the request and
// naming the pinned commit, is reported.
//
// The author's membership is asked again when the request runs, as the merge
// does: a preview publishes the pull request, so it is not ordinary queued work.
//
// Nothing here runs without a request: a green CI, a new pull request or a
// repair publication never asks for a preview.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import { isDefiniteRejection, statusClass } from "../repository/github.mjs";
import { classifyCommitStatus } from "../repository/ci-status.mjs";
import { confirmedPreviewOrigin } from "../repository/preview-comment.mjs";
import {
  previewBeginResults,
  previewStates,
} from "../repository/preview-request-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
  sleep,
} from "../repository/request-signal.mjs";
import { previewCommand, previewReports } from "../policy/development.mjs";
import { ciResults } from "./ci-watch.mjs";

const refusals = {
  membershipRevoked: "membership_revoked",
  membershipUnavailable: "membership_unavailable",
  noReportedCommit: "no_reported_commit",
  alreadyInProgress: "already_in_progress",
  alreadyHandled: "already_handled",
  notApplicable: "not_applicable",
  notMainRepository: "not_main_repository",
  checksNotGreen: "checks_not_green",
  unreadable: "unreadable",
};

function describeTarget({ pullRequestNumber, commit }) {
  return `#${pullRequestNumber} ${commit.slice(0, 7)}`;
}

export function createPreviewRequests({
  store,
  reportedCommits,
  verifyMembership,
  github,
  repository,
  requiredChecks,
  telegram,
  pollIntervalMilliseconds,
  confirmationTimeoutMilliseconds,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
  recordTrace = () => {},
  logger = () => {},
  now = () => new Date(),
}) {
  function safeTrace(entry) {
    try {
      recordTrace(entry);
    } catch (error) {
      logger(
        "preview_trace_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  function refuse(request, reason, text, target) {
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_refused",
      detail: target ? `${reason} ${describeTarget(target)}` : reason,
    });
    return { outcome: "answered", report: text };
  }

  /**
   * Re-read the live state of the pinned commit. Any picture that is not clearly
   * green on the main repository's open pull request is a refusal.
   */
  async function findRefusal(target, signal) {
    const readSignal = requestSignal(signal, requestTimeoutMilliseconds);
    const pullRequest = await github.getPullRequest({
      number: target.pullRequestNumber,
      signal: readSignal,
    });
    if (pullRequest.state !== "open" || pullRequest.headSha !== target.commit) {
      return refusals.notApplicable;
    }
    if (
      pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()
    ) {
      return refusals.notMainRepository;
    }
    const [checkRuns, statuses] = await Promise.all([
      github.getCommitCheckRuns({ commit: target.commit, signal: readSignal }),
      github.getCommitStatuses({ commit: target.commit, signal: readSignal }),
    ]);
    const classification = classifyCommitStatus({
      requiredChecks,
      checkRuns,
      statuses,
    });
    return classification.state === "success" ? null : refusals.checksNotGreen;
  }

  const refusalTexts = {
    [refusals.notApplicable]: previewReports.notApplicable,
    [refusals.notMainRepository]: previewReports.notMainRepository,
    [refusals.checksNotGreen]: previewReports.checksNotGreen,
    [refusals.unreadable]: previewReports.unreadable,
  };

  /** The instruction runner calls this for a request classified as `preview`. */
  async function handle(request, { signal } = {}) {
    const reported = reportedCommits.lastReported(request.sessionKey);
    if (reported?.result !== ciResults.success) {
      return refuse(
        request,
        refusals.noReportedCommit,
        previewReports.noReportedCommit,
      );
    }
    const target = {
      pullRequestNumber: reported.pull_request_number,
      commit: reported.commit_sha,
    };
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_requested",
      detail: describeTarget(target),
    });

    const membership = await verifyMembership(request.authorIdentifier, signal);
    // A service stop is an abort, not a refusal; a read that ran out of its own
    // deadline is a failed check below and asks the person to try again.
    signal?.throwIfAborted();
    if (!membership.verified) {
      if (membership.reason === "membership_check_failed") {
        return refuse(
          request,
          refusals.membershipUnavailable,
          previewReports.membershipUnavailable,
        );
      }
      return refuse(
        request,
        refusals.membershipRevoked,
        previewReports.membershipRevoked,
      );
    }
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_membership_verified",
      detail: describeTarget(target),
    });

    let refusal;
    try {
      refusal = await findRefusal(target, signal);
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "preview_read_failed",
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
    if (begun === previewBeginResults.duplicate) {
      return refuse(
        request,
        refusals.alreadyHandled,
        previewReports.alreadyHandled,
        target,
      );
    }
    if (begun === previewBeginResults.open) {
      return refuse(
        request,
        refusals.alreadyInProgress,
        previewReports.alreadyInProgress(target),
        target,
      );
    }

    let comment;
    try {
      comment = await github.commentOnPullRequest({
        number: target.pullRequestNumber,
        body: previewCommand,
        signal: requestSignal(signal, requestTimeoutMilliseconds),
      });
    } catch (error) {
      if (isDefiniteRejection(error)) {
        store.markFailed(request.updateIdentifier);
        logger("preview_comment_failed", error.name);
        safeTrace({
          updateIdentifier: request.updateIdentifier,
          authorIdentifier: request.authorIdentifier,
          sessionKey: request.sessionKey,
          action: "preview_failed",
          detail: `${describeTarget(target)} HTTP ${statusClass(error.status)}`,
        });
        return {
          outcome: "answered",
          report: previewReports.failed({
            ...target,
            statusClass: statusClass(error.status),
          }),
        };
      }
      // The comment may or may not exist: it is never posted again blindly.
      store.markUncertain(request.updateIdentifier);
      logger(
        "preview_comment_uncertain",
        error instanceof Error ? error.name : "unknown",
      );
      safeTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: "preview_uncertain",
        detail: describeTarget(target),
      });
      return { outcome: "uncertain", report: previewReports.uncertain(target) };
    }
    store.markAwaiting(request.updateIdentifier, comment.createdAt);
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_commented",
      detail: describeTarget(target),
    });
    return { outcome: "answered", report: previewReports.requested(target) };
  }

  /** Whether the report reached Telegram. */
  async function report(row, text, signal) {
    const { chatIdentifier, threadIdentifier } = parseSessionKey(
      row.session_key,
    );
    try {
      await telegram.sendMessage({
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text,
        signal,
      });
      return true;
    } catch (error) {
      logger(
        "preview_report_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return false;
    }
  }

  /**
   * One cycle over the requests awaiting the trusted publisher. A row ends only
   * after its report was sent, so a failed send is retried on the next cycle. A
   * crash between the send and the end of the row can repeat the notice once:
   * that is accepted over losing it. A failed read never ends a row, and the
   * deadline is applied only after a successful read. The confirmation is
   * always validated against the request, never against a later reconciliation:
   * a publisher comment written after the request still confirms it.
   */
  async function runOnce({ signal } = {}) {
    for (const row of store.awaiting()) {
      if (signal?.aborted) return;
      const target = {
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
      };
      let comments;
      try {
        comments = await github.listIssueComments({
          number: row.pull_request_number,
          since: row.created_at,
          signal: requestSignal(signal, requestTimeoutMilliseconds),
        });
      } catch (error) {
        logger(
          "preview_confirmation_read_failed",
          error instanceof Error ? error.name : "unknown",
        );
        continue;
      }
      const origin = confirmedPreviewOrigin({
        comments,
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
        requestedAt: row.created_at,
      });
      const expired =
        now().getTime() - Date.parse(row.updated_at) >=
        confirmationTimeoutMilliseconds;
      if (origin === null && !expired) continue;
      if (signal?.aborted) return;

      const confirmed = origin !== null;
      const sent = await report(
        row,
        confirmed
          ? previewReports.confirmed({ ...target, origin })
          : previewReports.unconfirmed(target),
        signal,
      );
      if (!sent) continue;
      const ended = store.finish(
        row.update_identifier,
        confirmed ? previewStates.confirmed : previewStates.timedOut,
      );
      if (!ended) continue;
      safeTrace({
        updateIdentifier: row.update_identifier,
        authorIdentifier: row.author_identifier,
        sessionKey: row.session_key,
        action: confirmed ? "preview_confirmed" : "preview_unconfirmed",
        detail: describeTarget(target),
      });
    }
  }

  /** Background loop. It returns only when the signal is aborted. */
  async function run({ signal } = {}) {
    while (!signal?.aborted) {
      try {
        await runOnce({ signal });
      } catch (error) {
        logger(
          "preview_worker_failed",
          error instanceof Error ? error.name : "unknown",
        );
      }
      await sleep(pollIntervalMilliseconds, signal);
    }
  }

  return { handle, runOnce, run };
}
