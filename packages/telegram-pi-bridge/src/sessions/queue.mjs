// Durable admission of Telegram instructions.
//
// The trusted component records an instruction before it advances the Telegram
// offset, so an accepted instruction survives a restart. Updates are
// deduplicated by Telegram update identifier, the queue admits a bounded number
// of pending instructions and only one execution runs at a time.
//
// A restarted process cannot know whether an interrupted run already changed
// something outside the sandbox. Recovery therefore marks it as uncertain and
// stops new work until an operator reconciles the real state; it never replays
// it automatically. Reconciliation of external effects belongs to the caller.
//
// The database is private: it keeps the instruction text and the Telegram
// author identifier, so it must not be published to the repository, a pull
// request or CI logs.

import { DatabaseSync } from "node:sqlite";

const schema = `
  CREATE TABLE IF NOT EXISTS instructions (
    sequence INTEGER PRIMARY KEY,
    update_identifier INTEGER NOT NULL UNIQUE,
    message_identifier INTEGER NOT NULL,
    session_key TEXT NOT NULL,
    author_identifier INTEGER NOT NULL,
    instruction TEXT NOT NULL,
    attachments TEXT,
    reply_message_identifier INTEGER,
    exact_direct_reply INTEGER NOT NULL DEFAULT 0 CHECK (exact_direct_reply IN (0, 1)),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uncertain', 'done', 'rejected')),
    outcome TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trace (
    sequence INTEGER PRIMARY KEY,
    update_identifier INTEGER,
    author_identifier INTEGER,
    session_key TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS telegram_offset (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    update_identifier INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS instructions_status ON instructions (status);
  CREATE INDEX IF NOT EXISTS instructions_session_status ON instructions (session_key, status);
  CREATE INDEX IF NOT EXISTS trace_update_action ON trace (update_identifier, action);
  CREATE INDEX IF NOT EXISTS trace_session_created ON trace (session_key, created_at);
`;

// A second process may hold the database for a moment. Waiting for it keeps an
// admission or a trace read from failing with a transient lock error.
const busyTimeoutMilliseconds = 5000;

export class AdmissionQueue {
  #database;
  #maxPending;
  #now;

