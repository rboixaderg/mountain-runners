// One-time import of the separate databases earlier versions kept into the one
// state database.
//
// The new database is built beside the old ones and published with one rename,
// so the state is migrated completely or not at all. The old files are never
// written: only after that rename they are renamed to `*.migrated`, which is
// what a rollback to the previous version restores. A process that stopped
// between both renames finishes them on the next call. An old file that no
// longer matches what was imported was written by an older version afterwards,
// so the call refuses instead of choosing which state is right.
//
// The service and the reconciliation command can both import, so one lock
// covers the whole import. It is the write lock of a separate SQLite file: the
// system releases it when its process ends, so it is never stale.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { openDatabase, runTransaction } from "./sqlite.mjs";
import {
  openStateDatabase,
  stateDatabaseName,
  stateDatabasePath,
} from "./state-database.mjs";

const migratedSuffix = ".migrated";
const lockName = "agent-migration.lock";

// Tables that keep their shape: each one is copied column by column. The two
// publication tables are merged into `publications` instead.
const copiedTables = {
  "admission.sqlite": {
    instructions: [
      "sequence",
      "update_identifier",
      "message_identifier",
      "session_key",
      "author_identifier",
      "instruction",
      "attachments",
      "reply_message_identifier",
      "exact_direct_reply",
      "status",
      "outcome",
      "created_at",
    ],
    trace: [
      "sequence",
      "update_identifier",
      "author_identifier",
      "session_key",
      "action",
      "detail",
      "created_at",
    ],
    telegram_offset: ["singleton", "update_identifier"],
  },
  "merge-request.sqlite": {
    merge_requests: [
      "update_identifier",
      "session_key",
      "author_identifier",
      "pull_request_number",
      "commit_sha",
      "state",
      "merge_commit_sha",
      "notified_at",
      "created_at",
      "updated_at",
    ],
    merge_questions: [
      "session_key",
      "question_message_identifier",
      "notice_message_identifier",
      "publication_update_identifier",
      "validation_update_identifier",
      "author_identifier",
      "pull_request_number",
      "commit_sha",
      "consumed_at",
      "created_at",
    ],
  },
  "session-notes.sqlite": {
    session_notes: [
      "sequence",
      "session_key",
      "text",
      "effect_key",
      "state",
      "created_at",
    ],
    session_delivered_effects: [
      "sequence",
      "session_key",
      "effect_key",
      "delivered_at",
    ],
  },
  "topic-jobs.sqlite": {
    topic_jobs: ["session_key", "branch", "pull_request_number"],
  },
};

const ciWatchDatabase = "ci-watch.sqlite";
const previewDatabase = "preview-request.sqlite";

export const legacyDatabaseNames = [
  ...Object.keys(copiedTables),
  ciWatchDatabase,
  previewDatabase,
];

/** The rows of one table, or none when the database never created it. */
function readRows(source, table) {
  const exists = source
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return exists === undefined
    ? []
    : source.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

function insertRow(target, table, row) {
  const columns = Object.keys(row);
  target
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...columns.map((column) => row[column]));
}

function copyTables(source, target, tables) {
  for (const [table, columns] of Object.entries(tables)) {
    for (const row of readRows(source, table)) {
      insertRow(
        target,
        table,
        Object.fromEntries(columns.map((column) => [column, row[column]])),
      );
    }
  }
}

// `sending` and `uncertain` are notice states an earlier version wrote: such a
// watch is neither pending nor sent again, like a superseded one.
function importCiWatches(source, target) {
  for (const watch of readRows(source, "ci_watches")) {
    insertRow(target, "publications", {
      update_identifier: watch.update_identifier,
      session_key: watch.session_key,
      pull_request_number: watch.pull_request_number,
      commit_sha: watch.commit_sha,
      ci_state: ["sending", "uncertain"].includes(watch.state)
        ? "superseded"
        : watch.state,
      ci_result: watch.result,
      created_at: watch.created_at,
    });
  }
}

// `commenting` and `uncertain` are preview states an earlier version wrote: such
// a request neither awaits nor was delivered, like a failed one. A preview that
// describes another publication than the CI watch of its update is dropped: the
// watch names the publication, which keeps no preview that could authorize a
// merge.
function importPreviewRequests(source, target, droppedPreviews) {
  for (const request of readRows(source, "preview_requests")) {
    const preview = {
      author_identifier: request.author_identifier,
      merge_synchronization: request.merge_synchronization,
      preview_state: ["commenting", "uncertain"].includes(request.state)
        ? "failed"
        : request.state,
      confirmed_origin: request.confirmed_origin,
      notice_message_identifier: request.notice_message_identifier,
      preview_updated_at: request.updated_at,
    };
    const publication = target
      .prepare("SELECT * FROM publications WHERE update_identifier = ?")
      .get(request.update_identifier);
    const identity = {
      session_key: request.session_key,
      pull_request_number: request.pull_request_number,
      commit_sha: request.commit_sha,
    };
    if (publication === undefined) {
      insertRow(target, "publications", {
        update_identifier: request.update_identifier,
        ...identity,
        ...preview,
        created_at: request.created_at,
      });
      continue;
    }
    if (
      Object.entries(identity).some(
        ([column, value]) => publication[column] !== value,
      )
    ) {
      droppedPreviews.push(request.update_identifier);
      continue;
    }
    const columns = Object.keys(preview);
    target
      .prepare(
        `UPDATE publications
         SET ${columns.map((column) => `${column} = ?`).join(", ")}
         WHERE update_identifier = ?`,
      )
      .run(
        ...columns.map((column) => preview[column]),
        request.update_identifier,
      );
  }
}

