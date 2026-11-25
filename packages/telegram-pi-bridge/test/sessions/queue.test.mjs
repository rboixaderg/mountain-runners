import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { AdmissionQueue } from "../../src/sessions/queue.mjs";

function databasePath(context) {
  const directory = mkdtempSync(join(tmpdir(), "telegram-pi-admission-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return join(directory, "admission.sqlite");
}

function request(updateIdentifier, overrides = {}) {
  return {
    updateIdentifier,
    messageIdentifier: updateIdentifier + 1000,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 42,
    instruction: `instruction ${updateIdentifier}`,
    ...overrides,
  };
}

test("keeps an accepted instruction across a restart and deduplicates its update", (context) => {
  const path = databasePath(context);
  let queue = new AdmissionQueue(path, { maxPending: 10 });

  assert.equal(queue.admit(request(1)), "accepted");
  queue.close();

  queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(queue.admit(request(1)), "duplicate");
  assert.equal(queue.pendingCount(), 1);
  assert.equal(queue.isBlocked(), false);
  assert.equal(queue.next().updateIdentifier, 1);
  assert.equal(queue.status(1), "running");
  assert.equal(queue.isBlocked(), true);
  assert.equal(queue.complete(1, "pr_created"), true);
  assert.equal(queue.status(1), "done");
  assert.equal(queue.isBlocked(), false);
  assert.equal(queue.admit(request(2)), "accepted");
  assert.equal(queue.isFirstInstruction(request(1).sessionKey, 1), true);
  assert.equal(queue.isFirstInstruction(request(2).sessionKey, 2), false);
  assert.equal(queue.isFirstInstruction("-1001234567890:8", 1), false);
  queue.close();
});

test("stays blocked while an instruction has an unknown external result", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  queue.admit(request(1));
  queue.next();
  assert.equal(queue.markUncertain(1, "publication_uncertain"), true);
  assert.equal(queue.isBlocked(), true);
  assert.equal(queue.next(), null);
  queue.close();
});

test("processes pending instructions in arrival order", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  queue.admit(request(10));
  queue.admit(request(11, { sessionKey: "-1001234567890:8" }));

  assert.equal(queue.next().updateIdentifier, 10);
  assert.equal(queue.next(), null);
  queue.complete(10, "answered");

  assert.equal(queue.next().updateIdentifier, 11);
  queue.close();
});

test("admits at most the configured number of pending instructions", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 2 });
  assert.equal(queue.admit(request(1)), "accepted");
  assert.equal(queue.admit(request(2)), "accepted");
  assert.equal(queue.admit(request(3)), "rejected_full");
  assert.equal(queue.status(3), "rejected");
  assert.equal(queue.pendingCount(), 2);
  queue.close();
});

test("keeps a rejected instruction as evidence and does not replay it after a restart", (context) => {
  const path = databasePath(context);
  let queue = new AdmissionQueue(path, { maxPending: 1 });
  queue.admit(request(1));
  queue.admit(request(2));
  queue.close();

  queue = new AdmissionQueue(path, { maxPending: 1 });
  assert.equal(queue.admit(request(2)), "duplicate");
  assert.equal(queue.status(2), "rejected");
  queue.close();
});

test("stops new work while a run is interrupted and leaves it uncertain", (context) => {
  const path = databasePath(context);
  let queue = new AdmissionQueue(path, { maxPending: 10 });
  queue.admit(request(1));
  queue.admit(request(2));
  assert.equal(queue.next().updateIdentifier, 1);
  queue.close();

  queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(queue.recover(), 1);
  assert.equal(queue.status(1), "uncertain");
  assert.equal(queue.status(2), "pending");
  assert.equal(queue.next(), null);
  queue.close();
});

test("marks an instruction uncertain when its process is killed during execution", (context) => {
  const path = databasePath(context);
  const moduleUrl = new URL("../../src/sessions/queue.mjs", import.meta.url)
    .href;
  const code = `
    import { AdmissionQueue } from ${JSON.stringify(moduleUrl)};
    const queue = new AdmissionQueue(process.argv[1], { maxPending: 10 });
    queue.admit({
      updateIdentifier: 7,
      messageIdentifier: 1007,
      sessionKey: "-1001234567890:7",
      authorIdentifier: 42,
      instruction: "synthetic instruction"
    });
    queue.next();
    process.kill(process.pid, "SIGKILL");
  `;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code, path],
    { env: { PATH: process.env.PATH } },
  );
  assert.equal(child.signal, "SIGKILL");

  const queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(queue.recover(), 1);
  assert.equal(queue.status(7), "uncertain");
  assert.equal(queue.next(), null);
  queue.close();
});

