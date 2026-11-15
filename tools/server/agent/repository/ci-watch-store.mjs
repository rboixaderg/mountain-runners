// Private, durable tracking of one CI notification per published commit and of
// the bounded automatic repairs of a failing CI.
//
// Registering the watch is durable before the workflow reports the pull
// request, so a restart resumes the pending notifications instead of losing
// them. Sending to Telegram and committing SQLite cannot be atomic: a send
// interrupted between `sending` and `sent` has an unknown delivery and is never
// replayed automatically.
//
// A repair attempt is durable before the notice is sent and before the worktree
// is touched. The budget is counted per pull request and failing-check set, so
// it survives a restart and a new commit: the same failure cannot be repaired
// automatically more than twice in a row. Only an attempt that was taken counts,
// and the same watch, commit and failure is reserved once. A reservation cannot
// run: it becomes claimable (`queued`) only once its announcement is delivered,
// so the result can never reach the topic before the notice.

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
  CREATE TABLE IF NOT EXISTS ci_repairs (
    sequence INTEGER PRIMARY KEY,
    update_identifier INTEGER NOT NULL,
    session_key TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL,
    failure_fingerprint TEXT NOT NULL,
    failed_checks TEXT NOT NULL,
    evidence TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'queued', 'running', 'done', 'aborted', 'uncertain')),
    outcome TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ci_repairs_attempt_identity
    ON ci_repairs (update_identifier, commit_sha, failure_fingerprint);
