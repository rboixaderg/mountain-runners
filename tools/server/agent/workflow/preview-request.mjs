// Deterministic preview report on request (T8.4, preview label).
//
// A verified person asks in natural language for the preview of the pull
// request the topic reported. The model is never started for it: the service
// re-reads the pull request, pins the request to the current head of that open
// pull request and waits for the trusted publisher to confirm it. The service
// never asks for the preview here: the `preview` label it set when it opened
// the pull request makes the publisher build every head. A pull request without
// the label has no preview and the service announces none. The head can be
// newer than the commit the topic reported, because a maintainer may have
// updated the pull request outside the agent; the request is bound to that exact
// head commit and only to it. The URL is never built or guessed: only the
// publisher's own comment naming the pinned commit is reported.
//
// The publisher's workflow runs for the label cannot be attributed to a pull
// request or a head, so a build that failed is not detected: the request waits
// for its deadline and then says it could not confirm the preview.
//
// The author's membership is asked again when the request runs, as the merge
// does: a preview publishes the pull request, so it is not ordinary queued work.
//
// Nothing here runs without a request: a green CI, a new pull request or a
// repair publication never starts a report.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
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
import {
  previewNotes,
  previewReports,
  pullRequestReviewUrl,
} from "../policy/development.mjs";

const refusals = {
  membershipRevoked: "membership_revoked",
  membershipUnavailable: "membership_unavailable",
  noReportedCommit: "no_reported_commit",
  newerWork: "newer_work",
  alreadyInProgress: "already_in_progress",
  alreadyHandled: "already_handled",
  notApplicable: "not_applicable",
  notMainRepository: "not_main_repository",
  noPreviewLabel: "no_preview_label",
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
   * Re-read the live state of the topic's pull request and choose the commit the
   * request is bound to: its current head. Any picture that is not an open pull
   * request of the main repository that still carries the `preview` label is a
   * refusal, and the refusal carries the commit it was decided for, so every
   * trace names it.
   */
  async function findRefusal(target, signal) {
    const pullRequest = await github.getPullRequest({
      number: target.pullRequestNumber,
      signal: requestSignal(signal, requestTimeoutMilliseconds),
    });
    // The head is the commit the publisher builds and the comment names, even
    // when it was updated outside the agent after the reported notice.
    const commit = pullRequest.headSha;
    if (pullRequest.state !== "open") {
      return { refusal: refusals.notApplicable, commit: target.commit };
    }
    if (
      pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()
    ) {
      return { refusal: refusals.notMainRepository, commit: target.commit };
    }
    return {
      refusal: pullRequest.previewLabeled ? null : refusals.noPreviewLabel,
      commit,
    };
  }

  const refusalTexts = {
    [refusals.notApplicable]: previewReports.notApplicable,
    [refusals.notMainRepository]: previewReports.notMainRepository,
    [refusals.noPreviewLabel]: previewReports.noPreviewLabel,
    [refusals.unreadable]: previewReports.unreadable,
  };

  /** The instruction runner calls this for a request classified as `preview`. */
  async function handle(request, { signal } = {}) {
    const reported = reportedCommits.lastReported(request.sessionKey);
    if (reported === undefined) {
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
    const reviewUrl = pullRequestReviewUrl({
      repository,
      pullRequestNumber: target.pullRequestNumber,
    });
    // A publication newer than the reported notice, including one whose notice
    // was never confirmed, owns the topic: the older commit can no longer be
    // previewed. The refusal names that newer work, never the notice that was
    // already reported.
    const newerWork = reportedCommits.newestUnreportedWork(request.sessionKey);
    if (newerWork !== undefined) {
      const beingPrepared = newerWork.kind === "repair";
      const detail = beingPrepared
        ? `${refusals.newerWork} #${newerWork.pull_request_number} repair`
        : `${refusals.newerWork} #${newerWork.pull_request_number} ${newerWork.commit_sha.slice(0, 7)}`;
      return refuse(
        request,
        refusals.newerWork,
        previewReports.newerWork({
          reviewUrl: pullRequestReviewUrl({
            repository,
            pullRequestNumber: newerWork.pull_request_number,
          }),
          beingPrepared,
        }),
        detail,
      );
    }
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
      detail: describeTarget(target),
    });

    let decision;
    try {
      decision = await findRefusal(target, signal);
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "preview_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      decision = { refusal: refusals.unreadable, commit: target.commit };
    }
    if (decision.refusal !== null) {
      const refusedTarget = { ...target, commit: decision.commit };
      return refuse(
        request,
        decision.refusal,
        refusalTexts[decision.refusal]({ reviewUrl }),
        `${decision.refusal} ${describeTarget(refusedTarget)}`,
      );
    }

    // Every later step — the stored row, the confirmation, the traces and the
    // note — uses this commit, so the report stays bound to the exact SHA that
    // was read.
    const previewTarget = { ...target, commit: decision.commit };

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
    // head, so the request only starts waiting for the publisher's comment.
    store.markAwaiting(request.updateIdentifier, now().toISOString());
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_commented",
      detail: describeTarget(previewTarget),
    });
    return {
      outcome: "answered",
      report: previewReports.requested({ reviewUrl }),
    };
  }

  /**
   * Whether the report reached Telegram. A failed send is retried by the next
   * cycle, so the note carries the identity of the effect: the session receives
   * it once, whatever the number of attempts. The note keeps the facts the next
   * turn of the model needs; the text sent to the topic stays plain.
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
      effectKey: `preview:${row.update_identifier}:${state}`,
    });
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
   * that is accepted over losing it. A failed read never ends a row by itself,
   * and the deadline is applied only after a successful read of comments. The
   * confirmation is always validated against the request, never against a later
   * reconciliation: a publisher comment naming the pinned commit confirms it,
   * also when the build that wrote it ended before the request began, because
   * the label starts that build when the head is pushed. The endings share one
   * shape: check the stop, send, finish the row,
   * record the trace. A successful send always finishes the row, because the
   * SQLite transition is safe during a shutdown and the notice was delivered.
   */
  async function runOnce({ signal } = {}) {
    const rows = store.awaiting();
    if (rows.length === 0) return;

    for (const row of rows) {
      if (signal?.aborted) return;
      const target = {
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
      };
      // A newer head of the same pull request replaces the publication this
      // request waits for: only the address of the final head is reported, so
      // the older request ends without a message.
      const isSuperseded = rows.some(
        (other) =>
          other.pull_request_number === row.pull_request_number &&
          other.commit_sha !== row.commit_sha &&
          other.update_identifier > row.update_identifier,
      );
      if (isSuperseded) {
        if (store.finish(row.update_identifier, previewStates.failed)) {
          safeTrace({
            updateIdentifier: row.update_identifier,
            authorIdentifier: row.author_identifier,
            sessionKey: row.session_key,
            action: "preview_superseded",
            detail: describeTarget(target),
          });
        }
        continue;
      }
      const reviewUrl = pullRequestReviewUrl({
        repository,
        pullRequestNumber: row.pull_request_number,
      });

      let comments;
      try {
        comments = await github.listIssueComments({
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
      const origin = confirmedPreviewOrigin({
        comments,
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
      });
      // The publisher's comment is read first and always wins: only it names the
      // address, and a run can never contradict a published preview.
      if (origin !== null) {
        if (signal?.aborted) return;
        const sent = await report(
          row,
          previewReports.confirmed({ origin, reviewUrl }),
          {
            signal,
            state: "confirmed",
            note: previewNotes.confirmed({ ...target, origin }),
          },
        );
        if (!sent) continue;
        // The state and the origin the publisher confirmed are written together:
        // a confirmation never ends without the URL, and the next turn of the
        // topic cannot read GitHub and never builds it.
        const ended = store.finish(
          row.update_identifier,
          previewStates.confirmed,
          origin,
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
      const sent = await report(
        row,
        previewReports.unconfirmed({ reviewUrl }),
        {
          signal,
          state: "unconfirmed",
          note: previewNotes.unconfirmed(target),
        },
      );
      if (!sent) continue;
      const ended = store.finish(row.update_identifier, previewStates.timedOut);
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

  return { handle, runOnce, run };
}
