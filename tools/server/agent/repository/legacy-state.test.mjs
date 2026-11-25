import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { legacyDatabaseNames, migrateLegacyState } from "./legacy-state.mjs";
import { MergeRequestStore } from "./merge-request-store.mjs";
import { PublicationStore } from "./publication-store.mjs";
import { SessionNoteStore } from "./session-note-store.mjs";
import { stateDatabasePath } from "./state-database.mjs";
import { createLegacyDatabase } from "./test-support/legacy-databases.mjs";
import { TopicJobStore } from "./topic-job-store.mjs";

const topic = "-1001234567890:7";
const otherTopic = "-1001234567890:8";
const commit = "a".repeat(40);
const newerCommit = "b".repeat(40);
const origin = "https://pr-200.preview.mountainrunners.cat";
const moment = "2026-11-20T10:00:00.000Z";
const later = "2026-11-20T11:00:00.000Z";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-legacy-state-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function ciWatch(updateIdentifier, overrides = {}) {
  return {
    update_identifier: updateIdentifier,
    session_key: topic,
    pull_request_number: 200,
    commit_sha: commit,
    state: "sent",
    result: "success",
    created_at: moment,
    updated_at: moment,
    ...overrides,
  };
}

function previewRequest(updateIdentifier, overrides = {}) {
  return {
    update_identifier: updateIdentifier,
    session_key: topic,
    author_identifier: 555,
    pull_request_number: 200,
    commit_sha: commit,
    state: "confirmed",
    confirmed_origin: origin,
    notice_message_identifier: 90,
    merge_synchronization: 0,
    created_at: moment,
    updated_at: later,
    ...overrides,
  };
}

/** One installation of the previous version with a row for every behaviour. */
function createPreviousState(directory) {
  createLegacyDatabase(directory, "admission.sqlite", {
    instructions: [
      {
        sequence: 3,
        update_identifier: 30,
        message_identifier: 1030,
        session_key: topic,
        author_identifier: 42,
        instruction: "synthetic instruction",
        attachments: JSON.stringify([{ fileName: "a.png" }]),
        reply_message_identifier: 7,
        exact_direct_reply: 1,
        status: "pending",
        outcome: null,
        created_at: moment,
      },
    ],
    trace: [
      {
        sequence: 5,
        update_identifier: 30,
        author_identifier: 42,
        session_key: topic,
        action: "instruction_accepted",
        detail: null,
        created_at: moment,
      },
    ],
    telegram_offset: [{ singleton: 1, update_identifier: 31 }],
  });
  createLegacyDatabase(directory, "ci-watch.sqlite", {
    ci_watches: [
      ciWatch(10),
      ciWatch(11, { state: "pending", result: null, commit_sha: newerCommit }),
      ciWatch(12, {
        session_key: otherTopic,
        pull_request_number: 201,
        state: "superseded",
        result: null,
      }),
      // Notice states an earlier version wrote.
      ciWatch(8, { state: "sending", result: "failure" }),
      ciWatch(9, { state: "uncertain", result: "repairing" }),
    ],
  });
  createLegacyDatabase(directory, "preview-request.sqlite", {
    preview_requests: [
      previewRequest(10),
      previewRequest(11, {
        commit_sha: newerCommit,
        state: "awaiting",
        confirmed_origin: null,
        notice_message_identifier: null,
        merge_synchronization: 1,
      }),
      // A request without a CI watch keeps its preview, but is no publication.
      previewRequest(13, {
        session_key: otherTopic,
        state: "timed_out",
        confirmed_origin: null,
        notice_message_identifier: null,
      }),
    ],
  });
  createLegacyDatabase(directory, "merge-request.sqlite", {
    merge_requests: [
      {
        update_identifier: 40,
        session_key: topic,
        author_identifier: 555,
        pull_request_number: 200,
        commit_sha: commit,
        state: "uncertain",
        merge_commit_sha: null,
        notified_at: moment,
        created_at: moment,
        updated_at: later,
      },
    ],
    merge_questions: [
      {
        session_key: topic,
        question_message_identifier: 900,
        notice_message_identifier: 90,
        publication_update_identifier: 10,
        validation_update_identifier: 20,
        author_identifier: 555,
        pull_request_number: 200,
        commit_sha: commit,
        consumed_at: later,
        created_at: moment,
      },
    ],
  });
  createLegacyDatabase(directory, "session-notes.sqlite", {
    session_notes: [
      {
        sequence: 1,
        session_key: topic,
        text: "Pendent.",
        effect_key: "preview:10:confirmed",
        state: "undelivered",
        created_at: moment,
      },
      {
        sequence: 2,
        session_key: topic,
        text: "Reclamada.",
        effect_key: "ci:10:a:success",
        state: "claimed",
        created_at: moment,
      },
    ],
    session_delivered_effects: [
      {
        sequence: 1,
        session_key: topic,
        effect_key: "instruction:1",
        delivered_at: moment,
      },
    ],
  });
  createLegacyDatabase(directory, "topic-jobs.sqlite", {
    topic_jobs: [
      {
        session_key: topic,
        branch: "feat/agent-synthetic-1234",
        pull_request_number: 200,
      },
    ],
  });
}

