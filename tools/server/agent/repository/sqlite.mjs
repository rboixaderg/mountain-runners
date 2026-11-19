// Shared robustness of the private SQLite stores of the agent.
//
// Every store is written by one process, but the operator command and the
// service can briefly overlap, and a statement can fail inside a transaction.
// The busy timeout bounds the wait for the other writer, and a rollback is
// best effort: SQLite may already have rolled the failed transaction back, and
// that second failure must never hide the error that ended the transaction.

import { DatabaseSync } from "node:sqlite";

const busyTimeoutMilliseconds = 5000;

/** Open one store database with the bounded wait for a concurrent writer. */
export function openDatabase(path) {
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA busy_timeout = ${busyTimeoutMilliseconds};`);
  return database;
}

/** Run `callback` inside one immediate transaction. */
export function runTransaction(database, callback) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // SQLite already rolled the failed transaction back.
    }
    throw error;
  }
}
