// Private, durable tracking of one CI notification per published commit.
//
// Registering the watch is durable before the workflow reports the pull
// request, so a restart resumes the pending notifications instead of losing
// them. A watch stays `pending` until its notice is sent: sending to Telegram
// and committing SQLite cannot be atomic, so after a failed or interrupted send
// the notice is sent again and can repeat (ADR 0014).
//
// A newer commit of a pull request supersedes the older pending watch of the
// same pull request: it can neither be delivered nor describe the current head,
// so it stops counting as unreported work.

import { openDatabase, runTransaction } from "./sqlite.mjs";

const schema = `
  CREATE TABLE IF NOT EXISTS ci_watches (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'uncertain', 'superseded')),
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ci_watches_topic_state
    ON ci_watches (session_key, state);
  CREATE INDEX IF NOT EXISTS ci_watches_pull_request
    ON ci_watches (pull_request_number, update_identifier);
`;

export class CiWatchStore {
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
   * Register the notification for a confirmed publication. A newer commit of
   * the same pull request supersedes every older pending watch: that watch can
   * neither be delivered nor describe the head of the pull request any more, so
   * it must not count as unreported work. It is kept as `superseded` for the
   * audit.
   */
  add({ updateIdentifier, sessionKey, pullRequestNumber, commitSha }) {
    this.#transaction(() => {
      const timestamp = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE ci_watches SET state = 'superseded', updated_at = ?
           WHERE pull_request_number = ? AND state = 'pending'
             AND update_identifier != ?`,
        )
        .run(timestamp, pullRequestNumber, updateIdentifier);
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
    });
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

  /** The latest publication in the topic. */
  latestTopicPublication(sessionKey) {
    return this.#database
      .prepare(
        `SELECT pull_request_number, commit_sha, update_identifier FROM ci_watches
         WHERE session_key = ? ORDER BY created_at DESC, update_identifier DESC LIMIT 1`,
      )
      .get(sessionKey);
  }

  /**
   * The pull request of the newest publishing update of the topic, or null. A
   * reconciled publication registers its watch late, so this orders by update
   * and not by creation time.
   */
  topicPullRequestNumber(sessionKey) {
    return (
      this.#database
        .prepare(
          `SELECT pull_request_number FROM ci_watches
           WHERE session_key = ? ORDER BY update_identifier DESC LIMIT 1`,
        )
        .get(sessionKey)?.pull_request_number ?? null
    );
  }

  /**
   * Whether the topic has a publication whose notice is not delivered yet. It
   * will end with a new report, so an older notice cannot authorize a merge or
   * a preview.
   */
  hasUnreportedWork(sessionKey) {
    return (
      this.#database
        .prepare(
          "SELECT 1 FROM ci_watches WHERE session_key = ? AND state = 'pending' LIMIT 1",
        )
        .get(sessionKey) !== undefined
    );
  }

  /** Record the delivered notice of a watch that is still pending. */
  finishSend(updateIdentifier, result) {
    return (
      this.#database
        .prepare(
          `UPDATE ci_watches SET state = 'sent', result = ?, updated_at = ?
           WHERE update_identifier = ? AND state = 'pending'`,
        )
        .run(result, this.#now().toISOString(), updateIdentifier).changes === 1
    );
  }

  close() {
    this.#database.close();
  }
}
