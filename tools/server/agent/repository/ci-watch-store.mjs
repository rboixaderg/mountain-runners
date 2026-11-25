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
// so it stops counting as unreported work. The report of a topic is ordered by
// the publication of its commit, never by the moment a notice happened to be
// delivered.

import { openDatabase, runTransaction } from "./sqlite.mjs";

const watchesTable = `
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
`;

const watchesIndexes = `
  CREATE INDEX IF NOT EXISTS ci_watches_topic_state
    ON ci_watches (session_key, state);
  CREATE INDEX IF NOT EXISTS ci_watches_pull_request
    ON ci_watches (pull_request_number, update_identifier);
`;

const schema = `${watchesTable}${watchesIndexes}`;

/**
 * A store created before a watch could be superseded still carries the old
 * state check. SQLite cannot widen a check in place, so the table is rebuilt
 * once, keeping every row. The indexes follow the renamed table, so they are
 * created again for the new one.
 */
function ensureSupersededState(database) {
  const definition = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ci_watches'",
    )
    .get()?.sql;
  if (definition === undefined || definition.includes("'superseded'")) {
    return;
  }
  runTransaction(database, () => {
    database.exec(`
      ALTER TABLE ci_watches RENAME TO ci_watches_previous;
      ${watchesTable}
      INSERT INTO ci_watches
        (update_identifier, session_key, pull_request_number, commit_sha, state,
         result, created_at, updated_at)
      SELECT update_identifier, session_key, pull_request_number, commit_sha,
             state, result, created_at, updated_at
      FROM ci_watches_previous;
      DROP TABLE ci_watches_previous;
      ${watchesIndexes}
    `);
  });
}

export class CiWatchStore {
  #database;
  #now;

  constructor(path, { now = () => new Date() } = {}) {
    this.#database = openDatabase(path);
    this.#database.exec(schema);
    ensureSupersededState(this.#database);
    this.#now = now;
  }

  #transaction(callback) {
    return runTransaction(this.#database, callback);
  }

  /**
   * Register the notification for a confirmed publication. A newer commit of
   * the same pull request supersedes every older pending watch: that watch can
   * neither be delivered nor describe the head of the pull request any more, so
   * it must not count as unreported work or become the last report. It is kept
   * as `superseded` for the audit.
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

  /**
   * The topic that published the pull request last, taken from its most recent
   * watch. It proves the service published the pull request and names the topic
   * that currently owns it.
   */
  latestPublication(pullRequestNumber) {
    return this.#database
      .prepare(
        `SELECT session_key FROM ci_watches WHERE pull_request_number = ?
         ORDER BY update_identifier DESC LIMIT 1`,
      )
      .get(pullRequestNumber);
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
   * The latest watch of every pull request this service published: the owner
   * topic, whether that watch is also the newest row of its topic, and the
   * result of the latest notice that was actually delivered.
   *
   * Only the newest publication of a topic has a local branch the service can
   * read; the caller decides which pull requests still count as active work.
   */
  latestPublications() {
    return this.#database
      .prepare(
        `SELECT owner.pull_request_number, owner.session_key,
                (SELECT notice.result FROM ci_watches AS notice
                 WHERE notice.pull_request_number = owner.pull_request_number
                   AND notice.state = 'sent'
                 ORDER BY notice.update_identifier DESC LIMIT 1) AS delivered_result,
                owner.update_identifier = topic.latest_identifier AS is_owner_latest
         FROM ci_watches AS owner
         JOIN (
           SELECT pull_request_number, MAX(update_identifier) AS update_identifier
           FROM ci_watches GROUP BY pull_request_number
         ) AS latest
           ON latest.pull_request_number = owner.pull_request_number
          AND latest.update_identifier = owner.update_identifier
         JOIN (
           SELECT session_key, MAX(update_identifier) AS latest_identifier
           FROM ci_watches GROUP BY session_key
         ) AS topic ON topic.session_key = owner.session_key
         ORDER BY owner.pull_request_number`,
      )
      .all();
  }

  /**
   * The commit this topic was last told about: the newest published watch that
   * was delivered. Only a delivered notice counts, and its result says whether
   * that commit was reported as green. The order is the publication order, never
   * the delivery order: a slow older watch cannot overwrite a newer report.
   */
  lastReported(sessionKey) {
    return this.#database
      .prepare(
        `SELECT pull_request_number, commit_sha, result FROM ci_watches
         WHERE session_key = ? AND state = 'sent'
         ORDER BY created_at DESC, update_identifier DESC LIMIT 1`,
      )
      .get(sessionKey);
  }

  /**
   * The newest delivered notice of one pull request. A topic that published
   * several pull requests keeps one report per pull request, so a notice of
   * another one never describes this pull request. The order is again the
   * publication order, not the delivery order. `update_identifier` is the update
   * that published the commit, so a later request of the same pull request can
   * tell whether it came after this notice.
   */
  lastReportedForPullRequest({ sessionKey, pullRequestNumber }) {
    return this.#database
      .prepare(
        `SELECT update_identifier, pull_request_number, commit_sha, result
         FROM ci_watches
         WHERE session_key = ? AND pull_request_number = ? AND state = 'sent'
         ORDER BY created_at DESC, update_identifier DESC LIMIT 1`,
      )
      .get(sessionKey, pullRequestNumber);
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
