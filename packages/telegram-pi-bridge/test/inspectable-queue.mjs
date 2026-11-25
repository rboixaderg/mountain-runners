// Test-only reads of the queue, straight from its SQLite file.
import { DatabaseSync } from "node:sqlite";
import { AdmissionQueue } from "../src/sessions/queue.mjs";

export class InspectableQueue extends AdmissionQueue {
  #path;

  constructor(path, options) {
    super(path, options);
    this.#path = path;
  }

  #read(sql, ...parameters) {
    const database = new DatabaseSync(this.#path, { readOnly: true });
    try {
      return database.prepare(sql).get(...parameters);
    } finally {
      database.close();
    }
  }

  status(updateIdentifier) {
    return this.#read(
      "SELECT status FROM instructions WHERE update_identifier = ?",
      updateIdentifier,
    )?.status;
  }

  pendingCount() {
    return this.#read(
      "SELECT COUNT(*) AS count FROM instructions WHERE status = 'pending'",
    ).count;
  }
}
