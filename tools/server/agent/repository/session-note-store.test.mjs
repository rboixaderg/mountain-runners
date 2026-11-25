import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { noteLimits, SessionNoteStore } from "./session-note-store.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-session-notes-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "session-notes.sqlite");
}

const topicSessionKey = "-1001234567890:7";
const otherSessionKey = "-1001234567890:8";

test("drops the table that stored the last reply of each topic", (context) => {
  const path = fixture(context);
  const previous = new DatabaseSync(path);
  previous.exec(`
    CREATE TABLE session_context (
      session_key TEXT PRIMARY KEY,
      last_reply TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO session_context
    VALUES ('-1001234567890:7', 'Resposta del model.', '2026-11-18T10:00:00Z');
  `);
  previous.close();

  new SessionNoteStore(path).close();

  const database = new DatabaseSync(path);
  context.after(() => database.close());
  assert.equal(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE name = 'session_context'")
      .get(),
    undefined,
  );
});

test("claims the undelivered notes of a topic once, oldest first", (context) => {
  const store = new SessionNoteStore(fixture(context));
  context.after(() => store.close());

  store.addNote({ sessionKey: topicSessionKey, text: "Pull request creada." });
  store.addNote({ sessionKey: otherSessionKey, text: "Un altre tema." });
  store.addNote({
    sessionKey: topicSessionKey,
    text: "Comprovacions correcte.",
  });

  const claimed = store.claim(topicSessionKey);
  assert.deepEqual(
    claimed.map((note) => note.text),
    ["Pull request creada.", "Comprovacions correcte."],
    "the notes belong to their own topic and keep their order",
  );
  assert.deepEqual(store.claim(topicSessionKey), [], "a claim is not repeated");

  store.deliver(claimed);
  assert.deepEqual(store.claim(topicSessionKey), []);
  assert.deepEqual(
    store.claim(otherSessionKey).map((note) => note.text),
    ["Un altre tema."],
    "delivering one topic never touches another",
  );
});

test("keeps an undelivered note until a turn claims it", (context) => {
  const store = new SessionNoteStore(fixture(context));
  context.after(() => store.close());

  store.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });

  assert.deepEqual(
    store.claim(topicSessionKey).map((note) => note.text),
    ["Efecte pendent."],
    "the effect reaches the next turn that claims it",
  );
  assert.deepEqual(store.claim(topicSessionKey), []);
});

test("keeps the unclaimed notes after a restart and never repeats a claim", (context) => {
  const path = fixture(context);
  let store = new SessionNoteStore(path);
  store.addNote({ sessionKey: topicSessionKey, text: "Efecte sense lliurar." });
  store.addNote({ sessionKey: topicSessionKey, text: "Efecte en curs." });
  const [delivered, interrupted] = store.claim(topicSessionKey);
  assert.equal(delivered.text, "Efecte sense lliurar.");
  store.deliver([delivered]);
  // The second note stays claimed: the turn it belonged to never finished.
  assert.equal(interrupted.text, "Efecte en curs.");
  store.close();

  store = new SessionNoteStore(path);
  context.after(() => store.close());
  assert.deepEqual(
    store.claim(topicSessionKey),
    [],
    "an interrupted turn is never repeated and a delivered note is gone",
  );
  store.addNote({ sessionKey: topicSessionKey, text: "Efecte sense lliurar." });
  assert.deepEqual(
    store.claim(topicSessionKey).map((note) => note.text),
    ["Efecte sense lliurar."],
    "a new note still reaches the turn after the restart",
  );
});

test("truncates a long note before the topic keeps it", (context) => {
  const store = new SessionNoteStore(fixture(context));
  context.after(() => store.close());

  store.addNote({
    sessionKey: topicSessionKey,
    text: `a${"b".repeat(noteLimits.characters * 2)}`,
  });

  const [note] = store.claim(topicSessionKey);
  assert.equal(note.text.length, noteLimits.characters);
  assert.equal(note.text, `a${"b".repeat(noteLimits.characters - 2)}…`);
  assert.equal(note.text.startsWith("a" + "b".repeat(10)), true);
  assert.equal(note.text.endsWith("…"), true);
});

test("keeps only the newest undelivered notes of a topic", (context) => {
  const store = new SessionNoteStore(fixture(context));
  context.after(() => store.close());

  for (let index = 0; index < noteLimits.perSession + 5; index += 1) {
    store.addNote({
      sessionKey: topicSessionKey,
      text: `nota ${index}`,
    });
  }

  const claimed = store.claim(topicSessionKey);
  assert.equal(claimed.length, noteLimits.perSession);
  assert.equal(
    claimed.at(-1).text,
    `nota ${noteLimits.perSession + 4}`,
    "the newest note is kept",
  );
  assert.equal(claimed[0].text, "nota 5", "only the oldest notes are dropped");
});