test("waits for a concurrent writer instead of failing at once", async (context) => {
  const path = databasePath(context);
  const queue = new AdmissionQueue(path, { maxPending: 10 });
  queue.close();
  const holder = new DatabaseSync(path);
  holder.exec("BEGIN IMMEDIATE");

  const moduleUrl = new URL("../../src/sessions/queue.mjs", import.meta.url)
    .href;
  const code = `
    import { AdmissionQueue } from ${JSON.stringify(moduleUrl)};
    const queue = new AdmissionQueue(process.argv[1], { maxPending: 10 });
    queue.admit({
      updateIdentifier: 1,
      messageIdentifier: 1001,
      sessionKey: "-1001234567890:7",
      authorIdentifier: 42,
      instruction: "synthetic instruction"
    });
    process.stdout.write("accepted");
    queue.close();
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, path],
    { env: { PATH: process.env.PATH } },
  );
  let output = "";
  let errorOutput = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errorOutput += chunk;
  });

  // The writer holds the lock until the admission is already waiting.
  await new Promise((resolve) => setTimeout(resolve, 300));
  holder.exec("COMMIT");
  holder.close();

  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 0, errorOutput);
  assert.equal(output, "accepted");
});

test("creates the indexes that back the queue queries", (context) => {
  const path = databasePath(context);
  const queue = new AdmissionQueue(path, { maxPending: 10 });
  queue.close();

  const database = new DatabaseSync(path);
  try {
    const names = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name);
    for (const name of [
      "instructions_status",
      "instructions_session_status",
      "trace_update_action",
      "trace_session_created",
    ]) {
      assert.equal(names.includes(name), true, name);
    }
  } finally {
    database.close();
  }
});

test("rolls the migration back when it fails", (context) => {
  const path = databasePath(context);
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE instructions (
      sequence INTEGER PRIMARY KEY,
      update_identifier INTEGER NOT NULL UNIQUE,
      message_identifier INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      author_identifier INTEGER NOT NULL,
      instruction TEXT NOT NULL,
      attachment TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uncertain', 'done', 'rejected')),
      outcome TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER refuse_migration BEFORE UPDATE ON instructions
    BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END;
  `);
  database
    .prepare(
      `INSERT INTO instructions
         (update_identifier, message_identifier, session_key, author_identifier, instruction, attachment, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      1,
      1001,
      "-1001234567890:7",
      42,
      "instruction 1",
      "{}",
      "pending",
      "2026-01-01T00:00:00.000Z",
    );
  database.close();

  assert.throws(
    () => new AdmissionQueue(path, { maxPending: 10 }),
    /synthetic migration failure/u,
  );

  const check = new DatabaseSync(path);
  try {
    const columns = check.prepare("PRAGMA table_info(instructions)").all();
    assert.equal(
      columns.some((column) => column.name === "attachments"),
      false,
      "the failed migration left the old schema",
    );
    assert.equal(
      columns.some((column) => column.name === "reply_message_identifier"),
      false,
      "the failed migration left no partial reply column",
    );
  } finally {
    check.close();
  }
});

test("persists the Telegram offset and appends private trace entries", (context) => {
  const path = databasePath(context);
  let queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(queue.readOffset(), 0);
  queue.writeOffset(500);
  queue.recordTrace({
    updateIdentifier: 500,
    authorIdentifier: 42,
    sessionKey: "-1001234567890:7",
    action: "instruction_denied",
    detail: "not_a_group_member",
  });
  queue.close();

  queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(queue.readOffset(), 500);
  const entries = queue.traceEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "instruction_denied");
  assert.equal(entries[0].detail, "not_a_group_member");
  queue.close();
});

test("tells whether the session has another instruction pending or running", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  const topic = "-1001234567890:7";
  assert.equal(queue.hasOtherInstructions(topic, 1), false);

  queue.admit(request(1));
  assert.equal(queue.hasOtherInstructions(topic, 1), false);
  assert.equal(queue.hasOtherInstructions(topic, 2), true);
  assert.equal(queue.hasOtherInstructions("-1001234567890:8", 2), false);

  queue.admit(request(2));
  assert.equal(queue.hasOtherInstructions(topic, 1), true);

  queue.next();
  assert.equal(queue.hasOtherInstructions(topic, 1), true);
  queue.complete(1, "answered");
  queue.next();
  queue.complete(2, "answered");
  assert.equal(queue.hasOtherInstructions(topic, 3), false);
  queue.close();
});

test("counts an unknown result as unsettled work of its session", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  const topic = "-1001234567890:7";
  queue.admit(request(1));
  assert.equal(queue.hasUnsettledInstructions(topic, 2), true);
  queue.next();
  assert.equal(queue.hasUnsettledInstructions(topic, 2), true);
  queue.markUncertain(1, "uncertain");

  assert.equal(queue.hasUnsettledInstructions(topic, 2), true);
  assert.equal(queue.hasUnsettledInstructions(topic, 1), false);
  assert.equal(queue.hasOtherInstructions(topic, 2), false);
  queue.close();
});

test("stores the attachments with the admitted instruction", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  const attachments = [
    {
      fileIdentifier: "telegram-file",
      fileUniqueIdentifier: "telegram-unique-file",
      fileName: "imatge-1.png",
      mimeType: "image/png",
      fileSize: 1200000,
      origin: "message",
    },
    {
      fileIdentifier: "telegram-file-2",
      fileUniqueIdentifier: "telegram-unique-file-2",
      fileName: "foto.jpg",
      mimeType: "image/jpeg",
      fileSize: 900000,
      origin: "message",
    },
  ];

  assert.equal(queue.admit(request(1, { attachments })), "accepted");
  assert.deepEqual(queue.next().attachments, attachments);
  queue.close();
});

test("returns no attachment for an instruction without one", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  assert.equal(queue.admit(request(1)), "accepted");
  assert.deepEqual(queue.next().attachments, []);
  assert.equal(queue.next(), null);
  queue.close();
});

test("persists the reply message identifier across a restart", (context) => {
  const path = databasePath(context);
  let queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(
    queue.admit(
      request(1, { replyMessageIdentifier: 49, exactDirectReply: true }),
    ),
    "accepted",
  );
  queue.close();

  queue = new AdmissionQueue(path, { maxPending: 10 });
  const admitted = queue.next();
  assert.equal(admitted.replyMessageIdentifier, 49);
  assert.equal(admitted.exactDirectReply, true);
  queue.close();
});

test("only stores a strict true marker with a reply identifier", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  for (const [index, overrides] of [
    { exactDirectReply: true },
    { exactDirectReply: 1, replyMessageIdentifier: 49 },
    { exactDirectReply: false, replyMessageIdentifier: 49 },
  ].entries()) {
    queue.admit(request(index + 1, overrides));
    assert.equal(queue.next().exactDirectReply, false);
    queue.complete(index + 1, "answered");
  }
  queue.close();
});

test("migrates existing reply identifiers without inferring exact text", (context) => {
  const path = databasePath(context);
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE instructions (
      sequence INTEGER PRIMARY KEY,
      update_identifier INTEGER NOT NULL UNIQUE,
      message_identifier INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      author_identifier INTEGER NOT NULL,
      instruction TEXT NOT NULL,
      attachments TEXT,
      reply_message_identifier INTEGER,
      status TEXT NOT NULL,
      outcome TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO instructions
      (update_identifier, message_identifier, session_key, author_identifier,
       instruction, reply_message_identifier, status, created_at)
    VALUES (1, 1001, '-1001234567890:7', 42, 'Sí, envia-ho', 49, 'pending', '2026-01-01');
  `);
  database.close();
  const queue = new AdmissionQueue(path, { maxPending: 10 });
  const admitted = queue.next();
  assert.equal(admitted.replyMessageIdentifier, 49);
  assert.equal(admitted.exactDirectReply, false);
  queue.close();
});

