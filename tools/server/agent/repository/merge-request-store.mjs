// Private, durable tracking of the `/merge` requests of the deterministic
// handler.
//
// The row is durable in `merging` before the merge is requested, so a restart
// can tell that a merge may have happened. Calling GitHub and committing SQLite
// cannot be atomic: an interrupted `merging` row has an unknown result and the
// merge is never requested again blindly. An unknown result stays `uncertain`
// until the real state of the pull request is read.
//
// One Telegram update is one row, so a duplicate update never merges twice, and
// a pull request has at most one row that has not ended.

import { openDatabase, runTransaction } from "./sqlite.mjs";

const schema = `
  CREATE TABLE IF NOT EXISTS merge_requests (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    author_identifier INTEGER NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('merging', 'merged', 'failed', 'uncertain', 'not_merged')),
    merge_commit_sha TEXT,
    notified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS merge_requests_pull_request
    ON merge_requests (session_key, pull_request_number);
`;

export const mergeStates = {
  merging: "merging",
  merged: "merged",
  failed: "failed",
  uncertain: "uncertain",
  notMerged: "not_merged",
};

export const mergeBeginResults = {
  begun: "begun",
  duplicate: "duplicate",
  open: "open",
};

// A request that has not ended: it blocks a new one for the same pull request.
const openStates = [mergeStates.merging, mergeStates.uncertain];

export class MergeRequestStore {
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
   * Record the request before the merge is requested. Returns `duplicate` for
   * an update already handled and `open` while another request for the same
   * pull request has not ended; otherwise `begun`.
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
        .prepare("SELECT 1 FROM merge_requests WHERE update_identifier = ?")
        .get(updateIdentifier);
      if (duplicate) {
        return mergeBeginResults.duplicate;
      }
      const open = this.#database
        .prepare(
          `SELECT 1 FROM merge_requests
           WHERE pull_request_number = ?
             AND state IN (${openStates.map(() => "?").join(", ")})`,
        )
        .get(pullRequestNumber, ...openStates);
      if (open) {
        return mergeBeginResults.open;
      }
      const timestamp = this.#now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO merge_requests
           (update_identifier, session_key, author_identifier, pull_request_number, commit_sha, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'merging', ?, ?)`,
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
      return mergeBeginResults.begun;
    });
  }

  #transition(updateIdentifier, fromStates, toState, mergeCommitSha = null) {
    return (
      this.#database
        .prepare(
          `UPDATE merge_requests
           SET state = ?, merge_commit_sha = COALESCE(?, merge_commit_sha), updated_at = ?
           WHERE update_identifier = ?
             AND state IN (${fromStates.map(() => "?").join(", ")})`,
        )
        .run(
          toState,
          mergeCommitSha,
          this.#now().toISOString(),
          updateIdentifier,
          ...fromStates,
        ).changes === 1
    );
  }

  /** GitHub merged the pull request, whether the call confirmed it or a read did. */
  markMerged(updateIdentifier, mergeCommitSha) {
    return this.#transition(
      updateIdentifier,
      openStates,
      mergeStates.merged,
      mergeCommitSha,
    );
  }

  /**
   * The merge may or may not have happened: it is never repeated blindly. The
   * answer of the request that got here already told the topic.
   *
   * The state and the moment it was told are written together: a crash between
   * the two must not make a restart tell the same unknown result again.
   */
  markUncertain(updateIdentifier) {
    return this.#transaction(() => {
      const changed = this.#transition(
        updateIdentifier,
        [mergeStates.merging],
        mergeStates.uncertain,
      );
      if (changed) this.markNotified(updateIdentifier);
      return changed;
    });
  }

  /** A person confirmed the unknown result as not merged: the request ends. */
  markNotMerged(updateIdentifier) {
    return this.#transition(
      updateIdentifier,
      [mergeStates.uncertain],
      mergeStates.notMerged,
    );
  }

  /** The topic was told about this unknown result, so a restart does not repeat it. */
  markNotified(updateIdentifier) {
    this.#database
      .prepare(
        "UPDATE merge_requests SET notified_at = ? WHERE update_identifier = ?",
      )
      .run(this.#now().toISOString(), updateIdentifier);
  }

  /** GitHub definitely rejected the merge: nothing was merged. */
  markFailed(updateIdentifier) {
    return this.#transition(
      updateIdentifier,
      [mergeStates.merging],
      mergeStates.failed,
    );
  }

  state(updateIdentifier) {
    return this.#database
      .prepare("SELECT state FROM merge_requests WHERE update_identifier = ?")
      .get(updateIdentifier)?.state;
  }

  /**
   * The newest request of a topic for one pull request: the state its next turn
   * reports. A request of another pull request never describes this one.
   */
  latest({ sessionKey, pullRequestNumber }) {
    return this.#database
      .prepare(
        `SELECT update_identifier, pull_request_number, commit_sha, state,
                merge_commit_sha, created_at
         FROM merge_requests
         WHERE session_key = ? AND pull_request_number = ?
         ORDER BY created_at DESC, update_identifier DESC LIMIT 1`,
      )
      .get(sessionKey, pullRequestNumber);
  }

  /** Requests whose result is unknown, oldest first. */
  uncertain() {
    return this.#database
      .prepare(
        "SELECT * FROM merge_requests WHERE state = 'uncertain' ORDER BY update_identifier",
      )
      .all();
  }

  /**
   * A restarted process cannot know whether an interrupted merge happened. Mark
   * every interrupted request uncertain and return them for the private trace.
   */
  recoverMerging() {
    return this.#transaction(() => {
      const interrupted = this.#database
        .prepare(
          `SELECT update_identifier, session_key, author_identifier, pull_request_number, commit_sha
           FROM merge_requests WHERE state = 'merging' ORDER BY update_identifier`,
        )
        .all();
      this.#database
        .prepare(
          `UPDATE merge_requests SET state = 'uncertain', updated_at = ?
           WHERE state = 'merging'`,
        )
        .run(this.#now().toISOString());
      return interrupted;
    });
  }

  close() {
    this.#database.close();
  }
}
