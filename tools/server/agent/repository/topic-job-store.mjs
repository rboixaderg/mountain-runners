// A topic keeps its first published branch and pull request across restarts.
// Binding the same job twice is harmless; a different job must never replace it.

import { openDatabase } from "./sqlite.mjs";

const schema = `
  CREATE TABLE IF NOT EXISTS topic_jobs (
    session_key TEXT PRIMARY KEY,
    branch TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0)
  );
`;

export class TopicJobStore {
  #database;

  constructor(path) {
    this.#database = openDatabase(path);
    this.#database.exec(schema);
  }

  bind({ sessionKey, branch, pullRequestNumber }) {
    this.#database
      .prepare(
        `INSERT INTO topic_jobs (session_key, branch, pull_request_number)
         VALUES (?, ?, ?) ON CONFLICT (session_key) DO NOTHING`,
      )
      .run(sessionKey, branch, pullRequestNumber);
    const binding = this.bindingOf(sessionKey);
    if (
      binding.branch !== branch ||
      binding.pullRequestNumber !== pullRequestNumber
    ) {
      throw new Error("The topic is already bound to another job.");
    }
    return binding;
  }

  bindingOf(sessionKey) {
    const row = this.#database
      .prepare(
        "SELECT branch, pull_request_number FROM topic_jobs WHERE session_key = ?",
      )
      .get(sessionKey);
    return row === undefined
      ? null
      : { branch: row.branch, pullRequestNumber: row.pull_request_number };
  }

  list() {
    return this.#database
      .prepare(
        "SELECT session_key, branch, pull_request_number FROM topic_jobs ORDER BY pull_request_number ASC",
      )
      .all()
      .map((row) => ({
        sessionKey: row.session_key,
        branch: row.branch,
        pullRequestNumber: row.pull_request_number,
      }));
  }

  close() {
    this.#database.close();
  }
}