test("tells whether the same topic has intervening instructions", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  const sessionKey = "-1001234567890:7";
  const excludingOutcome = "context_only";
  // The update identifiers are not monotonic: the persisted sequence decides.
  for (const updateIdentifier of [10, 4, 7, 9]) {
    assert.equal(queue.admit(request(updateIdentifier)), "accepted");
  }
  assert.equal(queue.next().updateIdentifier, 10);
  queue.complete(10, "answered");
  assert.equal(queue.next().updateIdentifier, 4);
  queue.complete(4, excludingOutcome);
  assert.equal(queue.next().updateIdentifier, 7);
  queue.complete(7, "answered");

  assert.equal(
    queue.hasInterveningInstructions({
      sessionKey,
      afterUpdateIdentifier: 10,
      updateIdentifier: 7,
      excludingOutcome,
    }),
    false,
    "the excluded outcome does not count",
  );
  assert.equal(
    queue.hasInterveningInstructions({
      sessionKey,
      afterUpdateIdentifier: 10,
      updateIdentifier: 9,
      excludingOutcome,
    }),
    true,
  );
  assert.equal(
    queue.hasInterveningInstructions({
      sessionKey,
      afterUpdateIdentifier: 10,
      updateIdentifier: 7,
      excludingOutcome: "another_outcome",
    }),
    true,
    "the excluded outcome is the caller's value",
  );
  assert.equal(
    queue.hasInterveningInstructions({
      sessionKey,
      afterUpdateIdentifier: 10,
      updateIdentifier: 7,
    }),
    true,
    "omitting the excluded outcome fails closed",
  );
  assert.equal(
    queue.hasInterveningInstructions({
      sessionKey: "-1001234567890:8",
      afterUpdateIdentifier: 10,
      updateIdentifier: 9,
      excludingOutcome,
    }),
    true,
    "another topic fails closed",
  );
  assert.equal(
    queue.hasInterveningInstructions({
      sessionKey,
      afterUpdateIdentifier: 99,
      updateIdentifier: 9,
      excludingOutcome,
    }),
    true,
    "a missing endpoint fails closed",
  );
  assert.equal(
    queue.hasInterveningInstructions({
      sessionKey,
      afterUpdateIdentifier: 7,
      updateIdentifier: 10,
      excludingOutcome,
    }),
    true,
    "an out-of-order pair fails closed",
  );
  queue.close();
});

