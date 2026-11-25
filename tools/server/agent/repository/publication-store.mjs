// Private, durable record of every commit the service publishes: one row that
// carries its CI notice and its preview.
//
// The row is durable before the workflow reports the pull request, so a restart
// resumes what is pending instead of losing it. Both halves start together and
// end on their own.
//
// The CI watch stays `pending` until its notice is sent: sending to Telegram and
// committing SQLite cannot be atomic, so after a failed or interrupted send the
// notice is sent again and can repeat (ADR 0014). A newer commit of a pull
// request supersedes the older pending watch of the same pull request: it can
// neither be delivered nor describe the current head, so it stops counting as
// unreported work.
//
// The preview starts `awaiting` the trusted publisher, and a restart keeps its
// deadline. The origin that publisher confirmed is stored with the row, because
// the model of the topic never builds or guesses a preview URL and cannot read
// GitHub from its sandbox. The identifier of the notice Telegram accepted is
// stored in the same statement that confirms it: only a confirmed preview that
// kept it is a delivered preview a later confirmation can point at. A notice
// that failed, was uncertain or left no usable identifier stores nothing.

import { runTransaction } from "./sqlite.mjs";
import { openStateDatabase } from "./state-database.mjs";

/**
 * A Telegram message identifier a reply can point at: a positive safe integer.
 * Anything else is no link at all.
 */
