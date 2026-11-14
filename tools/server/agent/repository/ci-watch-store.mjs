// Private, durable tracking of one CI notification per published commit.
//
// Registering the watch is durable before the workflow reports the pull
// request, so a restart resumes the pending notifications instead of losing
// them. Sending to Telegram and committing SQLite cannot be atomic: a send
// interrupted between `sending` and `sent` has an unknown delivery and is never
// replayed automatically.

import { DatabaseSync } from "node:sqlite";

const schema = `
  CREATE TABLE IF NOT EXISTS ci_watches (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'uncertain')),
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export class CiWatchStore {
  #database;
  #now;

  constructor(path, { now = () => new Date() } = {}) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(schema);
    this.#now = now;
  }

  /** Register the notification for a confirmed publication. */
  add({ updateIdentifier, sessionKey, pullRequestNumber, commitSha }) {
    const timestamp = this.#now().toISOString();
    this.#database
      .prepare(
        `INSERT INTO ci_watches
        (update_identifier, session_key, pull_request_number, commit_sha, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        updateIdentifier,
        sessionKey,
        pullRequestNumber,
        commitSha,
        timestamp,
        timestamp,
      );
  }

  pending() {
    return this.#database
      .prepare(
        "SELECT * FROM ci_watches WHERE state = 'pending' ORDER BY update_identifier",
      )
      .all();
  }

  state(updateIdentifier) {
    return this.#database
      .prepare("SELECT state FROM ci_watches WHERE update_identifier = ?")
      .get(updateIdentifier)?.state;
  }

  /** Claim one result for delivery. A second claim never succeeds. */
  beginSend(updateIdentifier, result) {
    return (
      this.#database
        .prepare(
          `UPDATE ci_watches SET state = 'sending', result = ?, updated_at = ?
           WHERE update_identifier = ? AND state = 'pending'`,
        )
        .run(result, this.#now().toISOString(), updateIdentifier).changes === 1
    );
  }

  finishSend(updateIdentifier) {
    return (
      this.#database
        .prepare(
          `UPDATE ci_watches SET state = 'sent', updated_at = ?
           WHERE update_identifier = ? AND state = 'sending'`,
        )
        .run(this.#now().toISOString(), updateIdentifier).changes === 1
    );
  }

  /**
   * Delivery is unknown: Telegram may or may not have received the message.
   * The watch stays out of `pending` so it is never sent again automatically.
   */
  markUncertain(updateIdentifier) {
    return (
      this.#database
        .prepare(
          `UPDATE ci_watches SET state = 'uncertain', updated_at = ?
           WHERE update_identifier = ? AND state IN ('pending', 'sending')`,
        )
        .run(this.#now().toISOString(), updateIdentifier).changes === 1
    );
  }

  /**
   * A restarted process cannot know whether an interrupted send arrived. Mark
   * every interrupted delivery uncertain and return them, so the caller can
   * attribute each one in the private trace.
   */
  recoverSending() {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const interrupted = this.#database
        .prepare(
          `SELECT update_identifier, session_key, pull_request_number, commit_sha
           FROM ci_watches WHERE state = 'sending' ORDER BY update_identifier`,
        )
        .all();
      if (interrupted.length > 0) {
        this.#database
          .prepare(
            `UPDATE ci_watches SET state = 'uncertain', updated_at = ?
             WHERE state = 'sending'`,
          )
          .run(this.#now().toISOString());
      }
      this.#database.exec("COMMIT");
      return interrupted;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.#database.close();
  }
}
