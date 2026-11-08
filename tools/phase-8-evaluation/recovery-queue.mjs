// Synthetic-data experiment only. This is not a production queue.
// No Telegram acknowledgement, access control, process ownership or GitHub reconciliation.
import { DatabaseSync } from "node:sqlite";

export class RecoveryQueue {
  constructor(path) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        sequence INTEGER PRIMARY KEY,
        update_id INTEGER NOT NULL UNIQUE,
        session_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uncertain', 'done'))
      );
    `);
  }

  admit(updateId, sessionKey, payload) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.database
          .prepare("SELECT 1 FROM requests WHERE update_id = ?")
          .get(updateId)
      ) {
        this.database.exec("COMMIT");
        return "duplicate";
      }
      const { count } = this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM requests WHERE status = 'pending'",
        )
        .get();
      if (count >= 10) {
        this.database.exec("COMMIT");
        return "full";
      }
      this.database
        .prepare(
          "INSERT INTO requests (update_id, session_key, payload, status) VALUES (?, ?, ?, 'pending')",
        )
        .run(updateId, sessionKey, payload);
      this.database.exec("COMMIT");
      return "accepted";
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  startNext() {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.database
          .prepare(
            "SELECT 1 FROM requests WHERE status IN ('running', 'uncertain') LIMIT 1",
          )
          .get()
      ) {
        this.database.exec("COMMIT");
        return null;
      }
      const request = this.database
        .prepare(
          "SELECT sequence, update_id, session_key, payload FROM requests WHERE status = 'pending' ORDER BY sequence LIMIT 1",
        )
        .get();
      if (request)
        this.database
          .prepare("UPDATE requests SET status = 'running' WHERE sequence = ?")
          .run(request.sequence);
      this.database.exec("COMMIT");
      return request ?? null;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  complete(updateId) {
    const result = this.database
      .prepare(
        "UPDATE requests SET status = 'done' WHERE update_id = ? AND status = 'running'",
      )
      .run(updateId);
    return result.changes === 1;
  }

  recover() {
    return this.database
      .prepare(
        "UPDATE requests SET status = 'uncertain' WHERE status = 'running'",
      )
      .run().changes;
  }

  // The caller must independently verify the external result first.
  confirmReconciledCompletion(updateId) {
    const result = this.database
      .prepare(
        "UPDATE requests SET status = 'done' WHERE update_id = ? AND status = 'uncertain'",
      )
      .run(updateId);
    return result.changes === 1;
  }

  status(updateId) {
    return this.database
      .prepare("SELECT status FROM requests WHERE update_id = ?")
      .get(updateId)?.status;
  }

  close() {
    this.database.close();
  }
}
