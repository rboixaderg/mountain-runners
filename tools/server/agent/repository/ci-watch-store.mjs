// Private, durable tracking of one CI notification per published commit and of
// the bounded automatic repairs of a failing CI.
//
// Registering the watch is durable before the workflow reports the pull
// request, so a restart resumes the pending notifications instead of losing
// them. Sending to Telegram and committing SQLite cannot be atomic: a send
// interrupted between `sending` and `sent` has an unknown delivery and is never
// replayed automatically.
//
// A newer commit of a pull request supersedes the older pending watch of the
// same pull request: it can neither be delivered nor describe the current head,
// so it stops counting as unreported work. The report of a topic is ordered by
// the publication of its commit, never by the moment a notice happened to be
// delivered.
//
// A repair attempt is durable before the notice is sent and before the worktree
// is touched. The budget is counted per pull request and failing-check set, so
// it survives a restart and a new commit: the same failure cannot be repaired
// automatically more than twice in a row. Only an attempt that was taken counts,
// and the same watch, commit and failure is reserved once. A reservation cannot
// run: it becomes claimable (`queued`) only once its announcement is delivered,
// so the result can never reach the topic before the notice. A reservation that
// never reaches the queue is closed as `aborted` with its reason: an unannounced
// attempt cannot be retried and must not block the topic forever.
//
// An unknown delivery is never treated as a delivered notice: while the topic
// has an uncertain notice, it has unreported work and neither a merge nor a
// preview can be resolved, whatever the other notices of the topic say.

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