test("migrates the single attachment column into a list", (context) => {
  const path = databasePath(context);
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE instructions (
      sequence INTEGER PRIMARY KEY,
      update_identifier INTEGER NOT NULL UNIQUE,
      message_identifier INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      author_identifier INTEGER NOT NULL,
      instruction TEXT NOT NULL,
      attachment TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uncertain', 'done', 'rejected')),
      outcome TEXT,
      created_at TEXT NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO instructions
         (update_identifier, message_identifier, session_key, author_identifier, instruction, attachment, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      1,
      1001,
      "-1001234567890:7",
      42,
      "instruction 1",
      JSON.stringify({
        fileIdentifier: "telegram-file",
        fileUniqueIdentifier: "telegram-unique-file",
        fileName: "portada.png",
        mimeType: "image/png",
        fileSize: 1200000,
        origin: "message",
      }),
      "pending",
      "2026-01-01T00:00:00.000Z",
    );
  database.close();

  const queue = new AdmissionQueue(path, { maxPending: 10 });
  const migrated = queue.next();
  assert.deepEqual(migrated.attachments, [
    {
      fileIdentifier: "telegram-file",
      fileUniqueIdentifier: "telegram-unique-file",
      fileName: "portada.png",
      mimeType: "image/png",
      fileSize: 1200000,
      origin: "message",
    },
  ]);
  assert.equal(migrated.replyMessageIdentifier, null);
  assert.equal(migrated.exactDirectReply, false);
  queue.complete(1, "answered");

  const attachments = [
    {
      fileIdentifier: "telegram-file",
      fileUniqueIdentifier: "telegram-unique-file",
      fileName: "foto.jpg",
      mimeType: "image/jpeg",
      fileSize: 900000,
      origin: "reply",
    },
  ];
  assert.equal(queue.admit(request(2, { attachments })), "accepted");
  assert.deepEqual(queue.next().attachments, attachments);
  queue.close();
});

test("migrates a deployed database that has attachments but no reply column", (context) => {
  const path = databasePath(context);
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE instructions (
      sequence INTEGER PRIMARY KEY,
      update_identifier INTEGER NOT NULL UNIQUE,
      message_identifier INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      author_identifier INTEGER NOT NULL,
      instruction TEXT NOT NULL,
      attachments TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uncertain', 'done', 'rejected')),
      outcome TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const existingAttachments = [
    {
      fileIdentifier: "telegram-file",
      fileUniqueIdentifier: "telegram-unique-file",
      fileName: "portada.png",
      mimeType: "image/png",
      fileSize: 1200000,
      origin: "message",
    },
  ];
  database
    .prepare(
      `INSERT INTO instructions
         (update_identifier, message_identifier, session_key, author_identifier, instruction, attachments, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      1,
      1001,
      "-1001234567890:7",
      42,
      "instruction 1",
      JSON.stringify(existingAttachments),
      "pending",
      "2026-01-01T00:00:00.000Z",
    );
  database.close();

  const queue = new AdmissionQueue(path, { maxPending: 10 });
  const migrated = queue.next();
  assert.deepEqual(migrated.attachments, existingAttachments);
  assert.equal(migrated.replyMessageIdentifier, null);
  queue.complete(1, "answered");

  assert.equal(
    queue.admit(request(2, { replyMessageIdentifier: 90 })),
    "accepted",
  );
  assert.equal(queue.next().replyMessageIdentifier, 90);
  queue.close();
});

test("resolves an uncertain instruction once and never keeps its text", (context) => {
  const path = databasePath(context);
  const queue = new AdmissionQueue(path, { maxPending: 10 });
  queue.admit(request(1));
  queue.next();
  queue.markUncertain(1, "uncertain");

  const uncertain = queue.uncertain();
  assert.equal(uncertain.length, 1);
  assert.equal(uncertain[0].update_identifier, 1);
  assert.equal(uncertain[0].session_key, "-1001234567890:7");
  assert.equal("instruction" in uncertain[0], false);

  const trace = {
    updateIdentifier: 1,
    sessionKey: "-1001234567890:7",
    action: "uncertain_reconciled",
    detail: "instruction not_published",
  };
  const resolved = queue.resolveUncertain({
    updateIdentifier: 1,
    outcome: "reconciled_not_published",
    trace,
  });
  assert.equal(resolved.update_identifier, 1);
  assert.equal(queue.status(1), "done");
  assert.equal(queue.uncertain().length, 0);
  const entries = queue.traceEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "uncertain_reconciled");
  assert.equal(entries[0].detail, "instruction not_published");

  assert.equal(
    queue.resolveUncertain({
      updateIdentifier: 1,
      outcome: "reconciled_published",
      trace,
    }),
    null,
  );
  assert.equal(queue.traceEntries().length, 1);
  queue.close();
});

test("keeps an instruction uncertain when its trace cannot be written", (context) => {
  const path = databasePath(context);
  const queue = new AdmissionQueue(path, { maxPending: 10 });
  queue.admit(request(1));
  queue.next();
  queue.markUncertain(1, "uncertain");
  const database = new DatabaseSync(path);
  database.exec("DROP TABLE trace");
  database.close();

  assert.throws(() =>
    queue.resolveUncertain({
      updateIdentifier: 1,
      outcome: "reconciled_not_published",
      trace: {
        updateIdentifier: 1,
        sessionKey: "-1001234567890:7",
        action: "uncertain_reconciled",
        detail: "instruction not_published",
      },
    }),
  );
  assert.equal(queue.status(1), "uncertain");
  queue.close();
});

test("finds a trace entry of an update by action", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  queue.recordTrace({
    updateIdentifier: 10,
    action: "attachment_refused",
    detail: "reason=too_large",
  });

  assert.equal(
    queue.hasTrace({ updateIdentifier: 10, action: "attachment_refused" }),
    true,
  );
  assert.equal(
    queue.hasTrace({ updateIdentifier: 10, action: "instruction_completed" }),
    false,
  );
  assert.equal(
    queue.hasTrace({ updateIdentifier: 11, action: "attachment_refused" }),
    false,
  );
  queue.close();
});