test("stores an effect identity once per topic, retries included", (context) => {
  const store = new SessionNoteStore(fixture(context));
  context.after(() => store.close());

  const note = {
    sessionKey: topicSessionKey,
    text: "Preview publicada.",
    effectKey: "preview:20:confirmed",
  };
  assert.equal(store.addNote(note), true);
  assert.equal(
    store.addNote(note),
    false,
    "a retried notice is not a new note",
  );
  assert.deepEqual(
    store.claim(topicSessionKey).map((entry) => entry.text),
    ["Preview publicada."],
  );

  // A retry after the note was delivered must not revive it.
  assert.equal(store.addNote(note), false);
  assert.deepEqual(store.claim(topicSessionKey), []);

  // Another effect of the same topic is a different note.
  assert.equal(
    store.addNote({ ...note, effectKey: "preview:20:unconfirmed" }),
    true,
  );
  assert.equal(
    store.addNote({ ...note, sessionKey: otherSessionKey }),
    true,
    "the identity is per topic",
  );
});

test("keeps the identity of an interrupted claim across a restart", (context) => {
  const path = fixture(context);
  const note = {
    sessionKey: topicSessionKey,
    text: "Preview publicada.",
    effectKey: "preview:20:confirmed",
  };
  let store = new SessionNoteStore(path);
  assert.equal(store.addNote(note), true);
  assert.equal(store.claim(topicSessionKey).length, 1);
  // The turn never finished: the claim is interrupted by the restart.
  store.close();

  store = new SessionNoteStore(path);
  context.after(() => store.close());
  assert.deepEqual(store.claim(topicSessionKey), []);
  assert.equal(
    store.addNote(note),
    false,
    "a claim a restart interrupted counts as delivered",
  );
  assert.deepEqual(store.claim(topicSessionKey), []);
});

test("never forgets a delivered identity after many later deliveries", (context) => {
  const store = new SessionNoteStore(fixture(context));
  context.after(() => store.close());

  const first = {
    sessionKey: topicSessionKey,
    text: "Preview publicada.",
    effectKey: "preview:20:confirmed",
  };
  assert.equal(store.addNote(first), true);
  store.deliver(store.claim(topicSessionKey));

  for (let index = 0; index < 120; index += 1) {
    store.addNote({
      sessionKey: topicSessionKey,
      text: `nota ${index}`,
      effectKey: `preview:${index}:confirmed`,
    });
    store.deliver(store.claim(topicSessionKey));
  }

  assert.deepEqual(store.claim(topicSessionKey), []);
  assert.equal(
    store.addNote(first),
    false,
    "a late retry is still the same effect",
  );
  assert.deepEqual(store.claim(topicSessionKey), []);
});

test("keeps the undelivered limit apart from an interrupted claim", (context) => {
  const path = fixture(context);
  const store = new SessionNoteStore(path);
  context.after(() => store.close());
  for (let index = 0; index < noteLimits.perSession; index += 1) {
    store.addNote({
      sessionKey: topicSessionKey,
      text: `nota ${index}`,
    });
  }
  // A claim a turn made and never delivered is newer than these notes. It is
  // not an undelivered note, so it never spends a place of their limit.
  const database = new DatabaseSync(path);
  database
    .prepare(
      `INSERT INTO session_notes
         (session_key, text, effect_key, state, created_at)
       VALUES (?, ?, NULL, 'claimed', ?)`,
    )
    .run(topicSessionKey, "reclamada", "2026-11-18T10:00:00Z");
  database.close();
  store.addNote({ sessionKey: topicSessionKey, text: "nota nova" });

  const claimed = store.claim(topicSessionKey);
  assert.equal(claimed.length, noteLimits.perSession);
  assert.equal(claimed.at(-1).text, "nota nova");
  assert.equal(
    claimed[0].text,
    "nota 1",
    "only the oldest undelivered note is dropped",
  );
});

test("opens a store for reading without recovering an interrupted claim", (context) => {
  const path = fixture(context);
  const first = new SessionNoteStore(path);
  first.addNote({ sessionKey: topicSessionKey, text: "Efecte en curs." });
  first.claim(topicSessionKey);
  first.close();

  const readOnly = new SessionNoteStore(path, { recoverClaimed: false });
  const database = new DatabaseSync(path, { readOnly: true });
  const row = database
    .prepare("SELECT state FROM session_notes WHERE session_key = ?")
    .get(topicSessionKey);
  database.close();
  assert.equal(row.state, "claimed", "opening the store changed nothing");
  // The read-only opener never recovers by itself: a later open still does.
  assert.deepEqual(readOnly.claim(topicSessionKey), []);
  readOnly.close();

  const restarted = new SessionNoteStore(path);
  context.after(() => restarted.close());
  assert.deepEqual(restarted.claim(topicSessionKey), []);
});