function digestOf(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// A normal connection, so SQLite first recovers the journal a stopped process
// left behind. Only reads run on it.
function withSource(path, read) {
  const source = new DatabaseSync(path);
  try {
    return read(source);
  } finally {
    source.close();
  }
}

/** Returns the updates whose preview was not imported. */
function buildStateDatabase(stateDirectory, present, stagingPath) {
  const droppedPreviews = [];
  // The queue creates its own tables in the new file.
  new AdmissionQueue(stagingPath, { maxPending: 1 }).close();
  const target = openStateDatabase(stagingPath);
  try {
    runTransaction(target, () => {
      // The CI watches go first: a preview request completes their row.
      const ordered = [...present].sort(
        (first, second) =>
          Number(second === ciWatchDatabase) -
          Number(first === ciWatchDatabase),
      );
      for (const name of ordered) {
        const path = join(stateDirectory, name);
        withSource(path, (source) => {
          if (name === ciWatchDatabase) {
            importCiWatches(source, target);
          } else if (name === previewDatabase) {
            importPreviewRequests(source, target, droppedPreviews);
          } else {
            copyTables(source, target, copiedTables[name]);
          }
        });
        insertRow(target, "imported_databases", {
          name,
          sha256: digestOf(path),
        });
      }
    });
  } finally {
    target.close();
  }
  return droppedPreviews;
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Refuse unless every old file left is exactly one this database imported. */
function assertImported(stateDirectory, present) {
  const target = new DatabaseSync(stateDatabasePath(stateDirectory), {
    readOnly: true,
  });
  let imported;
  try {
    imported = target.prepare("SELECT * FROM imported_databases").all();
  } finally {
    target.close();
  }
  const changed = present.filter(
    (name) =>
      imported.find((entry) => entry.name === name)?.sha256 !==
      digestOf(join(stateDirectory, name)),
  );
  if (changed.length > 0) {
    throw new Error(
      `${stateDatabaseName} exists and ${changed.join(", ")} hold state it did not import. See "Tornar enrere" in docs/operations/agent.md.`,
    );
  }
}

// SQLite would apply the journal of a removed state database to the new file
// and lose rows of it.
function assertNoLeftoverJournal(path) {
  const leftovers = ["-journal", "-wal", "-shm"]
    .map((suffix) => `${path}${suffix}`)
    .filter((leftover) => existsSync(leftover));
  if (leftovers.length > 0) {
    throw new Error(
      `${leftovers.join(", ")} belong to a removed ${stateDatabaseName}. Remove them and repeat.`,
    );
  }
}

function legacyDatabasesIn(stateDirectory) {
  return legacyDatabaseNames.filter((name) =>
    existsSync(join(stateDirectory, name)),
  );
}

function importLegacyDatabases(stateDirectory, logger) {
  // Read under the lock: another process may have finished the import.
  const present = legacyDatabasesIn(stateDirectory);
  if (present.length === 0) {
    return [];
  }
  const path = stateDatabasePath(stateDirectory);
  const stagingPath = `${path}.migrating`;
  try {
    if (existsSync(path)) {
      assertImported(stateDirectory, present);
    } else {
      assertNoLeftoverJournal(path);
      // An interrupted attempt is rebuilt from the untouched old files. Its
      // journal goes with it, or SQLite would apply it to the new file.
      for (const leftover of [stagingPath, `${stagingPath}-journal`]) {
        rmSync(leftover, { force: true });
      }
      const droppedPreviews = buildStateDatabase(
        stateDirectory,
        present,
        stagingPath,
      );
      renameSync(stagingPath, path);
      syncDirectory(stateDirectory);
      for (const updateIdentifier of droppedPreviews) {
        logger("migration_preview_dropped", String(updateIdentifier));
      }
    }
  } catch (error) {
    rmSync(stagingPath, { force: true });
    throw new Error(`The state migration failed: ${error.message}`, {
      cause: error,
    });
  }
  for (const name of present) {
    const oldPath = join(stateDirectory, name);
    renameSync(oldPath, `${oldPath}${migratedSuffix}`);
  }
  syncDirectory(stateDirectory);
  return present;
}

/**
 * Import the separate databases of the state directory into the state database.
 * Returns the names of the old files it renamed, none when there is nothing to
 * migrate. A failure throws before anything is changed.
 */
export function migrateLegacyState(stateDirectory, { logger = () => {} } = {}) {
  // Without an old file there is nothing to lock and no file is created.
  if (legacyDatabasesIn(stateDirectory).length === 0) {
    return [];
  }
  const lock = openDatabase(join(stateDirectory, lockName));
  try {
    try {
      lock.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      throw new Error(
        `The state migration failed: another process holds ${lockName} (${error.message}).`,
        { cause: error },
      );
    }
    return importLegacyDatabases(stateDirectory, logger);
  } finally {
    lock.close();
  }
}
