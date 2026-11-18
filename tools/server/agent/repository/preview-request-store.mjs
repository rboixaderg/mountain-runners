// Private, durable tracking of the `/preview` requests of the deterministic
// handler.
//
// The row is durable in `commenting` before the comment is posted, so a restart
// can tell that a post may have happened. Posting to GitHub and committing
// SQLite cannot be atomic: an interrupted `commenting` row has an unknown
// result and is never posted again automatically. A request awaiting the
// trusted publisher survives a restart and keeps its deadline.
//
// One Telegram update is one row, so a duplicate update never posts twice. A new
// request for the same pull request and commit is allowed only after the
// previous one ended.
//
// The origin the trusted publisher confirmed is stored with the request, because
// the model of the topic never builds or guesses a preview URL and cannot read
// GitHub from its sandbox.

import { DatabaseSync } from "node:sqlite";

const schema = `
  CREATE TABLE IF NOT EXISTS preview_requests (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    author_identifier INTEGER NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('commenting', 'awaiting', 'confirmed', 'timed_out', 'failed', 'uncertain')),
    commented_at TEXT,
    confirmed_origin TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * A store created before the confirmed origin was kept gets the column added. It
 * is null for every request that ended before, and a confirmed request without
 * it simply reports no URL.
 */
function ensureConfirmedOriginColumn(database) {
  const columns = database.prepare("PRAGMA table_info(preview_requests)").all();
  if (columns.some((column) => column.name === "confirmed_origin")) {
    return;
  }
  database.exec(
    "ALTER TABLE preview_requests ADD COLUMN confirmed_origin TEXT",
  );
}

export const previewStates = {
  commenting: "commenting",
  awaiting: "awaiting",
  confirmed: "confirmed",
  timedOut: "timed_out",
  failed: "failed",
  uncertain: "uncertain",
};

export const previewBeginResults = {
  begun: "begun",
  duplicate: "duplicate",
  open: "open",
};

// A request that has not ended: it blocks a new one for the same commit.
const openStates = [
  previewStates.commenting,
  previewStates.awaiting,
  previewStates.uncertain,
];

export class PreviewRequestStore {
  #database;
  #now;

  constructor(path, { now = () => new Date() } = {}) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(schema);
    ensureConfirmedOriginColumn(this.#database);
    this.#now = now;
  }

  #transaction(callback) {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Record the request before it is posted. Returns `duplicate` for an update
   * already handled and `open` while another request for the same pull request
   * and commit has not ended; otherwise `begun`.
   */
  begin({
    updateIdentifier,
    sessionKey,
    authorIdentifier,
    pullRequestNumber,
    commitSha,
  }) {
    return this.#transaction(() => {
      const duplicate = this.#database
        .prepare("SELECT 1 FROM preview_requests WHERE update_identifier = ?")
        .get(updateIdentifier);
      if (duplicate) {
        return previewBeginResults.duplicate;
      }
      const open = this.#database
        .prepare(
          `SELECT 1 FROM preview_requests
           WHERE pull_request_number = ? AND commit_sha = ?
             AND state IN (${openStates.map(() => "?").join(", ")})`,
        )
        .get(pullRequestNumber, commitSha, ...openStates);
      if (open) {
        return previewBeginResults.open;
      }
      const timestamp = this.#now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO preview_requests
           (update_identifier, session_key, author_identifier, pull_request_number, commit_sha, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'commenting', ?, ?)`,
        )
        .run(
          updateIdentifier,
          sessionKey,
          authorIdentifier,
          pullRequestNumber,
          commitSha,
          timestamp,
          timestamp,
        );
      return previewBeginResults.begun;
    });
  }

  #transition(updateIdentifier, fromState, toState, origin = null) {
    return (
      this.#database
        .prepare(
          `UPDATE preview_requests
           SET state = ?, confirmed_origin = COALESCE(?, confirmed_origin), updated_at = ?
           WHERE update_identifier = ? AND state = ?`,
        )
        .run(
          toState,
          origin,
          this.#now().toISOString(),
          updateIdentifier,
          fromState,
        ).changes === 1
    );
  }

  /**
   * The comment was posted at `commentedAt`, the time GitHub reported. The
   * comment moment is kept apart from `updated_at`, which while the request
   * awaits is the reference of the confirmation deadline and only becomes the
   * end moment when the request ends.
   */
  markAwaiting(updateIdentifier, commentedAt) {
    return (
      this.#database
        .prepare(
          `UPDATE preview_requests
           SET state = ?, commented_at = COALESCE(?, commented_at), updated_at = ?
           WHERE update_identifier = ? AND state = ?`,
        )
        .run(
          previewStates.awaiting,
          commentedAt,
          this.#now().toISOString(),
          updateIdentifier,
          previewStates.commenting,
        ).changes === 1
    );
  }

  /** The post may or may not have happened: it is never repeated. */
  markUncertain(updateIdentifier) {
    return this.#transition(
      updateIdentifier,
      previewStates.commenting,
      previewStates.uncertain,
    );
  }

  /** GitHub definitely rejected the post: nothing was created. */
  markFailed(updateIdentifier) {
    return this.#transition(
      updateIdentifier,
      previewStates.commenting,
      previewStates.failed,
    );
  }

  /**
   * End an awaiting request. The confirmed origin is written with the state, in
   * one statement: a confirmation never ends without the URL the publisher
   * confirmed, and `updated_at` becomes the moment the request ended. A second
   * claim never succeeds.
   */
  finish(updateIdentifier, state, origin = null) {
    // Only a confirmed request keeps an origin: a request that ended another way
    // never leaves a URL behind.
    const confirmedOrigin = state === previewStates.confirmed ? origin : null;
    return this.#transition(
      updateIdentifier,
      previewStates.awaiting,
      state,
      confirmedOrigin,
    );
  }

  awaiting() {
    return this.#database
      .prepare(
        "SELECT * FROM preview_requests WHERE state = 'awaiting' ORDER BY update_identifier",
      )
      .all();
  }

  /**
   * Every request whose `/preview` comment was posted, oldest first. It is read
   * to bound the runs of a request with the comment of the next one, whatever
   * state either of them is in: a request that already ended still separates the
   * runs of its neighbours, so the bound never depends on which rows are still
   * awaiting.
   */
  commented() {
    return this.#database
      .prepare(
        `SELECT update_identifier, session_key, pull_request_number, commit_sha,
                state, commented_at, created_at
         FROM preview_requests WHERE commented_at IS NOT NULL
         ORDER BY commented_at, update_identifier`,
      )
      .all();
  }

  /** Requests whose post may or may not have happened, oldest first. */
  uncertain() {
    return this.#database
      .prepare(
        `SELECT update_identifier, session_key, pull_request_number, commit_sha,
                created_at
         FROM preview_requests WHERE state = 'uncertain'
         ORDER BY update_identifier`,
      )
      .all();
  }

  /**
   * A person read GitHub and the `/preview` comment exists: the request waits
   * for the publisher as if the post had been confirmed. The deadline restarts
   * now, because the confirmation is read from this moment on. The guarded
   * update refuses a case that is no longer uncertain.
   */
  resolveUncertainCommented(updateIdentifier) {
    return this.#resolveUncertain(updateIdentifier, previewStates.awaiting);
  }

  /**
   * A person read GitHub and the `/preview` comment does not exist: nothing was
   * posted and the request ends as failed. The guarded update refuses a case
   * that is no longer uncertain.
   */
  resolveUncertainNotCommented(updateIdentifier) {
    return this.#resolveUncertain(updateIdentifier, previewStates.failed);
  }

  #resolveUncertain(updateIdentifier, state) {
    return this.#transaction(() => {
      const timestamp = this.#now().toISOString();
      const commentedAt = state === previewStates.awaiting ? timestamp : null;
      const changed =
        this.#database
          .prepare(
            `UPDATE preview_requests
             SET state = ?, commented_at = COALESCE(?, commented_at), updated_at = ?
             WHERE update_identifier = ? AND state = 'uncertain'`,
          )
          .run(state, commentedAt, timestamp, updateIdentifier).changes === 1;
      if (!changed) {
        return null;
      }
      return this.#database
        .prepare(
          `SELECT update_identifier, session_key, pull_request_number, commit_sha,
                  created_at
           FROM preview_requests WHERE update_identifier = ?`,
        )
        .get(updateIdentifier);
    });
  }

  state(updateIdentifier) {
    return this.#database
      .prepare("SELECT state FROM preview_requests WHERE update_identifier = ?")
      .get(updateIdentifier)?.state;
  }

  /**
   * The origin the trusted publisher confirmed for this commit of the pull
   * request, or null. A later request for the same commit neither removes nor
   * hides it.
   */
  confirmedOrigin({ sessionKey, pullRequestNumber, commitSha }) {
    return (
      this.#database
        .prepare(
          `SELECT confirmed_origin FROM preview_requests
           WHERE session_key = ? AND pull_request_number = ?
             AND commit_sha = ? AND state = ?
             AND confirmed_origin IS NOT NULL
           ORDER BY created_at DESC, update_identifier DESC LIMIT 1`,
        )
        .get(sessionKey, pullRequestNumber, commitSha, previewStates.confirmed)
        ?.confirmed_origin ?? null
    );
  }

  /**
   * The newest request of a topic for one pull request: the state its next turn
   * reports. A request of another pull request never describes this one.
   */
  latest({ sessionKey, pullRequestNumber }) {
    return this.#database
      .prepare(
        `SELECT update_identifier, pull_request_number, commit_sha, state,
                confirmed_origin, commented_at, created_at, updated_at
         FROM preview_requests
         WHERE session_key = ? AND pull_request_number = ?
         ORDER BY created_at DESC, update_identifier DESC LIMIT 1`,
      )
      .get(sessionKey, pullRequestNumber);
  }

  /**
   * A restarted process cannot know whether an interrupted post arrived. Mark
   * every interrupted request uncertain and return them for the private trace.
   */
  recoverCommenting() {
    return this.#transaction(() => {
      const interrupted = this.#database
        .prepare(
          `SELECT update_identifier, session_key, author_identifier, pull_request_number, commit_sha
           FROM preview_requests WHERE state = 'commenting' ORDER BY update_identifier`,
        )
        .all();
      this.#database
        .prepare(
          `UPDATE preview_requests SET state = 'uncertain', updated_at = ?
           WHERE state = 'commenting'`,
        )
        .run(this.#now().toISOString());
      return interrupted;
    });
  }

  /** Requests whose external result is unknown, including earlier restarts. */
  uncertainCount() {
    return this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM preview_requests WHERE state = 'uncertain'",
      )
      .get().count;
  }

  close() {
    this.#database.close();
  }
}
