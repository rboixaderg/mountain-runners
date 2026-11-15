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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

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

  #transition(updateIdentifier, fromState, toState, commentedAt = null) {
    return (
      this.#database
        .prepare(
          `UPDATE preview_requests
           SET state = ?, commented_at = COALESCE(?, commented_at), updated_at = ?
           WHERE update_identifier = ? AND state = ?`,
        )
        .run(
          toState,
          commentedAt,
          this.#now().toISOString(),
          updateIdentifier,
          fromState,
        ).changes === 1
    );
  }

  /** The comment was posted at `commentedAt`, the time GitHub reported. */
  markAwaiting(updateIdentifier, commentedAt) {
    return this.#transition(
      updateIdentifier,
      previewStates.commenting,
      previewStates.awaiting,
      commentedAt,
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

  /** End an awaiting request. A second claim never succeeds. */
  finish(updateIdentifier, state) {
    return this.#transition(updateIdentifier, previewStates.awaiting, state);
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
