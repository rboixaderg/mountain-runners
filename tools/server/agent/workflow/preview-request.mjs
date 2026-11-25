// Deterministic preview report (T8.4, preview label).
//
// The `preview` label the service sets when it opens the pull request of a
// topic makes the trusted publisher build every head of it, with or without
// green checks: the build validates the head and a red one is never published.
// Every publication of the service follows the preview of the commit it pushed;
// the model is never involved. The URL is never built or guessed: only the
// publisher's own comment naming the pinned commit is reported.
//
// Before reporting, the pull request is read again: a closed pull request, a
// newer head, a removed `preview` label or a `preview-revoked` label ends the
// row without announcing any preview. The publisher's comment can predate the
// follow-up, because the label starts the build when the head is pushed.
//
// The publisher's workflow runs for the label cannot be attributed to a pull
// request or a head, so a build that failed is not detected: the row waits for
// its deadline and then says it could not confirm the preview.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import { confirmedPreviewOrigin } from "../repository/preview-comment.mjs";
import {
  isNoticeMessageIdentifier,
  previewStates,
} from "../repository/publication-store.mjs";
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
  github,
  repository,
  telegram,
  pollIntervalMilliseconds,
  confirmationTimeoutMilliseconds,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
  recordTrace = () => {},
  // The text of a report is an effect the next turn of the topic must know.
  recordServiceNote,
  // Whether the topic of a request has another instruction queued, running or
  // of unknown result, which may have published a newer commit.
  hasWorkInProgress,
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

  /**
   * Why the live pull request has no preview to report, or null. Only an open
   * pull request of the main repository that carries the `preview` label and
   * not `preview-revoked` has one.
   */
  function withdrawalOf(pullRequest) {
    if (pullRequest.state !== "open") return "not_applicable";
    if (
      pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()
    ) {
      return "not_main_repository";
    }
    if (pullRequest.previewRevoked) return "preview_revoked";
    if (!pullRequest.previewLabeled) return "no_preview_label";
    return null;
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
    // sent to the topic stays plain.
    recordServiceNote({
      sessionKey: row.session_key,
      text: note,
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

  /** Report a row past its deadline as unconfirmed and end it. */
  async function expire(row, target, { signal }) {
    const expired =
      now().getTime() - Date.parse(row.preview_updated_at) >=
      confirmationTimeoutMilliseconds;
    if (!expired) return;
    if (signal?.aborted) return;
    const notice = await report(row, previewReports.unconfirmed, {
      signal,
      state: "unconfirmed",
      note: previewNotes.unconfirmed(target),
    });
    if (notice === null) return;
    // The notice says the case is left for the maintainer, so it is recorded.
    safeTrace({
      updateIdentifier: row.update_identifier,
      authorIdentifier: row.author_identifier,
      sessionKey: row.session_key,
      action: maintainerAttentionAction,
      detail: previewUnconfirmedReason,
    });
    logger(maintainerAttentionAction, previewUnconfirmedReason);
    const ended = store.finishPreview(
      row.update_identifier,
      row.commit_sha,
      previewStates.timedOut,
    );
    if (!ended) return;
    safeTrace({
      updateIdentifier: row.update_identifier,
      authorIdentifier: row.author_identifier,
      sessionKey: row.session_key,
      action: "preview_unconfirmed",
      detail: describeTarget(target),
    });
  }

  /**
   * One cycle over the requests awaiting the trusted publisher. A row ends only
   * after its report was sent, so a failed send is retried on the next cycle. A
   * crash between the send and the end of the row can repeat the notice once:
   * that is accepted over losing it. A failed read never ends a row by itself,
   * but the deadline applies even when the reads fail. The comments are
   * read before the pull request, so the state that allows the report is never
   * older than the comment it reports. A pull request that no longer has a
   * preview for the pinned commit ends the row without a message: only the
   * final head is reported, by the publication that pushed it or a new request,
   * and a withdrawn preview is never announced.
   * A successful send always finishes the row, because the SQLite transition is
   * safe during a shutdown and the notice was delivered.
   */
  async function runOnce({ signal } = {}) {
    for (const row of store.awaitingPreviews()) {
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
        // A failed read never ends a row, but the deadline still applies.
        await expire(row, target, { signal });
        continue;
      }
      const withdrawal =
        pullRequest.headSha === row.commit_sha
          ? withdrawalOf(pullRequest)
          : "superseded";
      if (withdrawal !== null) {
        if (row.merge_synchronization) {
          // A publication pushes before it follows the new commit, which ends
          // this row: a moved head is only reported once the topic has no work
          // left, and never for a row ended during the reads.
          if (
            withdrawal === "superseded" &&
            hasWorkInProgress({
              sessionKey: row.session_key,
              updateIdentifier: row.update_identifier,
            })
          ) {
            continue;
          }
          if (
            store.previewState(row.update_identifier) !== previewStates.awaiting
          ) {
            continue;
          }
          const notice = await report(row, previewReports.mergeSyncWithdrawn, {
            signal,
            state: "withdrawn",
            note: previewReports.mergeSyncWithdrawn,
          });
          if (notice === null) continue;
        }
        if (
          store.finishPreview(
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
        const ended = store.finishPreview(
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

      await expire(row, target, { signal });
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

  return { runOnce, run };
}
