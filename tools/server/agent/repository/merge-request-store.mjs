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
//
// The question that authorizes a merge is stored in the same database, after its
// send was confirmed: a failed or unknown send leaves no valid question. It is
// fixed to the notice, the publication, the pull request, the commit and the
// person, and it is consumed once by a guarded write. A consumed question is
// kept, so a repeated reply is answered deterministically instead of looking
// like an unknown message, and a restart never consumes it again. An unanswered
// question that a new validation replaces is deleted: nobody used it.

import { runTransaction } from "./sqlite.mjs";
import { openStateDatabase } from "./state-database.mjs";

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
    this.#database = openStateDatabase(path);
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
      if (this.hasOpenRequest(pullRequestNumber)) {
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

  /**
   * Store the question of one validation, only after its send was confirmed, so
   * a failed or unknown send leaves no valid question. One validation offers at
   * most one question, whatever message identifier a retry would use; returns
   * whether the question was stored.
   */
  saveQuestion({
    sessionKey,
    questionMessageIdentifier,
    noticeMessageIdentifier,
    publicationUpdateIdentifier,
    validationUpdateIdentifier,
    authorIdentifier,
    pullRequestNumber,
    commitSha,
  }) {
    return (
      this.#database
        .prepare(
          `INSERT INTO merge_questions
           (session_key, question_message_identifier, notice_message_identifier,
            publication_update_identifier, validation_update_identifier,
            author_identifier, pull_request_number, commit_sha, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .run(
          sessionKey,
          questionMessageIdentifier,
          noticeMessageIdentifier,
          publicationUpdateIdentifier,
          validationUpdateIdentifier,
          authorIdentifier,
          pullRequestNumber,
          commitSha,
          this.#now().toISOString(),
        ).changes === 1
    );
  }

  /**
   * The question a reply must answer, within its topic. It is returned after it
   * was consumed, so a repeated confirmation is recognized instead of looking
   * like an unknown message.
   */
  question({ sessionKey, questionMessageIdentifier }) {
    return this.#database
      .prepare(
        `SELECT * FROM merge_questions
         WHERE session_key = ? AND question_message_identifier = ?`,
      )
      .get(sessionKey, questionMessageIdentifier);
  }

  /** Drop the unanswered question this person has for this notice. */
  retireQuestion({ sessionKey, noticeMessageIdentifier, authorIdentifier }) {
    this.#database
      .prepare(
        `DELETE FROM merge_questions
         WHERE session_key = ? AND notice_message_identifier = ?
           AND author_identifier = ? AND consumed_at IS NULL`,
      )
      .run(sessionKey, noticeMessageIdentifier, authorIdentifier);
  }

  /**
   * Take the question once, for the person it was fixed to. The guarded write is
   * durable: a duplicate reply, another person or a restart after it never
   * consumes it twice.
   */
  consumeQuestion({ sessionKey, questionMessageIdentifier, authorIdentifier }) {
    return (
      this.#database
        .prepare(
          `UPDATE merge_questions SET consumed_at = ?
           WHERE session_key = ? AND question_message_identifier = ?
             AND author_identifier = ? AND consumed_at IS NULL`,
        )
        .run(
          this.#now().toISOString(),
          sessionKey,
          questionMessageIdentifier,
          authorIdentifier,
        ).changes === 1
    );
  }

  /** Whether a merge of this pull request is running or its result is unknown. */
  hasOpenRequest(pullRequestNumber) {
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM merge_requests
           WHERE pull_request_number = ?
             AND state IN (${openStates.map(() => "?").join(", ")})`,
        )
        .get(pullRequestNumber, ...openStates) !== undefined
    );
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
