// Deterministic preview report (T8.4, preview label).
//
// The `preview` label the service sets when it opens the pull request of a
// topic makes the trusted publisher build every head of it, with or without
// green checks: the build validates the head and a red one is never published.
// Every publication of the service follows the preview of the commit it pushed,
// and a verified person can also ask in natural language for the preview of the
// topic's pull request. The model is never started for either. The request is
// bound to the current head of that open pull request, which can be newer than
// the commit the service pushed when a maintainer updated it outside the agent.
// The URL is never built or guessed: only the publisher's own comment naming
// the pinned commit is reported.
//
// Before reporting, the pull request is read again: a closed pull request, a
// newer head, a removed `preview` label or a `preview-revoked` label ends the
// request without announcing any preview. The publisher's comment can predate
// the request, because the label starts the build when the head is pushed.
//
// The publisher's workflow runs for the label cannot be attributed to a pull
// request or a head, so a build that failed is not detected: the request waits
// for its deadline and then says it could not confirm the preview.
//
// The author's membership is asked again when a person's request runs, as the
// merge does: a preview publishes the pull request, so it is not ordinary
// queued work.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import { confirmedPreviewOrigin } from "../repository/preview-comment.mjs";
import {
  isNoticeMessageIdentifier,
  previewBeginResults,
  previewStates,
} from "../repository/preview-request-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
  sleep,
} from "../repository/request-signal.mjs";
import {
  maintainerAttentionAction,
  previewNotes,
  previewReports,
  previewUnconfirmedReason,
  pullRequestReviewUrl,
} from "../policy/development.mjs";

const refusals = {
  membershipRevoked: "membership_revoked",
  membershipUnavailable: "membership_unavailable",
  noPullRequest: "no_pull_request",
  alreadyInProgress: "already_in_progress",
  alreadyHandled: "already_handled",
  notApplicable: "not_applicable",
  notMainRepository: "not_main_repository",
  noPreviewLabel: "no_preview_label",
  previewRevoked: "preview_revoked",
  unreadable: "unreadable",
};

function describeTarget({ pullRequestNumber, commit }) {
  return `#${pullRequestNumber} ${commit.slice(0, 7)}`;
}

/**
 * The identifier a reply to the delivered notice points at, or null. Only a
 * positive Telegram message id links a reply: anything else leaves the notice
 * delivered but unidentified, and a later confirmation never points at it.
 */
function deliveredNoticeIdentifier(message) {
  const identifier = message?.message_id;
  return isNoticeMessageIdentifier(identifier) ? identifier : null;
}

