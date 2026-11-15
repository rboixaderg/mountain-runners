import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

test("stores the attachment with the admitted instruction", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  const attachment = {
    fileIdentifier: "telegram-file",
    fileUniqueIdentifier: "telegram-unique-file",
    fileName: "portada.png",
    mimeType: "image/png",
    fileSize: 1200000,
    origin: "message",
  };

  assert.equal(queue.admit(request(1, { attachment })), "accepted");
  assert.deepEqual(queue.next().attachment, attachment);
  queue.close();
});

test("returns no attachment for an instruction without one", (context) => {
  const queue = new AdmissionQueue(databasePath(context), { maxPending: 10 });
  assert.equal(queue.admit(request(1)), "accepted");
  assert.equal(queue.next().attachment, null);
  queue.close();
});

test("adds the attachment column to an existing database", (context) => {
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
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uncertain', 'done', 'rejected')),
      outcome TEXT,
      created_at TEXT NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO instructions
         (update_identifier, message_identifier, session_key, author_identifier, instruction, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      1,
      1001,
      "-1001234567890:7",
      42,
      "instruction 1",
      "pending",
      "2026-01-01T00:00:00.000Z",
    );
  database.close();

  const queue = new AdmissionQueue(path, { maxPending: 10 });
  assert.equal(queue.next().attachment, null);
  queue.complete(1, "answered");

  const attachment = {
    fileIdentifier: "telegram-file",
    fileUniqueIdentifier: "telegram-unique-file",
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
    fileSize: 900000,
    origin: "reply",
  };
  assert.equal(queue.admit(request(2, { attachment })), "accepted");
  assert.deepEqual(queue.next().attachment, attachment);
  queue.close();
});