  constructor(path, { maxPending, now = () => new Date() }) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error("maxPending must be a positive integer.");
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec(`PRAGMA busy_timeout = ${busyTimeoutMilliseconds}`);
    this.#database.exec(schema);
    this.#migrate();
    this.#maxPending = maxPending;
    this.#now = now;
  }

  // An existing database predates the attachment and reply columns. The
  // migration is idempotent: it adds each column when it is missing and copies
  // a single image into the list the queue now stores.
  #migrate() {
    // One transaction: a migration that fails leaves the old schema and the old
    // rows exactly as they were.
    this.#transaction(() => {
      const columns = this.#database
        .prepare("PRAGMA table_info(instructions)")
        .all()
        .map((column) => column.name);
      if (!columns.includes("attachments")) {
        this.#database.exec(
          "ALTER TABLE instructions ADD COLUMN attachments TEXT",
        );
        if (columns.includes("attachment")) {
          this.#database.exec(
            "UPDATE instructions SET attachments = '[' || attachment || ']' WHERE attachment IS NOT NULL",
          );
        }
      }
      if (!columns.includes("reply_message_identifier")) {
        this.#database.exec(
          "ALTER TABLE instructions ADD COLUMN reply_message_identifier INTEGER",
        );
      }
      if (!columns.includes("exact_direct_reply")) {
        this.#database.exec(
          "ALTER TABLE instructions ADD COLUMN exact_direct_reply INTEGER NOT NULL DEFAULT 0 CHECK (exact_direct_reply IN (0, 1))",
        );
      }
    });
  }

  #transaction(callback) {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      // SQLite may already have rolled the transaction back on its own; the
      // root error is what the caller must see.
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Nothing left to roll back.
      }
      throw error;
    }
  }

  #blocked() {
    return (
      this.#database
        .prepare(
          "SELECT 1 FROM instructions WHERE status IN ('running', 'uncertain') LIMIT 1",
        )
        .get() !== undefined
    );
  }

  /**
   * Record an instruction. A duplicate update is never admitted twice. When the
   * pending queue is full the instruction is recorded as rejected so it can be
   * reported to the author instead of disappearing; the caller still advances
   * the Telegram offset.
   */
  admit({
    updateIdentifier,
    messageIdentifier,
    sessionKey,
    authorIdentifier,
    instruction,
    attachments = [],
    replyMessageIdentifier = null,
    exactDirectReply = false,
  }) {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare("SELECT 1 FROM instructions WHERE update_identifier = ?")
        .get(updateIdentifier);
      if (existing) {
        return "duplicate";
      }

      const { count } = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM instructions WHERE status = 'pending'",
        )
        .get();

      const blocked = this.#database
        .prepare(
          "SELECT 1 FROM instructions WHERE status = 'uncertain' LIMIT 1",
        )
        .get();
      let outcome = null;
      if (blocked) outcome = "queue_blocked";
      else if (count >= this.#maxPending) outcome = "queue_full";
      const status = outcome === null ? "pending" : "rejected";
      this.#database
        .prepare(
          `INSERT INTO instructions
             (update_identifier, message_identifier, session_key, author_identifier, instruction, attachments, reply_message_identifier, exact_direct_reply, status, outcome, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          updateIdentifier,
          messageIdentifier,
          sessionKey,
          authorIdentifier,
          instruction,
          attachments.length === 0 ? null : JSON.stringify(attachments),
          replyMessageIdentifier,
          exactDirectReply === true && replyMessageIdentifier !== null ? 1 : 0,
          status,
          outcome,
          this.#now().toISOString(),
        );

      if (outcome === "queue_blocked") return "rejected_blocked";
      if (outcome === "queue_full") return "rejected_full";
      return "accepted";
    });
  }

  /**
   * Take the oldest pending instruction. Returns null while any instruction is
   * running or uncertain: the queue contract allows one execution at a time and
   * stops the pilot when an external result is unknown.
   */
  next() {
    return this.#transaction(() => {
      if (this.#blocked()) {
        return null;
      }

      const request = this.#database
        .prepare(
          `SELECT sequence, update_identifier, message_identifier, session_key,
                  author_identifier, instruction, attachments,
                  reply_message_identifier, exact_direct_reply
           FROM instructions
           WHERE status = 'pending'
           ORDER BY sequence
           LIMIT 1`,
        )
        .get();
      if (!request) {
        return null;
      }

      this.#database
        .prepare(
          "UPDATE instructions SET status = 'running' WHERE sequence = ?",
        )
        .run(request.sequence);
      return {
        updateIdentifier: request.update_identifier,
        messageIdentifier: request.message_identifier,
        sessionKey: request.session_key,
        authorIdentifier: request.author_identifier,
        instruction: request.instruction,
        attachments:
          request.attachments === null ? [] : JSON.parse(request.attachments),
        replyMessageIdentifier: request.reply_message_identifier,
        exactDirectReply: request.exact_direct_reply === 1,
      };
    });
  }

  complete(updateIdentifier, outcome) {
    const result = this.#database
      .prepare(
        "UPDATE instructions SET status = 'done', outcome = ? WHERE update_identifier = ? AND status = 'running'",
      )
      .run(outcome, updateIdentifier);
    return result.changes === 1;
  }

  /**
   * Mark a running instruction as uncertain because its external result is
   * unknown. New work stops until an operator reconciles the real state.
   */
  markUncertain(updateIdentifier, outcome) {
    const result = this.#database
      .prepare(
        "UPDATE instructions SET status = 'uncertain', outcome = ? WHERE update_identifier = ? AND status = 'running'",
      )
      .run(outcome, updateIdentifier);
    return result.changes === 1;
  }

  /**
   * Mark interrupted runs as uncertain and return the total uncertain count,
   * including previous restarts. The caller must reconcile the real state;
   * interrupted instructions are never replayed automatically.
   */
  recover() {
    return this.#transaction(() => {
      this.#database
        .prepare(
          "UPDATE instructions SET status = 'uncertain' WHERE status = 'running'",
        )
        .run();
      return this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM instructions WHERE status = 'uncertain'",
        )
        .get().count;
    });
  }

  /**
   * Instructions whose external result is unknown, without their text: an
   * operator only needs the identity and the moment of each case.
   */
  uncertain() {
    return this.#database
      .prepare(
        `SELECT update_identifier, session_key, created_at
         FROM instructions WHERE status = 'uncertain' ORDER BY sequence`,
      )
      .all();
  }

  /**
   * Close an uncertain instruction once a person checked the real state, record
   * its trace and return it, all in one transaction: a resolution is never kept
   * without its audit entry, and a failure leaves the instruction uncertain.
   * The guarded update refuses a case that is no longer uncertain.
   */
  resolveUncertain({ updateIdentifier, outcome, trace }) {
    return this.#transaction(() => {
      const changed =
        this.#database
          .prepare(
            `UPDATE instructions SET status = 'done', outcome = ?
             WHERE update_identifier = ? AND status = 'uncertain'`,
          )
          .run(outcome, updateIdentifier).changes === 1;
      if (!changed) {
        return null;
      }
      this.#insertTrace(trace);
      return this.#database
        .prepare(
          `SELECT update_identifier, session_key, created_at
           FROM instructions WHERE update_identifier = ?`,
        )
        .get(updateIdentifier);
    });
  }

  status(updateIdentifier) {
    return this.#database
      .prepare("SELECT status FROM instructions WHERE update_identifier = ?")
      .get(updateIdentifier)?.status;
  }

  pendingCount() {
    const { count } = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM instructions WHERE status = 'pending'",
      )
      .get();
    return count;
  }

  /**
   * True while an instruction is running or has an unknown external result. A
   * caller that performs its own external work must not start it in this state.
   */
  isBlocked() {
    return this.#blocked();
  }

  /**
   * Whether the session has another instruction pending or running besides the
   * given one: work that the person has not seen the result of.
   */
  hasOtherInstructions(sessionKey, updateIdentifier) {
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM instructions
           WHERE session_key = ? AND update_identifier <> ?
             AND status IN ('pending', 'running')
           LIMIT 1`,
        )
        .get(sessionKey, updateIdentifier) !== undefined
    );
  }

  /**
   * Whether the session has another instruction whose external effects are not
   * settled yet: pending, running or with an unknown result.
   */
  hasUnsettledInstructions(sessionKey, updateIdentifier) {
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM instructions
           WHERE session_key = ? AND update_identifier <> ?
             AND status IN ('pending', 'running', 'uncertain')
           LIMIT 1`,
        )
        .get(sessionKey, updateIdentifier) !== undefined
    );
  }

  /**
   * Whether the same topic admitted another instruction between two of its
   * persisted updates. Both endpoints must exist in that topic and be in
   * sequence order; anything else fails closed. Rows whose outcome is
   * `excludingOutcome` are not intervening work.
   */
  hasInterveningInstructions({
    sessionKey,
    afterUpdateIdentifier,
    updateIdentifier,
    excludingOutcome,
  }) {
    const after = this.#database
      .prepare(
        "SELECT sequence, session_key FROM instructions WHERE update_identifier = ?",
      )
      .get(afterUpdateIdentifier);
    const current = this.#database
      .prepare(
        "SELECT sequence, session_key FROM instructions WHERE update_identifier = ?",
      )
      .get(updateIdentifier);
    if (
      after === undefined ||
      current === undefined ||
      after.session_key !== sessionKey ||
      current.session_key !== sessionKey ||
      after.sequence >= current.sequence
    ) {
      return true;
    }
    const excluded = excludingOutcome ?? null;
    const query =
      excluded === null
        ? `SELECT COUNT(*) AS count FROM instructions
           WHERE session_key = ?
             AND sequence > ? AND sequence < ?`
        : `SELECT COUNT(*) AS count FROM instructions
           WHERE session_key = ?
             AND sequence > ? AND sequence < ?
             AND (outcome IS NULL OR outcome <> ?)`;
    const parameters =
      excluded === null
        ? [sessionKey, after.sequence, current.sequence]
        : [sessionKey, after.sequence, current.sequence, excluded];
    const { count } = this.#database.prepare(query).get(...parameters);
    return count > 0;
  }

  /** Whether an update already has a trace entry with this action. */
  hasTrace({ updateIdentifier, action }) {
    return (
      this.#database
        .prepare(
          "SELECT 1 FROM trace WHERE update_identifier = ? AND action = ? LIMIT 1",
        )
        .get(updateIdentifier, action) !== undefined
    );
  }

  recordTrace({
    updateIdentifier = null,
    authorIdentifier = null,
    sessionKey = null,
    action,
    detail = null,
  }) {
    this.#insertTrace({
      updateIdentifier,
      authorIdentifier,
      sessionKey,
      action,
      detail,
    });
  }

  #insertTrace({
    updateIdentifier = null,
    authorIdentifier = null,
    sessionKey = null,
    action,
    detail = null,
  }) {
    this.#database
      .prepare(
        `INSERT INTO trace
           (update_identifier, author_identifier, session_key, action, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        updateIdentifier,
        authorIdentifier,
        sessionKey,
        action,
        detail,
        this.#now().toISOString(),
      );
  }

  traceEntries() {
    return this.#database
      .prepare(
        "SELECT update_identifier, author_identifier, session_key, action, detail, created_at FROM trace ORDER BY sequence",
      )
      .all();
  }

  readOffset() {
    const row = this.#database
      .prepare(
        "SELECT update_identifier FROM telegram_offset WHERE singleton = 1",
      )
      .get();
    return row?.update_identifier ?? 0;
  }

  writeOffset(updateIdentifier) {
    this.#database
      .prepare(
        `INSERT INTO telegram_offset (singleton, update_identifier) VALUES (1, ?)
         ON CONFLICT (singleton) DO UPDATE SET update_identifier = excluded.update_identifier`,
      )
      .run(updateIdentifier);
  }

  close() {
    this.#database.close();
  }
}
