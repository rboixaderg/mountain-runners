// Private, durable tracking of the previews the service follows after it
// publishes.
//
// Since the `preview` label the service posts nothing: a row is written
// directly as `awaiting`. A row awaiting the trusted publisher survives a
// restart and keeps its deadline. A publication of the service follows its own
// preview in the row of the update that published it.
//
// The origin the trusted publisher confirmed is stored with the request, because
// the model of the topic never builds or guesses a preview URL and cannot read
// GitHub from its sandbox.
//
// The identifier of the notice Telegram accepted is stored with the confirmed
// request, in the same statement that ends it: only a confirmed request that
// kept it is a delivered preview a later confirmation can point at. A notice
// that failed, was uncertain or left no usable identifier stores nothing.

import { openDatabase, runTransaction } from "./sqlite.mjs";

const schema = `
  CREATE TABLE IF NOT EXISTS preview_requests (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    author_identifier INTEGER NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('awaiting', 'confirmed', 'timed_out', 'failed')),
    confirmed_origin TEXT,
    notice_message_identifier INTEGER,
    merge_synchronization INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS preview_requests_pull_request
    ON preview_requests (session_key, pull_request_number);
  CREATE INDEX IF NOT EXISTS preview_requests_state
    ON preview_requests (state);
`;

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

// The states a request can end in. A confirmed end also carries the origin the
// trusted publisher confirmed.
const terminalStates = new Set([
  previewStates.confirmed,
  previewStates.timedOut,
  previewStates.failed,
]);

export class PreviewRequestStore {
  #database;
  #now;

  constructor(path, { now = () => new Date() } = {}) {
    this.#database = openDatabase(path);
    this.#database.exec(schema);
    this.#now = now;
  }

  #transaction(callback) {
    return runTransaction(this.#database, callback);
  }

  /**
   * Follow the preview of a commit the service just published. The row of the
   * publishing update is written again for this commit, so a later publication
   * of the same update replaces whatever that row waited for or reported. It
   * also ends the awaiting merge synchronizations of the pull request: the
   * service replaced their commit, so they have no withdrawal to report.
   */
  track({
    updateIdentifier,
    sessionKey,
    authorIdentifier,
    pullRequestNumber,
    commitSha,
    mergeSynchronization = false,
  }) {
    this.#transaction(() => {
      const timestamp = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE preview_requests SET state = 'failed', updated_at = ?
           WHERE pull_request_number = ? AND merge_synchronization = 1
             AND state = 'awaiting' AND update_identifier != ?`,
        )
        .run(timestamp, pullRequestNumber, updateIdentifier);
      this.#database
        .prepare(
          `INSERT INTO preview_requests
           (update_identifier, session_key, author_identifier, pull_request_number, commit_sha, state, created_at, updated_at, merge_synchronization)
           VALUES (?, ?, ?, ?, ?, 'awaiting', ?, ?, ?)
           ON CONFLICT (update_identifier) DO UPDATE SET
             session_key = excluded.session_key,
             author_identifier = excluded.author_identifier,
             pull_request_number = excluded.pull_request_number,
             commit_sha = excluded.commit_sha,
             state = 'awaiting',
             confirmed_origin = NULL,
             notice_message_identifier = NULL,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             merge_synchronization = excluded.merge_synchronization`,
        )
        .run(
          updateIdentifier,
          sessionKey,
          authorIdentifier,
          pullRequestNumber,
          commitSha,
          timestamp,
          timestamp,
          Number(mergeSynchronization),
        );
    });
  }

  #transition(
    updateIdentifier,
    commitSha,
    fromState,
    toState,
    origin = null,
    noticeMessageIdentifier = null,
  ) {
    return (
      this.#database
        .prepare(
          `UPDATE preview_requests
           SET state = ?, confirmed_origin = COALESCE(?, confirmed_origin),
               notice_message_identifier = ?, updated_at = ?
           WHERE update_identifier = ? AND commit_sha = ? AND state = ?`,
        )
        .run(
          toState,
          origin,
          noticeMessageIdentifier,
          this.#now().toISOString(),
          updateIdentifier,
          commitSha,
          fromState,
        ).changes === 1
    );
  }

  /**
   * End an awaiting request. The confirmed origin and the identifier of the
   * notice Telegram accepted are written with the state, in one statement: a
   * confirmation never ends without the URL the publisher confirmed, and
   * `updated_at` becomes the moment the request ended. A second claim never
   * succeeds. Only a terminal state can end a request, because the row of an
   * ended request is never described by a state it cannot reach. The commit is
   * the one the caller read: a row reopened for a newer commit in the meantime
   * is not ended by the result of the older one.
   *
   * An identifier that is no positive Telegram message id is rejected instead of
   * stored, and a confirmation without one is stored as such: the row ends, and
   * it is never a delivered preview another confirmation can point at.
   */
  finish(
    updateIdentifier,
    commitSha,
    state,
    origin = null,
    noticeMessageIdentifier = null,
  ) {
    if (!terminalStates.has(state)) {
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
    // Only a confirmed request keeps an origin or a notice identifier: a request
    // that ended another way never leaves a URL or a link behind.
    const confirmedOrigin = state === previewStates.confirmed ? origin : null;
    const confirmedNotice =
      state === previewStates.confirmed ? noticeMessageIdentifier : null;
    return this.#transition(
      updateIdentifier,
      commitSha,
      previewStates.awaiting,
      state,
      confirmedOrigin,
      confirmedNotice,
    );
  }

  /**
   * The stored row of one publication, only when it is exactly the preview the
   * caller names: the same topic, the same update, the same pull request and the
   * same commit, ended confirmed with the identifier of the notice it delivered.
   * A row that is still pending, ended another way or kept no usable identifier
   * is no delivered preview, and nothing falls back to another row.
   */
  deliveredPublicationPreview({
    sessionKey,
    updateIdentifier,
    pullRequestNumber,
    commitSha,
  }) {
    const row = this.#database
      .prepare("SELECT * FROM preview_requests WHERE update_identifier = ?")
      .get(updateIdentifier);
    if (row === undefined) {
      return null;
    }
    const bound =
      row.session_key === sessionKey &&
      row.state === previewStates.confirmed &&
      row.pull_request_number === pullRequestNumber &&
      row.commit_sha === commitSha &&
      isNoticeMessageIdentifier(row.notice_message_identifier);
    return bound ? row : null;
  }

  awaiting() {
    return this.#database
      .prepare(
        "SELECT * FROM preview_requests WHERE state = 'awaiting' ORDER BY update_identifier",
      )
      .all();
  }

  state(updateIdentifier) {
    return this.#database
      .prepare("SELECT state FROM preview_requests WHERE update_identifier = ?")
      .get(updateIdentifier)?.state;
  }

  close() {
    this.#database.close();
  }
}