const repairsTable = `
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

const schema = `${watchesTable}${watchesIndexes}${repairsTable}`;

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

const finishedRepairStatuses = new Set(["done", "aborted", "uncertain"]);

/**
 * Whether a reserved attempt with this status will never run: it already ended
 * or its result is unknown, so a repeated failure needs a new instruction
 * instead of a new announcement.
 */
export function repairWillNotRun(status) {
  return finishedRepairStatuses.has(status);
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
   * The commit this topic was last told about: the newest published watch that
   * was delivered. Only a delivered notice counts, and its result says whether
   * that commit was reported as green. The order is the publication order, never
   * the delivery order: a slow older watch that finished later can neither
   * overwrite a newer commit's report nor authorize a merge of an older commit.
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
   * Whether the topic has work newer than its last notice: a publication whose
   * notice is not delivered yet, a publication whose delivery is unknown, or an
   * automatic repair that is reserved, queued or running. Each one will end
   * with a new report, so an older notice cannot authorize a merge or a
   * preview. An unknown delivery is never compared with the delivered notices:
   * it blocks until a person reconciles it, even when a later notice arrived
   * first.
   */
  hasUnreportedWork(sessionKey) {
    return this.newestUnreportedWork(sessionKey) !== undefined;
  }

  /**
   * The newest work of the topic that was not reported yet, which is what makes
   * an older notice stale. It names the publication that must be reported, not
   * the notice that already was, so a preview refusal cannot blame the wrong
   * commit. `kind` is `notice` for a publication and `repair` for an automatic
   * repair, which publishes a new commit that does not exist yet. Of several
   * rows of the same instant, a notice wins over a repair: it already has the
   * commit that the person can be told about.
   */
  newestUnreportedWork(sessionKey) {
    return this.#database
      .prepare(
        `SELECT kind, pull_request_number, commit_sha, created_at FROM (
           SELECT 'notice' AS kind, pull_request_number, commit_sha, created_at
           FROM ci_watches
           WHERE session_key = ? AND state IN ('pending', 'sending', 'uncertain')
           UNION ALL
           SELECT 'repair' AS kind, pull_request_number, NULL AS commit_sha,
                  created_at
           FROM ci_repairs
           WHERE session_key = ? AND status IN ('reserved', 'queued', 'running')
         )
         ORDER BY created_at DESC, kind LIMIT 1`,
      )
      .get(sessionKey, sessionKey);
  }

  /** Notices whose delivery is unknown, oldest first, for the operator. */
  uncertainNotices() {
    return this.#database
      .prepare(
        `SELECT update_identifier, session_key, pull_request_number, commit_sha,
                result, created_at
         FROM ci_watches WHERE state = 'uncertain' ORDER BY update_identifier`,
      )
      .all();
  }

  /**
   * A person confirmed the topic received the unknown notice: it was delivered
   * and its stored result becomes the topic's last report.
   */
  resolveUncertainNoticeDelivered(updateIdentifier) {
    return this.#resolveUncertainNotice(updateIdentifier, "sent");
  }

  /**
   * A person decided the unknown notice must be sent again: the ordinary worker
   * sends it as a pending notice, so the retry is an explicit decision.
   */
  resolveUncertainNoticeResend(updateIdentifier) {
    return this.#resolveUncertainNotice(updateIdentifier, "pending");
  }

  #resolveUncertainNotice(updateIdentifier, state) {
    return this.#transaction(() => {
      // The decision changes the state, not the moment of the notice: the last
      // delivered notice is ordered by `created_at`, so confirming an older
      // notice must not move it after a newer one that was delivered later.
      const changed =
        this.#database
          .prepare(
            `UPDATE ci_watches SET state = ?
             WHERE update_identifier = ? AND state = 'uncertain'`,
          )
          .run(state, updateIdentifier).changes === 1;
      if (!changed) {
        return null;
      }
      return this.#database
        .prepare(
          `SELECT update_identifier, session_key, pull_request_number, commit_sha,
                  result, created_at
           FROM ci_watches WHERE update_identifier = ?`,
        )
        .get(updateIdentifier);
    });
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
   * conversation slot. Only a delivered watch is reopened: a pending or sending
   * row is never overwritten, and an uncertain one stays for the person who must
   * reconcile it, never silently becoming pending again.
   */
  reopen({ updateIdentifier, sessionKey, pullRequestNumber, commitSha }) {
    const timestamp = this.#now().toISOString();
    return (
      this.#database
        .prepare(
          `UPDATE ci_watches
           SET session_key = ?, pull_request_number = ?, commit_sha = ?, state = 'pending',
               result = NULL, created_at = ?, updated_at = ?
           WHERE update_identifier = ? AND state = 'sent'`,
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
   * the notice reuses the attempt instead of spending another one, and its
   * status tells the caller whether that attempt can still run.
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
          `SELECT sequence, attempt_number, status FROM ci_repairs
           WHERE update_identifier = ? AND commit_sha = ? AND failure_fingerprint = ?`,
        )
        .get(updateIdentifier, commitSha, failureFingerprint);
      if (existing !== undefined) {
        return {
          sequence: existing.sequence,
          attemptNumber: existing.attempt_number,
          status: existing.status,
        };
      }
      // Every attempt that exists counts, including one that is queued and has
      // not run yet: a burst of announcements can neither reuse the same attempt
      // number nor spend more attempts than the budget allows. Only a
      // reservation whose announcement was never delivered is not an attempt:
      // it never reached the queue and never ran.
      const { count } = this.#database
        .prepare(
          `SELECT COUNT(*) AS count FROM ci_repairs
           WHERE pull_request_number = ? AND failure_fingerprint = ?
             AND status != 'reserved'`,
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
      return {
        sequence: Number(lastInsertRowid),
        attemptNumber: count + 1,
        status: "reserved",
      };
    });
  }

  /**
   * Close a reservation that will never run, with its reason. The attempt was
   * taken, so it still counts towards the budget of the failure.
   */
  abortReservedRepair(sequence, outcome) {
    return (
      this.#database
        .prepare(
          `UPDATE ci_repairs SET status = 'aborted', outcome = ?, updated_at = ?
           WHERE sequence = ? AND status = 'reserved'`,
        )
        .run(outcome, this.#now().toISOString(), sequence).changes === 1
    );
  }

  /**
   * A restart cannot finish announcing a reservation. Every reserved repair is
   * closed as aborted and returned, so the caller attributes each one: none of
   * them ever runs.
   */
  abortInterruptedReservations(outcome) {
    return this.#transaction(() => {
      const interrupted = this.#database
        .prepare(
          `SELECT sequence, update_identifier, session_key, pull_request_number, commit_sha
           FROM ci_repairs WHERE status = 'reserved' ORDER BY sequence`,
        )
        .all();
      if (interrupted.length > 0) {
        this.#database
          .prepare(
            `UPDATE ci_repairs SET status = 'aborted', outcome = ?, updated_at = ?
             WHERE status = 'reserved'`,
          )
          .run(outcome, this.#now().toISOString());
      }
      return interrupted;
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
   * human publication starts the next failure from scratch and supersedes every
   * reservation that never ran. A running or queued attempt is preserved, so the
   * topic still receives its result, and an uncertain one keeps blocking the
   * service until a person reconciles it.
   */
  resetRepairs(pullRequestNumber) {
    this.#database
      .prepare(
        `DELETE FROM ci_repairs
         WHERE pull_request_number = ? AND status IN ('done', 'aborted', 'reserved')`,
      )
      .run(pullRequestNumber);
  }

  close() {
    this.#database.close();
  }
}
