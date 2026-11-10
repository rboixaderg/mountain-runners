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
`;

export class AdmissionQueue {
  #database;
  #maxPending;
  #now;

  constructor(path, { maxPending, now = () => new Date() }) {
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error("maxPending must be a positive integer.");
    }
    this.#database = new DatabaseSync(path);
    this.#database.exec(schema);
    this.#maxPending = maxPending;
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

      const status = count >= this.#maxPending ? "rejected" : "pending";
      this.#database
        .prepare(
          `INSERT INTO instructions
             (update_identifier, message_identifier, session_key, author_identifier, instruction, status, outcome, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          updateIdentifier,
          messageIdentifier,
          sessionKey,
          authorIdentifier,
          instruction,
          status,
          status === "rejected" ? "queue_full" : null,
          this.#now().toISOString(),
        );

      return status === "rejected" ? "rejected_full" : "accepted";
    });
  }

  /**
   * Take the oldest pending instruction. Returns null while any instruction is
   * running or uncertain: the queue contract allows one execution at a time and
   * stops the pilot when an external result is unknown.
   */
  next() {
    return this.#transaction(() => {
      const blocked = this.#database
        .prepare(
          "SELECT 1 FROM instructions WHERE status IN ('running', 'uncertain') LIMIT 1",
        )
        .get();
      if (blocked) {
        return null;
      }

      const request = this.#database
        .prepare(
          `SELECT sequence, update_identifier, message_identifier, session_key,
                  author_identifier, instruction
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
   * Mark a running instruction as interrupted by a restart. The caller must
   * reconcile the external state before any further work; the instruction is
   * never replayed automatically.
   */
  recover() {
    return this.#database
      .prepare(
        "UPDATE instructions SET status = 'uncertain' WHERE status = 'running'",
      )
      .run().changes;
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

  recordTrace({
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