function readTable(path, table) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database
      .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => ({ ...row }));
  } finally {
    database.close();
  }
}

// The files of the state, without the lock every import leaves behind.
function filesOf(directory) {
  return readdirSync(directory)
    .filter((name) => name !== "agent-migration.lock")
    .sort();
}

function contentsOf(directory) {
  return Object.fromEntries(
    filesOf(directory).map((name) => [
      name,
      readFileSync(join(directory, name)),
    ]),
  );
}

test("imports every row current behaviour needs and renames the old databases", (context) => {
  const directory = fixture(context);
  createPreviousState(directory);
  const before = contentsOf(directory);

  const migrated = migrateLegacyState(directory);

  assert.deepEqual([...migrated].sort(), [...legacyDatabaseNames].sort());
  assert.deepEqual(
    filesOf(directory),
    [
      "agent.sqlite",
      ...legacyDatabaseNames.map((name) => `${name}.migrated`),
    ].sort(),
  );
  // The old files are renamed and never written.
  for (const name of legacyDatabaseNames) {
    assert.deepEqual(
      readFileSync(join(directory, `${name}.migrated`)),
      before[name],
      name,
    );
  }
  const path = stateDatabasePath(directory);
  const database = new DatabaseSync(path, { readOnly: true });
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 1);
  database.close();

  const queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(queue.readOffset(), 31);
  assert.deepEqual(
    queue.traceEntries().map((entry) => entry.action),
    ["instruction_accepted"],
  );
  const next = queue.next();
  assert.equal(next.updateIdentifier, 30);
  assert.deepEqual(next.attachments, [{ fileName: "a.png" }]);
  assert.equal(next.replyMessageIdentifier, 7);
  assert.equal(next.exactDirectReply, true);
  queue.close();

  const publications = new PublicationStore(path);
  assert.deepEqual(
    publications.pendingCiWatches().map((row) => [row.update_identifier]),
    [[11]],
  );
  for (const [updateIdentifier, ciState] of [
    [8, "superseded"],
    [9, "superseded"],
    [10, "sent"],
    [12, "superseded"],
    [13, null],
  ]) {
    assert.equal(publications.ciState(updateIdentifier), ciState);
  }
  assert.deepEqual(
    publications.awaitingPreviews().map((row) => ({ ...row })),
    [
      {
        update_identifier: 11,
        session_key: topic,
        pull_request_number: 200,
        commit_sha: newerCommit,
        author_identifier: 555,
        merge_synchronization: 1,
        ci_state: "pending",
        ci_result: null,
        preview_state: "awaiting",
        confirmed_origin: null,
        notice_message_identifier: null,
        created_at: moment,
        preview_updated_at: later,
      },
    ],
  );
  // The latest publication of the topic still awaits, so nothing is delivered.
  assert.equal(publications.deliveredPreview(topic), undefined);
  assert.equal(publications.previewState(13), "timed_out");
  assert.equal(publications.topicPullRequestNumber(otherTopic), 201);
  publications.close();

  const merges = new MergeRequestStore(path);
  assert.equal(merges.uncertain()[0].notified_at, moment);
  assert.equal(
    merges.question({ sessionKey: topic, questionMessageIdentifier: 900 })
      .consumed_at,
    later,
  );
  merges.close();

  const notes = new SessionNoteStore(path);
  assert.deepEqual(
    notes.claim(topic).map((note) => note.text),
    ["Pendent."],
    "the claim the restart interrupted counts as delivered",
  );
  for (const effectKey of ["ci:10:a:success", "instruction:1"]) {
    assert.equal(
      notes.addNote({ sessionKey: topic, text: "Repetit.", effectKey }),
      false,
    );
  }
  notes.close();

  const topicJobs = new TopicJobStore(path);
  assert.deepEqual(topicJobs.bindingOf(topic), {
    branch: "feat/agent-synthetic-1234",
    pullRequestNumber: 200,
  });
  topicJobs.close();
});