export function isNoticeMessageIdentifier(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export const previewStates = {
  awaiting: "awaiting",
  confirmed: "confirmed",
  timedOut: "timed_out",
  failed: "failed",
};

// The states a preview can end in. A confirmed end also carries the origin the
// trusted publisher confirmed.
const terminalPreviewStates = new Set([
  previewStates.confirmed,
  previewStates.timedOut,
  previewStates.failed,
]);

export class PublicationStore {
  #database;
  #now;

  constructor(path, { now = () => new Date() } = {}) {
    this.#database = openStateDatabase(path);
    this.#now = now;
  }

  /**
   * Record a commit the service published: its CI watch is pending and its
   * preview awaits the publisher. It supersedes the older pending watches of the
   * pull request, and ends its awaiting merge synchronizations: the service
   * replaced their commit, so they have no withdrawal to report.
   *
   * Recording the same update again, as a repeated reconciliation does, arms the
   * preview again. The CI watch of the same commit stays as it is; another
   * commit replaces the row.
   */
  record({
    updateIdentifier,
    sessionKey,
    authorIdentifier,
    pullRequestNumber,
    commitSha,
    mergeSynchronization = false,
  }) {
    runTransaction(this.#database, () => {
      const timestamp = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE publications SET ci_state = 'superseded'
           WHERE pull_request_number = ? AND ci_state = 'pending'
             AND update_identifier != ?`,
        )
        .run(pullRequestNumber, updateIdentifier);
      this.#database
        .prepare(
          `UPDATE publications
           SET preview_state = 'failed', preview_updated_at = ?
           WHERE pull_request_number = ? AND merge_synchronization = 1
             AND preview_state = 'awaiting' AND update_identifier != ?`,
        )
        .run(timestamp, pullRequestNumber, updateIdentifier);
      this.#database
        .prepare(
          `INSERT INTO publications
           (update_identifier, session_key, author_identifier, pull_request_number,
            commit_sha, merge_synchronization, ci_state, preview_state,
            created_at, preview_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'awaiting', ?, ?)
           ON CONFLICT (update_identifier) DO UPDATE SET
             session_key = excluded.session_key,
             author_identifier = excluded.author_identifier,
             pull_request_number = excluded.pull_request_number,
             commit_sha = excluded.commit_sha,
             merge_synchronization = excluded.merge_synchronization,
             ci_state = CASE WHEN commit_sha = excluded.commit_sha
               THEN COALESCE(ci_state, 'pending') ELSE 'pending' END,
             ci_result = CASE WHEN commit_sha = excluded.commit_sha
               THEN ci_result END,
             created_at = CASE WHEN commit_sha = excluded.commit_sha
               THEN created_at ELSE excluded.created_at END,
             preview_state = 'awaiting',
             confirmed_origin = NULL,
             notice_message_identifier = NULL,
             preview_updated_at = excluded.preview_updated_at`,
        )
        .run(
          updateIdentifier,
          sessionKey,
          authorIdentifier,
          pullRequestNumber,
          commitSha,
          Number(mergeSynchronization),
          timestamp,
          timestamp,
        );
    });
  }

  pendingCiWatches() {
    return this.#database
      .prepare(
        "SELECT * FROM publications WHERE ci_state = 'pending' ORDER BY update_identifier",
      )
      .all();
  }

  ciState(updateIdentifier) {
    return this.#database
      .prepare("SELECT ci_state FROM publications WHERE update_identifier = ?")
      .get(updateIdentifier)?.ci_state;
  }

  /** Record the delivered CI notice of a watch that is still pending. */
  finishCiNotice(updateIdentifier, result) {
    return (
      this.#database
        .prepare(
          `UPDATE publications SET ci_state = 'sent', ci_result = ?
           WHERE update_identifier = ? AND ci_state = 'pending'`,
        )
        .run(result, updateIdentifier).changes === 1
    );
  }

  /**
   * The pull request of the newest publishing update of the topic, or null. A
   * reconciled publication is recorded late, so this orders by update and not by
   * creation time.
   */
  topicPullRequestNumber(sessionKey) {
    return (
      this.#database
        .prepare(
          `SELECT pull_request_number FROM publications
           WHERE session_key = ? AND ci_state IS NOT NULL
           ORDER BY update_identifier DESC LIMIT 1`,
        )
        .get(sessionKey)?.pull_request_number ?? null
    );
  }

  /**
   * Whether the topic has a publication whose CI notice is not delivered yet. It
   * will end with a new report, so an older notice cannot authorize a merge or
   * a preview.
   */
  hasUnreportedWork(sessionKey) {
    return (
      this.#database
        .prepare(
          "SELECT 1 FROM publications WHERE session_key = ? AND ci_state = 'pending' LIMIT 1",
        )
        .get(sessionKey) !== undefined
    );
  }

  awaitingPreviews() {
    return this.#database
      .prepare(
        "SELECT * FROM publications WHERE preview_state = 'awaiting' ORDER BY update_identifier",
      )
      .all();
  }

  previewState(updateIdentifier) {
    return this.#database
      .prepare(
        "SELECT preview_state FROM publications WHERE update_identifier = ?",
      )
      .get(updateIdentifier)?.preview_state;
  }

  /**
   * End an awaiting preview. The confirmed origin and the identifier of the
   * notice Telegram accepted are written with the state, in one statement: a
   * confirmation never ends without the URL the publisher confirmed, and
   * `preview_updated_at` becomes the moment the preview ended. A second claim
   * never succeeds. Only a terminal state can end a preview, because an ended
   * one is never described by a state it cannot reach. The commit is the one the
   * caller read: a row rewritten for a newer commit in the meantime is not ended
   * by the result of the older one.
   *
   * An identifier that is no positive Telegram message id is rejected instead of
   * stored, and a confirmation without one is stored as such: the preview ends,
   * and it is never a delivered preview another confirmation can point at.
   */
  finishPreview(
    updateIdentifier,
    commitSha,
    state,
    origin = null,
    noticeMessageIdentifier = null,
  ) {
    if (!terminalPreviewStates.has(state)) {
      throw new Error(`Invalid preview end state ${state}.`);
    }
    if (state === previewStates.confirmed && origin === null) {
      throw new Error("A confirmed preview requires the origin it confirmed.");
    }
    if (
      noticeMessageIdentifier !== null &&
      !isNoticeMessageIdentifier(noticeMessageIdentifier)
    ) {
      throw new TypeError(
        "A notice message identifier is a positive Telegram message id.",
      );
    }
    // Only a confirmed preview keeps an origin or a notice identifier: one that
    // ended another way never leaves a URL or a link behind.
    const confirmed = state === previewStates.confirmed;
    return (
      this.#database
        .prepare(
          `UPDATE publications
           SET preview_state = ?, confirmed_origin = ?,
               notice_message_identifier = ?, preview_updated_at = ?
           WHERE update_identifier = ? AND commit_sha = ?
             AND preview_state = 'awaiting'`,
        )
        .run(
          state,
          confirmed ? origin : null,
          confirmed ? noticeMessageIdentifier : null,
          this.#now().toISOString(),
          updateIdentifier,
          commitSha,
        ).changes === 1
    );
  }

  /**
   * The delivered preview of the latest publication of the topic, independently
   * of its CI notice, or undefined. A latest publication whose preview is still
   * pending, ended another way or kept no usable identifier has none, and
   * nothing falls back to an earlier one.
   */
  deliveredPreview(sessionKey) {
    const row = this.#database
      .prepare(
        `SELECT * FROM publications
         WHERE session_key = ? AND ci_state IS NOT NULL
         ORDER BY created_at DESC, update_identifier DESC LIMIT 1`,
      )
      .get(sessionKey);
    return row?.preview_state === previewStates.confirmed &&
      isNoticeMessageIdentifier(row.notice_message_identifier)
      ? row
      : undefined;
  }

  close() {
    this.#database.close();
  }
}