`;

const finishedRepairStatuses = new Set(["done", "aborted", "uncertain"]);

export class CiWatchStore {
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

  /**
   * The latest watch of every pull request this service published: the owner
   * topic, whether that watch is also the newest row of its topic, and the
   * result of the latest notice that was actually delivered. An interrupted or
   * unknown delivery is not delivered, so its result proves nothing.
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
   * The commit this topic was last told about: the most recently delivered
   * notice of the session. Only a delivered notice counts, and its result says
   * whether that commit was reported as green.
   */
  lastReported(sessionKey) {
    return this.#database
      .prepare(
        `SELECT pull_request_number, commit_sha, result FROM ci_watches
         WHERE session_key = ? AND state = 'sent'
         ORDER BY updated_at DESC, update_identifier DESC LIMIT 1`,
      )
      .get(sessionKey);
  }

  /**
   * Whether the topic has work newer than its last notice: a publication whose
   * notice is not delivered yet, or an automatic repair that is reserved,
   * queued or running. Either one will end with a new report.
   */
  hasUnreportedWork(sessionKey) {
    return (
      this.#database
        .prepare(
          `SELECT 1 WHERE EXISTS (
             SELECT 1 FROM ci_watches
             WHERE session_key = ? AND state IN ('pending', 'sending')
           ) OR EXISTS (
             SELECT 1 FROM ci_repairs
             WHERE session_key = ? AND status IN ('reserved', 'queued', 'running')
           )`,
        )
        .get(sessionKey, sessionKey) !== undefined
    );
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
    return this.#transaction(() => {
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
      return interrupted;
    });
  }

  /**
   * Follow the commit an automatic repair published, in the same topic and
   * conversation slot. Only a finished watch is reopened: a pending or sending
   * row is never overwritten.
   */
  reopen({ updateIdentifier, sessionKey, pullRequestNumber, commitSha }) {
    const timestamp = this.#now().toISOString();
    return (
      this.#database
        .prepare(
          `UPDATE ci_watches
           SET session_key = ?, pull_request_number = ?, commit_sha = ?, state = 'pending',
               result = NULL, created_at = ?, updated_at = ?
           WHERE update_identifier = ? AND state IN ('sent', 'uncertain')`,
        )
        .run(
          sessionKey,
          pullRequestNumber,
          commitSha,
          timestamp,
          timestamp,
          updateIdentifier,
        ).changes === 1
    );
  }

  /**
   * Reserve one automatic repair of the same failing checks, or return null
   * when the consecutive budget is exhausted. Counting before the attempt is
   * what bounds a restart or a repeated cycle. The same watch, commit and
   * failure can be reserved only once: a restart between the reservation and
   * the notice reuses the attempt instead of spending another one.
   */
  requestRepair({
    updateIdentifier,
    sessionKey,
    pullRequestNumber,
    failureFingerprint,
    failedChecks,
    evidence,
    commitSha,
    maximumAttempts,
  }) {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT sequence, attempt_number FROM ci_repairs
           WHERE update_identifier = ? AND commit_sha = ? AND failure_fingerprint = ?`,
        )
        .get(updateIdentifier, commitSha, failureFingerprint);
      if (existing !== undefined) {
        return {
          sequence: existing.sequence,
          attemptNumber: existing.attempt_number,
        };
      }
      // Only an attempt that was taken counts: a reserved or queued attempt
      // that a new publication left behind never ran.
      const { count } = this.#database
        .prepare(
          `SELECT COUNT(*) AS count FROM ci_repairs
           WHERE pull_request_number = ? AND failure_fingerprint = ?
             AND status NOT IN ('reserved', 'queued')`,
        )
        .get(pullRequestNumber, failureFingerprint);
      if (count >= maximumAttempts) {
        return null;
      }
      const timestamp = this.#now().toISOString();
      const { lastInsertRowid } = this.#database
        .prepare(
          `INSERT INTO ci_repairs
             (update_identifier, session_key, pull_request_number, failure_fingerprint,
              failed_checks, evidence, commit_sha, attempt_number, status, outcome,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', NULL, ?, ?)`,
        )
        .run(
          updateIdentifier,
          sessionKey,
          pullRequestNumber,
          failureFingerprint,
          JSON.stringify(failedChecks),
          JSON.stringify(evidence),
          commitSha,
          count + 1,
          timestamp,
          timestamp,
        );
      return { sequence: Number(lastInsertRowid), attemptNumber: count + 1 };
    });
  }

  /** Make a reserved repair claimable once its announcement was delivered. */
  queueRepair(sequence) {
    return (
      this.#database
        .prepare(
          `UPDATE ci_repairs SET status = 'queued', updated_at = ?
           WHERE sequence = ? AND status = 'reserved'`,
        )
        .run(this.#now().toISOString(), sequence).changes === 1
    );
  }

  /**
   * Take the oldest queued repair. One repair runs at a time; a running row
   * blocks the next claim until it finishes or is marked uncertain.
   */
  claimNextRepair() {
    return this.#transaction(() => {
      const running = this.#database
        .prepare("SELECT 1 FROM ci_repairs WHERE status = 'running' LIMIT 1")
        .get();
      if (running) {
        return null;
      }
      const repair = this.#database
        .prepare(
          "SELECT * FROM ci_repairs WHERE status = 'queued' ORDER BY sequence LIMIT 1",
        )
        .get();
      if (!repair) {
        return null;
      }
      this.#database
        .prepare(
          `UPDATE ci_repairs SET status = 'running', updated_at = ?
           WHERE sequence = ? AND status = 'queued'`,
        )
        .run(this.#now().toISOString(), repair.sequence);
      return repair;
    });
  }

  /** End a running repair. Only a finished outcome can leave `running`. */
  finishRepair(sequence, { status, outcome }) {
    if (!finishedRepairStatuses.has(status)) {
      throw new Error(`Invalid repair status ${status}.`);
    }
    return (
      this.#database
        .prepare(
          `UPDATE ci_repairs SET status = ?, outcome = ?, updated_at = ?
           WHERE sequence = ? AND status = 'running'`,
        )
        .run(status, outcome ?? null, this.#now().toISOString(), sequence)
        .changes === 1
    );
  }

  /** One durable attempt, for the operator and for the tests. */
  repair(sequence) {
    return this.#database
      .prepare("SELECT * FROM ci_repairs WHERE sequence = ?")
      .get(sequence);
  }

  /** Total repairs whose external result is still unknown, including restarts. */
  uncertainRepairCount() {
    const { count } = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM ci_repairs WHERE status = 'uncertain'",
      )
      .get();
    return count;
  }

  /** Repairs whose external result is unknown, oldest first. */
  uncertainRepairs() {
    return this.#database
      .prepare(
        `SELECT sequence, update_identifier, session_key, pull_request_number,
                commit_sha, created_at
         FROM ci_repairs WHERE status = 'uncertain' ORDER BY sequence`,
      )
      .all();
  }

  /**
   * Close an uncertain repair once a person checked GitHub, and return it. The
   * guarded update matches the Telegram update, the row sequence and the failed
   * commit, so a sequence that a later repair reused is never resolved by an
   * older command. No CI watch is reopened: the commit is not followed again.
   */
  resolveUncertainRepair({
    updateIdentifier,
    sequence,
    failedCommit,
    outcome,
  }) {
    return this.#transaction(() => {
      const changed =
        this.#database
          .prepare(
            `UPDATE ci_repairs SET status = 'done', outcome = ?, updated_at = ?
             WHERE sequence = ? AND update_identifier = ? AND commit_sha = ?
               AND status = 'uncertain'`,
          )
          .run(
            outcome,
            this.#now().toISOString(),
            sequence,
            updateIdentifier,
            failedCommit,
          ).changes === 1;
      if (!changed) {
        return null;
      }
      return this.#database
        .prepare(
          `SELECT sequence, update_identifier, session_key, pull_request_number,
                  commit_sha, created_at
           FROM ci_repairs WHERE sequence = ?`,
        )
        .get(sequence);
    });
  }

  /**
   * A restart cannot know whether the interrupted repair published anything.
   * It is never repeated automatically and the caller must reconcile it.
   */
  interruptRepairs() {
    return this.#transaction(() => {
      const interrupted = this.#database
        .prepare(
          `SELECT sequence, update_identifier, session_key, pull_request_number, commit_sha
           FROM ci_repairs WHERE status = 'running' ORDER BY sequence`,
        )
        .all();
      if (interrupted.length > 0) {
        this.#database
          .prepare(
            `UPDATE ci_repairs SET status = 'uncertain', updated_at = ?
             WHERE status = 'running'`,
          )
          .run(this.#now().toISOString());
      }
      return interrupted;
    });
  }

  /**
   * Forget the automatic repair budget of a pull request: a green CI or a new
   * human publication starts the next failure from scratch. A running, queued or
   * reserved attempt is preserved, so the topic still receives its result, and an
   * uncertain one keeps blocking the service until a person reconciles it.
   */
  resetRepairs(pullRequestNumber) {
    this.#database
      .prepare(
        `DELETE FROM ci_repairs
         WHERE pull_request_number = ? AND status IN ('done', 'aborted')`,
      )
      .run(pullRequestNumber);
  }

  close() {
    this.#database.close();
  }
}