test("keeps the delivered notice that pins a merge", (context) => {
  const directory = fixture(context);
  createLegacyDatabase(directory, "ci-watch.sqlite", {
    ci_watches: [ciWatch(10)],
  });
  createLegacyDatabase(directory, "preview-request.sqlite", {
    preview_requests: [previewRequest(10)],
  });

  migrateLegacyState(directory);

  const publications = new PublicationStore(stateDatabasePath(directory));
  context.after(() => publications.close());
  const delivered = publications.deliveredPreview(topic);
  assert.equal(delivered.update_identifier, 10);
  assert.equal(delivered.commit_sha, commit);
  assert.equal(delivered.notice_message_identifier, 90);
  assert.equal(delivered.confirmed_origin, origin);
});

test("imports an older preview database with its extra columns and states", (context) => {
  const directory = fixture(context);
  const database = new DatabaseSync(join(directory, "preview-request.sqlite"));
  database.exec(`
    CREATE TABLE preview_requests (
      update_identifier INTEGER PRIMARY KEY,
      session_key TEXT NOT NULL,
      author_identifier INTEGER NOT NULL,
      pull_request_number INTEGER NOT NULL,
      commit_sha TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('commenting', 'awaiting', 'confirmed', 'timed_out', 'failed', 'uncertain')),
      commented_at TEXT,
      confirmed_origin TEXT,
      notice_message_identifier INTEGER,
      merge_synchronization INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO preview_requests
    VALUES (1, '${topic}', 555, 200, '${commit}', 'uncertain', '${moment}',
            NULL, NULL, 0, '${moment}', '${moment}');
  `);
  database.close();

  migrateLegacyState(directory);

  const publications = new PublicationStore(stateDatabasePath(directory));
  context.after(() => publications.close());
  assert.equal(publications.previewState(1), "failed");
});

test("migrates only the databases that exist and skips a table never created", (context) => {
  const directory = fixture(context);
  createLegacyDatabase(directory, "topic-jobs.sqlite");
  const database = new DatabaseSync(join(directory, "merge-request.sqlite"));
  database.close();

  assert.deepEqual(migrateLegacyState(directory), [
    "merge-request.sqlite",
    "topic-jobs.sqlite",
  ]);
});

test("does nothing without old databases and nothing the second time", (context) => {
  const directory = fixture(context);
  assert.deepEqual(migrateLegacyState(directory), []);
  assert.deepEqual(readdirSync(directory), []);

  createPreviousState(directory);
  migrateLegacyState(directory);
  const migrated = contentsOf(directory);

  assert.deepEqual(migrateLegacyState(directory), []);
  assert.deepEqual(contentsOf(directory), migrated);
});

for (const [column, value] of [
  ["commit_sha", newerCommit],
  ["pull_request_number", 201],
  ["session_key", otherTopic],
]) {
  test(`drops a preview whose ${column} differs from its CI watch`, (context) => {
    const directory = fixture(context);
    createLegacyDatabase(directory, "ci-watch.sqlite", {
      ci_watches: [ciWatch(10)],
    });
    createLegacyDatabase(directory, "preview-request.sqlite", {
      preview_requests: [previewRequest(10, { [column]: value })],
    });
    const logged = [];

    migrateLegacyState(directory, {
      logger: (...entry) => logged.push(entry),
    });

    assert.deepEqual(logged, [["migration_preview_dropped", "10"]]);
    const [row] = readTable(stateDatabasePath(directory), "publications");
    assert.equal(row.session_key, topic);
    assert.equal(row.pull_request_number, 200);
    assert.equal(row.commit_sha, commit);
    assert.equal(row.ci_state, "sent");
    for (const previewColumn of [
      "author_identifier",
      "preview_state",
      "confirmed_origin",
      "notice_message_identifier",
      "preview_updated_at",
    ]) {
      assert.equal(row[previewColumn], null, previewColumn);
    }
    const publications = new PublicationStore(stateDatabasePath(directory));
    context.after(() => publications.close());
    assert.equal(publications.deliveredPreview(topic), undefined);
  });
}

