// The separate databases of the version before the single state database, with
// their exact schemas. Only the migration tests create them.

import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const legacySchemas = {
  "admission.sqlite": `
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
`,
  "ci-watch.sqlite": `
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
  CREATE INDEX IF NOT EXISTS ci_watches_topic_state
    ON ci_watches (session_key, state);
  CREATE INDEX IF NOT EXISTS ci_watches_pull_request
    ON ci_watches (pull_request_number, update_identifier);
`,
  "preview-request.sqlite": `
  CREATE TABLE IF NOT EXISTS preview_requests (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    author_identifier INTEGER NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('awaiting', 'confirmed', 'timed_out', 'failed')),
    confirmed_origin TEXT,
    notice_message_identifier INTEGER,
    merge_synchronization INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS preview_requests_pull_request
    ON preview_requests (session_key, pull_request_number);
  CREATE INDEX IF NOT EXISTS preview_requests_state
    ON preview_requests (state);
`,
  "merge-request.sqlite": `
  CREATE TABLE IF NOT EXISTS merge_requests (
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
  CREATE INDEX IF NOT EXISTS merge_requests_pull_request
    ON merge_requests (session_key, pull_request_number);

  CREATE TABLE IF NOT EXISTS merge_questions (
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
  CREATE UNIQUE INDEX IF NOT EXISTS merge_questions_validation
    ON merge_questions (validation_update_identifier);
  CREATE UNIQUE INDEX IF NOT EXISTS merge_questions_offer
    ON merge_questions (session_key, notice_message_identifier, author_identifier)
    WHERE consumed_at IS NULL;
`,
  "session-notes.sqlite": `
  CREATE TABLE IF NOT EXISTS session_notes (
    sequence INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    text TEXT NOT NULL,
    effect_key TEXT,
    state TEXT NOT NULL CHECK (state IN ('undelivered', 'claimed')),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS session_notes_effect
    ON session_notes (session_key, effect_key);
  CREATE INDEX IF NOT EXISTS session_notes_topic
    ON session_notes (session_key, state, sequence);
  CREATE TABLE IF NOT EXISTS session_delivered_effects (
    sequence INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    effect_key TEXT NOT NULL,
    delivered_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS session_delivered_effects_identity
    ON session_delivered_effects (session_key, effect_key);
`,
  "topic-jobs.sqlite": `
  CREATE TABLE IF NOT EXISTS topic_jobs (
    session_key TEXT PRIMARY KEY,
    branch TEXT NOT NULL,
    pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0)
  );
`,
};

/**
 * Create one old database and insert its rows, each a `{ table: rows }` map of
 * column objects.
 */
export function createLegacyDatabase(directory, name, tables = {}) {
  const database = new DatabaseSync(join(directory, name));
  try {
    database.exec(legacySchemas[name]);
    for (const [table, rows] of Object.entries(tables)) {
      for (const row of rows) {
        const columns = Object.keys(row);
        database
          .prepare(
            `INSERT INTO ${table} (${columns.join(", ")})
             VALUES (${columns.map(() => "?").join(", ")})`,
          )
          .run(...Object.values(row));
      }
    }
  } finally {
    database.close();
  }
}
