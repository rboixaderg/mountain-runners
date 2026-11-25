import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { openStateDatabase, stateDatabasePath } from "./state-database.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-state-database-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return stateDatabasePath(directory);
}

function tableNames(database) {
  return database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

test("creates the schema once, beside the tables of the admission queue", (context) => {
  const path = fixture(context);
  new AdmissionQueue(path, { maxPending: 1 }).close();
  openStateDatabase(path).close();

  const database = openStateDatabase(path);
  context.after(() => database.close());

  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1);
  assert.deepEqual(tableNames(database), [
    "imported_databases",
    "instructions",
    "merge_questions",
    "merge_requests",
    "publications",
    "session_delivered_effects",
    "session_notes",
    "telegram_offset",
    "topic_jobs",
    "trace",
  ]);
});

test("refuses a database of a newer schema without changing it", (context) => {
  const path = fixture(context);
  const newer = new DatabaseSync(path);
  newer.exec("PRAGMA user_version = 99");
  newer.close();

  assert.throws(() => openStateDatabase(path), /schema version 99, newer/u);

  const database = new DatabaseSync(path, { readOnly: true });
  context.after(() => database.close());
  assert.deepEqual(tableNames(database), []);
});