// A process killed in the middle of a transaction leaves a hot journal.
function leaveHotJournal(path) {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      import { DatabaseSync } from "node:sqlite";
      const database = new DatabaseSync(process.argv[1]);
      database.exec("PRAGMA cache_size = 1");
      database.exec("BEGIN IMMEDIATE");
      database.exec("DELETE FROM topic_jobs");
      const insert = database.prepare(
        "INSERT INTO trace (action, detail, created_at) VALUES ('x', ?, 'x')",
      );
      for (let index = 0; index < 200; index += 1) {
        insert.run("x".repeat(4000));
      }
      process.kill(process.pid, "SIGKILL");
    `,
    path,
  ]);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(existsSync(`${path}-journal`), true);
}

test("never applies the journal of a removed state database to a new import", (context) => {
  const directory = fixture(context);
  createPreviousState(directory);
  migrateLegacyState(directory);
  const path = stateDatabasePath(directory);
  leaveHotJournal(path);
  // A rollback that removes only the database, and the previous version writes.
  for (const name of legacyDatabaseNames) {
    renameSync(join(directory, `${name}.migrated`), join(directory, name));
  }
  rmSync(path);
  const previous = new DatabaseSync(join(directory, "topic-jobs.sqlite"));
  previous.exec(
    `INSERT INTO topic_jobs VALUES ('${otherTopic}', 'feat/agent-later', 201)`,
  );
  previous.close();
  const before = contentsOf(directory);

  assert.throws(
    () => migrateLegacyState(directory),
    /agent\.sqlite-journal belong to a removed agent\.sqlite\. Remove them/u,
  );
  assert.deepEqual(contentsOf(directory), before);

  rmSync(`${path}-journal`);
  migrateLegacyState(directory);
  assert.equal(readTable(path, "topic_jobs").length, 2);
});

for (const suffix of ["-wal", "-shm"]) {
  test(`refuses a leftover agent.sqlite${suffix}`, (context) => {
    const directory = fixture(context);
    createPreviousState(directory);
    writeFileSync(`${stateDatabasePath(directory)}${suffix}`, "leftover");

    assert.throws(
      () => migrateLegacyState(directory),
      /belong to a removed agent\.sqlite/u,
    );
  });
}

test("never imports while another process holds the migration lock", (context) => {
  const directory = fixture(context);
  createPreviousState(directory);
  // Another importer, in the middle of building the new database.
  writeFileSync(join(directory, "agent.sqlite.migrating"), "in progress");
  const holder = new DatabaseSync(join(directory, "agent-migration.lock"));
  holder.exec("BEGIN EXCLUSIVE");
  const before = contentsOf(directory);

  assert.throws(
    () => migrateLegacyState(directory),
    /another process holds agent-migration\.lock/u,
  );
  assert.deepEqual(contentsOf(directory), before);

  holder.close();
  assert.equal(
    migrateLegacyState(directory).length,
    legacyDatabaseNames.length,
  );
});

test("changes nothing when an old database cannot be read", (context) => {
  const directory = fixture(context);
  createPreviousState(directory);
  writeFileSync(
    join(directory, "topic-jobs.sqlite"),
    "not a database".repeat(64),
  );
  const before = contentsOf(directory);

  assert.throws(() => migrateLegacyState(directory), /state migration failed/u);

  assert.deepEqual(contentsOf(directory), before);
});

test("rebuilds an interrupted attempt from the old databases", (context) => {
  const directory = fixture(context);
  createPreviousState(directory);
  writeFileSync(join(directory, "agent.sqlite.migrating"), "partial");
  writeFileSync(join(directory, "agent.sqlite.migrating-journal"), "partial");

  migrateLegacyState(directory);

  assert.equal(existsSync(join(directory, "agent.sqlite.migrating")), false);
  assert.equal(
    readTable(stateDatabasePath(directory), "publications").length,
    6,
  );
});

test("finishes the renames of a migration interrupted after publishing", (context) => {
  const directory = fixture(context);
  createPreviousState(directory);
  migrateLegacyState(directory);
  renameSync(
    join(directory, "topic-jobs.sqlite.migrated"),
    join(directory, "topic-jobs.sqlite"),
  );

  assert.deepEqual(migrateLegacyState(directory), ["topic-jobs.sqlite"]);

  assert.equal(existsSync(join(directory, "topic-jobs.sqlite")), false);
});

test("refuses old databases the state database did not import", (context) => {
  const directory = fixture(context);
  createPreviousState(directory);
  migrateLegacyState(directory);
  // A rollback ran the previous version again and it wrote its own state.
  for (const name of ["ci-watch.sqlite", "topic-jobs.sqlite"]) {
    renameSync(join(directory, `${name}.migrated`), join(directory, name));
  }
  const database = new DatabaseSync(join(directory, "ci-watch.sqlite"));
  database.exec("UPDATE ci_watches SET state = 'sent'");
  database.close();
  const before = contentsOf(directory);

  assert.throws(
    () => migrateLegacyState(directory),
    /ci-watch\.sqlite hold state it did not import/u,
  );

  assert.deepEqual(contentsOf(directory), before, "no file is renamed");
});
