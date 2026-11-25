// The one private SQLite database of the agent's application state.
//
// `PRAGMA user_version` names the schema of these tables. A change appends a
// migration to the list and never edits one that was released. The admission
// queue of `telegram-pi-bridge` keeps its own tables (`instructions`, `trace`
// and `telegram_offset`) in the same file: the reusable package creates them
// itself and does not take part in this version.

import { join } from "node:path";
import { openDatabase, runTransaction } from "./sqlite.mjs";

export const stateDatabaseName = "agent.sqlite";

export function stateDatabasePath(stateDirectory) {
  return join(stateDirectory, stateDatabaseName);
}

const migrations = [
  `
  -- One row for each commit the service published: the CI notice and the
  -- preview of that commit. A state is NULL only in a row imported from a
  -- database that held the other half alone.
  CREATE TABLE publications (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    author_identifier INTEGER,
    merge_synchronization INTEGER NOT NULL DEFAULT 0
      CHECK (merge_synchronization IN (0, 1)),
    ci_state TEXT CHECK (ci_state IN ('pending', 'sent', 'superseded')),
    ci_result TEXT,
    preview_state TEXT
      CHECK (preview_state IN ('awaiting', 'confirmed', 'timed_out', 'failed')),
    confirmed_origin TEXT,
    notice_message_identifier INTEGER,
    created_at TEXT NOT NULL,
    preview_updated_at TEXT,
    CHECK (ci_state IS NOT NULL OR preview_state IS NOT NULL)
  );
  CREATE INDEX publications_topic_ci ON publications (session_key, ci_state);
  CREATE INDEX publications_pull_request
    ON publications (pull_request_number);
  CREATE INDEX publications_preview ON publications (preview_state);

  CREATE TABLE merge_requests (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    author_identifier INTEGER NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('merging', 'merged', 'failed', 'uncertain', 'not_merged')),
    merge_commit_sha TEXT,
    notified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX merge_requests_pull_request
    ON merge_requests (session_key, pull_request_number);
  CREATE TABLE merge_questions (
    session_key TEXT NOT NULL,
    question_message_identifier INTEGER NOT NULL,
    notice_message_identifier INTEGER NOT NULL,
    publication_update_identifier INTEGER NOT NULL,
    validation_update_identifier INTEGER NOT NULL,
    author_identifier INTEGER NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_key, question_message_identifier)
  );
  CREATE UNIQUE INDEX merge_questions_validation
    ON merge_questions (validation_update_identifier);
  CREATE UNIQUE INDEX merge_questions_offer
    ON merge_questions (session_key, notice_message_identifier, author_identifier)
    WHERE consumed_at IS NULL;

  CREATE TABLE session_notes (
    sequence INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    text TEXT NOT NULL,
    effect_key TEXT,
    state TEXT NOT NULL CHECK (state IN ('undelivered', 'claimed')),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX session_notes_effect
    ON session_notes (session_key, effect_key);
  CREATE INDEX session_notes_topic
    ON session_notes (session_key, state, sequence);
  CREATE TABLE session_delivered_effects (
    sequence INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    effect_key TEXT NOT NULL,
    delivered_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX session_delivered_effects_identity
    ON session_delivered_effects (session_key, effect_key);

  CREATE TABLE topic_jobs (
    session_key TEXT PRIMARY KEY,
    branch TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0)
  );

  -- The separate databases imported into this file, so an interrupted rename
  -- is told apart from files an older version wrote afterwards.
  CREATE TABLE imported_databases (
    name TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL
  );
  `,
];

/** Open the state database and bring its schema up to date. */
export function openStateDatabase(path) {
  const database = openDatabase(path);
  try {
    runTransaction(database, () => {
      const { user_version: version } = database
        .prepare("PRAGMA user_version")
        .get();
      if (version > migrations.length) {
        throw new Error(
          `The state database has schema version ${version}, newer than this code (${migrations.length}).`,
        );
      }
      for (const migration of migrations.slice(version)) {
        database.exec(migration);
      }
      database.exec(`PRAGMA user_version = ${migrations.length}`);
    });
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}