export function createPreviewRequests({
  store,
  findTopicPullRequest,
  verifyMembership,
  github,
  repository,
  telegram,
  pollIntervalMilliseconds,
  confirmationTimeoutMilliseconds,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
  recordTrace = () => {},
  // The text of a report is an effect the next turn of the topic must know.
  recordServiceNote = () => {},
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

  function refuse(request, reason, text, detail) {
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_refused",
      detail: detail ?? reason,
    });
    return { outcome: "answered", report: text };
  }

  /**
   * Why the live pull request has no preview to report, or null. Only an open
   * pull request of the main repository that carries the `preview` label and
   * not `preview-revoked` has one.
   */
  function refusalOf(pullRequest) {
    if (pullRequest.state !== "open") return refusals.notApplicable;
    if (
      pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()
    ) {
      return refusals.notMainRepository;
    }
    if (pullRequest.previewRevoked) return refusals.previewRevoked;
    if (!pullRequest.previewLabeled) {
      return refusals.noPreviewLabel;
    }
    return null;
  }

  const refusalTexts = {
    [refusals.notApplicable]: previewReports.notApplicable,
    [refusals.notMainRepository]: previewReports.notMainRepository,
    [refusals.noPreviewLabel]: previewReports.noPreviewLabel,
    [refusals.previewRevoked]: previewReports.previewRevoked,
    [refusals.unreadable]: previewReports.unreadable,
  };

  /** The instruction runner calls this for a request classified as `preview`. */
  async function handle(request, { signal } = {}) {
    const pullRequestNumber = findTopicPullRequest(request.sessionKey);
    if (pullRequestNumber === null) {
      return refuse(
        request,
        refusals.noPullRequest,
        previewReports.noPullRequest,
      );
    }
    const reviewUrl = pullRequestReviewUrl({ repository, pullRequestNumber });
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_requested",
      detail: `#${pullRequestNumber}`,
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
          previewReports.membershipUnavailable({ reviewUrl }),
        );
      }
      return refuse(
        request,
        refusals.membershipRevoked,
        previewReports.membershipRevoked({ reviewUrl }),
      );
    }
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_membership_verified",
      detail: `#${pullRequestNumber}`,
    });

    let pullRequest;
    try {
      pullRequest = await github.getPullRequest({
        number: pullRequestNumber,
        signal: requestSignal(signal, requestTimeoutMilliseconds),
      });
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "preview_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return refuse(
        request,
        refusals.unreadable,
        previewReports.unreadable({ reviewUrl }),
        `${refusals.unreadable} #${pullRequestNumber}`,
      );
    }
    // Every later step — the stored row, the confirmation, the traces and the
    // note — uses this head, so the report stays bound to the exact SHA that
    // was read.
    const previewTarget = { pullRequestNumber, commit: pullRequest.headSha };
    const refusal = refusalOf(pullRequest);
    if (refusal !== null) {
      return refuse(
        request,
        refusal,
        refusalTexts[refusal]({ reviewUrl }),
        `${refusal} ${describeTarget(previewTarget)}`,
      );
    }

    const begun = store.begin({
      updateIdentifier: request.updateIdentifier,
      sessionKey: request.sessionKey,
      authorIdentifier: request.authorIdentifier,
      pullRequestNumber: previewTarget.pullRequestNumber,
      commitSha: previewTarget.commit,
    });
    if (begun === previewBeginResults.duplicate) {
      return refuse(
        request,
        refusals.alreadyHandled,
        previewReports.alreadyHandled({ reviewUrl }),
        `${refusals.alreadyHandled} ${describeTarget(previewTarget)}`,
      );
    }
    if (begun === previewBeginResults.open) {
      return refuse(
        request,
        refusals.alreadyInProgress,
        previewReports.alreadyInProgress({ reviewUrl }),
        `${refusals.alreadyInProgress} ${describeTarget(previewTarget)}`,
      );
    }

    // Nothing is posted: the label already asks the publisher to build every
    // head, so the request was stored already waiting for the comment.
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_awaiting",
      detail: describeTarget(previewTarget),
    });
    return {
      outcome: "answered",
      report: previewReports.requested({ reviewUrl }),
    };
  }

  /**
   * Follow the preview of a commit the service just published. A repair has no
   * author: it follows its commit in the row of the publication it continues.
   * The publication is already done, so a bookkeeping failure only logs.
   */
  function followPublication({
    updateIdentifier,
    sessionKey,
    authorIdentifier,
    pullRequestNumber,
    commit,
    repair,
    mergeSynchronization,
  }) {
    try {
      if (repair) {
        return store.reopen({
          updateIdentifier,
          pullRequestNumber,
          commitSha: commit,
        });
      }
      store.track({
        updateIdentifier,
        sessionKey,
        authorIdentifier,
        pullRequestNumber,
        commitSha: commit,
        mergeSynchronization,
      });
      return true;
    } catch (error) {
      logger(
        "preview_follow_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return false;
    }
  }

  /**
   * Whether the report reached Telegram, with the identifier of the message it
   * accepted, or null when the send failed. A failed send is retried by the next
   * cycle, so the note carries the identity of the effect: the session receives
   * it once, whatever the number of attempts. The note keeps the facts the next
   * turn of the model needs; the text sent to the topic stays plain.
   *
   * The identifier a later reply points at is what Telegram answered with: an
   * answer without a usable one leaves the notice delivered but unidentified.
   */
  async function report(row, text, { signal, state, note }) {
    const { chatIdentifier, threadIdentifier } = parseSessionKey(
      row.session_key,
    );
    // The note keeps the facts the next turn of the model needs, while the text
    // sent to the topic stays plain. `receivedText` is that plain reply, so the
    // last text of the topic reads as the person read it.
    recordServiceNote({
      sessionKey: row.session_key,
      text: note,
      receivedText: text,
      // A repair reopens the row of its publication for a new commit, so the
      // commit is part of the identity of the effect.
      effectKey: `preview:${row.update_identifier}:${row.commit_sha}:${state}`,
    });
    let message;
    try {
      message = await telegram.sendMessage({
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text,
        signal,
      });
    } catch (error) {
      logger(
        "preview_report_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return null;
    }
    return {
      noticeMessageIdentifier: deliveredNoticeIdentifier(message),
    };
  }

  /**
   * One cycle over the requests awaiting the trusted publisher. A row ends only
   * after its report was sent, so a failed send is retried on the next cycle. A
   * crash between the send and the end of the row can repeat the notice once:
   * that is accepted over losing it. A failed read never ends a row by itself,
   * and the deadline is applied only after a successful read. The comments are
   * read before the pull request, so the state that allows the report is never
   * older than the comment it reports. A pull request that no longer has a
   * preview for the pinned commit ends the row without a message: only the
   * final head is reported, by the publication that pushed it or a new request,
   * and a withdrawn preview is never announced.
   * A successful send always finishes the row, because the SQLite transition is
   * safe during a shutdown and the notice was delivered.
   */
  async function runOnce({ signal } = {}) {
    for (const row of store.awaiting()) {
      if (signal?.aborted) return;
      const target = {
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
      };
      const reviewUrl = pullRequestReviewUrl({
        repository,
        pullRequestNumber: row.pull_request_number,
      });

      let comments;
      let pullRequest;
      try {
        comments = await github.listIssueComments({
          number: row.pull_request_number,
          signal: requestSignal(signal, requestTimeoutMilliseconds),
        });
        pullRequest = await github.getPullRequest({
          number: row.pull_request_number,
          signal: requestSignal(signal, requestTimeoutMilliseconds),
        });
      } catch (error) {
        logger(
          "preview_confirmation_read_failed",
          error instanceof Error ? error.name : "unknown",
        );
        continue;
      }
      const withdrawal =
        pullRequest.headSha === row.commit_sha
          ? refusalOf(pullRequest)
          : "superseded";
      if (withdrawal !== null) {
        if (row.merge_synchronization) {
          const notice = await report(row, previewReports.mergeSyncWithdrawn, {
            signal,
            state: "withdrawn",
            note: previewReports.mergeSyncWithdrawn,
          });
          if (notice === null) continue;
        }
        if (
          store.finish(
            row.update_identifier,
            row.commit_sha,
            previewStates.failed,
          )
        ) {
          safeTrace({
            updateIdentifier: row.update_identifier,
            authorIdentifier: row.author_identifier,
            sessionKey: row.session_key,
            action: "preview_withdrawn",
            detail: `${withdrawal} ${describeTarget(target)}`,
          });
        }
        continue;
      }
      const origin = confirmedPreviewOrigin({
        comments,
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
      });
      if (origin !== null) {
        if (signal?.aborted) return;
        const notice = await report(
          row,
          previewReports.confirmed({
            origin,
            reviewUrl,
            mergeSynchronization: row.merge_synchronization === 1,
          }),
          {
            signal,
            state: "confirmed",
            note: previewNotes.confirmed({ ...target, origin }),
          },
        );
        if (notice === null) continue;
        if (notice.noticeMessageIdentifier === null) {
          // The notice reached the topic but Telegram named no message a reply
          // can point at: the row ends, and it is never a delivered preview.
          logger("preview_notice_unidentified", describeTarget(target));
        }
        // The state, the origin the publisher confirmed and the identifier of
        // the notice are written together: a confirmation never ends without
        // the URL, and the next turn of the topic cannot read GitHub and never
        // builds it.
        const ended = store.finish(
          row.update_identifier,
          row.commit_sha,
          previewStates.confirmed,
          origin,
          notice.noticeMessageIdentifier,
        );
        if (!ended) continue;
        safeTrace({
          updateIdentifier: row.update_identifier,
          authorIdentifier: row.author_identifier,
          sessionKey: row.session_key,
          action: "preview_confirmed",
          detail: describeTarget(target),
        });
        continue;
      }

      const expired =
        now().getTime() - Date.parse(row.updated_at) >=
        confirmationTimeoutMilliseconds;
      if (!expired) continue;
      if (signal?.aborted) return;
      const notice = await report(row, previewReports.unconfirmed, {
        signal,
        state: "unconfirmed",
        note: previewNotes.unconfirmed(target),
      });
      if (notice === null) continue;
      // The notice says the case is left for the maintainer, so it is recorded.
      safeTrace({
        updateIdentifier: row.update_identifier,
        authorIdentifier: row.author_identifier,
        sessionKey: row.session_key,
        action: maintainerAttentionAction,
        detail: previewUnconfirmedReason,
      });
      logger(maintainerAttentionAction, previewUnconfirmedReason);
      const ended = store.finish(
        row.update_identifier,
        row.commit_sha,
        previewStates.timedOut,
      );
      if (!ended) continue;
      safeTrace({
        updateIdentifier: row.update_identifier,
        authorIdentifier: row.author_identifier,
        sessionKey: row.session_key,
        action: "preview_unconfirmed",
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

  return { handle, followPublication, runOnce, run };
}
