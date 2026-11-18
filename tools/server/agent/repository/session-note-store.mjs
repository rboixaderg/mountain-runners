// Private, durable conversation state of a topic (T8.7).
//
// A topic has one Pi session, and Pi keeps the conversation between turns. The
// effects the service decides on its own (a pull request, the local checks, the
// CI, a preview, a merge, a refused attachment) are reported to the topic but
// never reach that session, so the next turn of the model does not know them.
// Each of those texts is stored here before it is sent, and the next turn of the
// same topic receives it once as service text.
//
// A note is bounded, and a topic keeps only the newest undelivered notes. The
// claim marks the notes a turn is about to receive: it happens at the one point
// where Pi is invoked, so a claim that a crash interrupted is never delivered
// again, because the model turn it belonged to either happened or was lost. Only
// a confirmed launch failure, when no prompt reached Pi, returns a claim.
//
// An effect may be announced more than once: ADR 0014 lets the service repeat a
// Telegram notice. `effectKey` gives such an effect a durable identity, so the
// session receives it once. Delivered identities are kept without pruning: a
// retried notice can arrive at any later start, and the table only holds one
// short key per delivered effect. A claim interrupted by a restart counts as
// delivered: its identity is remembered before the row is removed.
//
// Only text the service wrote is stored: the model's own words already live in
// its session, and a note is presented to the model as trusted service data.
//
// The last text the topic received (the model's answer or a service report) is
// stored per topic and overwritten every time: the classifier reads it as data,
// never as history.

import { DatabaseSync } from "node:sqlite";
import { clipText } from "../policy/development.mjs";

export const noteLimits = {
  characters: 1500,
  perSession: 20,
  lastReplyCharacters: 800,
};

const schema = `
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
  CREATE TABLE IF NOT EXISTS session_context (
    session_key TEXT PRIMARY KEY,
    last_reply TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export class SessionNoteStore {
  #database;
  #now;

  constructor(path, { now = () => new Date() } = {}) {
    this.#database = new DatabaseSync(path);
    this.#database.exec(schema);
    this.#now = now;
    // A claim only lives inside the turn that made it: a restart found a turn
    // that never finished, so its notes must not reach a later turn. Their
    // identities count as delivered before the rows disappear, atomically, so a
    // retried notice never duplicates an effect the model may already have.
    const remember = this.#database.prepare(
      `INSERT INTO session_delivered_effects
         (session_key, effect_key, delivered_at)
       VALUES (?, ?, ?)
       ON CONFLICT (session_key, effect_key) DO NOTHING`,
    );
    this.#transaction(() => {
      const timestamp = this.#now().toISOString();
      const claimed = this.#database
        .prepare(
          `SELECT session_key, effect_key FROM session_notes
           WHERE state = 'claimed' AND effect_key IS NOT NULL`,
        )
        .all();
      for (const note of claimed) {
        remember.run(note.session_key, note.effect_key, timestamp);
      }
      this.#database
        .prepare("DELETE FROM session_notes WHERE state = 'claimed'")
        .run();
    });
  }

  #transaction(callback) {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #recordLastReply(sessionKey, text) {
    this.#database
      .prepare(
        `INSERT INTO session_context (session_key, last_reply, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (session_key) DO UPDATE
           SET last_reply = excluded.last_reply, updated_at = excluded.updated_at`,
      )
      .run(
        sessionKey,
        clipText(text, noteLimits.lastReplyCharacters),
        this.#now().toISOString(),
      );
  }

  #effectWasDelivered(sessionKey, effectKey) {
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM session_delivered_effects
           WHERE session_key = ? AND effect_key = ?`,
        )
        .get(sessionKey, effectKey) !== undefined
    );
  }

  /**
   * Store one service text of the topic. It is also the last text the topic
   * received, so the classifier can read it.
   *
   * With an `effectKey`, the note is stored at most once per topic: a repeated
   * announcement of the same effect (a retried Telegram notice) neither
   * duplicates nor revives it. Returns whether the note was stored.
   *
   * `receivedText` is the full text the topic received when `text` is only its
   * service-written part: a report may embed the model's own words, which are
   * never a note. The last text of the topic keeps everything.
   */
  addNote({ sessionKey, text, effectKey = null, receivedText = text }) {
    return this.#transaction(() => {
      let stored = false;
      // A delivered identity is not revived, and the same undelivered or claimed
      // identity never gets a second row.
      if (
        effectKey === null ||
        !this.#effectWasDelivered(sessionKey, effectKey)
      ) {
        stored =
          this.#database
            .prepare(
              `INSERT INTO session_notes
                 (session_key, text, effect_key, state, created_at)
               VALUES (?, ?, ?, 'undelivered', ?)
               ON CONFLICT (session_key, effect_key) DO NOTHING`,
            )
            .run(
              sessionKey,
              clipText(text, noteLimits.characters),
              effectKey,
              this.#now().toISOString(),
            ).changes === 1;
      }
      if (stored) {
        // Only the newest undelivered notes of the topic are kept: an old
        // effect the model never received is less useful than the recent one.
        this.#database
          .prepare(
            `DELETE FROM session_notes
             WHERE session_key = ? AND state = 'undelivered'
               AND sequence NOT IN (
                 SELECT sequence FROM session_notes
                 WHERE session_key = ? ORDER BY sequence DESC LIMIT ?
               )`,
          )
          .run(sessionKey, sessionKey, noteLimits.perSession);
      }
      // The text reached the topic even when it is not a new note.
      this.#recordLastReply(sessionKey, receivedText);
      return stored;
    });
  }

  /** Store the model's own answer: it is never replayed as a service note. */
  recordReply({ sessionKey, text }) {
    this.#transaction(() => this.#recordLastReply(sessionKey, text));
  }

  /** The last text the topic received, or null when it received none. */
  lastReply(sessionKey) {
    return (
      this.#database
        .prepare("SELECT last_reply FROM session_context WHERE session_key = ?")
        .get(sessionKey)?.last_reply ?? null
    );
  }

  /**
   * Take the undelivered notes of the topic, oldest first, for one turn. The
   * caller delivers them once: a claim is never returned, because it is made
   * immediately before Pi receives the prompt.
   */
  claim(sessionKey) {
    return this.#transaction(() => {
      const claimed = this.#database
        .prepare(
          `SELECT sequence, text FROM session_notes
           WHERE session_key = ? AND state = 'undelivered'
           ORDER BY sequence`,
        )
        .all(sessionKey);
      const mark = this.#database.prepare(
        "UPDATE session_notes SET state = 'claimed' WHERE sequence = ? AND state = 'undelivered'",
      );
      for (const note of claimed) {
        mark.run(note.sequence);
      }
      return claimed.map((note) => ({
        sequence: note.sequence,
        text: note.text,
      }));
    });
  }

  /**
   * Pi never started, so the prompt never reached it: the notes are undelivered
   * again. Nothing else returns a claim, because any other failure may already
   * have delivered it.
   */
  release(notes) {
    if (notes.length === 0) {
      return;
    }
    const mark = this.#database.prepare(
      "UPDATE session_notes SET state = 'undelivered' WHERE sequence = ? AND state = 'claimed'",
    );
    this.#transaction(() => {
      for (const note of notes) {
        mark.run(note.sequence);
      }
    });
  }

  /** The turn started: the notes reached the model and are never repeated. */
  deliver(notes) {
    if (notes.length === 0) {
      return;
    }
    const read = this.#database.prepare(
      "SELECT session_key, effect_key FROM session_notes WHERE sequence = ?",
    );
    const remember = this.#database.prepare(
      `INSERT INTO session_delivered_effects
         (session_key, effect_key, delivered_at)
       VALUES (?, ?, ?)
       ON CONFLICT (session_key, effect_key) DO NOTHING`,
    );
    const remove = this.#database.prepare(
      "DELETE FROM session_notes WHERE sequence = ?",
    );
    this.#transaction(() => {
      const timestamp = this.#now().toISOString();
      for (const note of notes) {
        const row = read.get(note.sequence);
        if (row?.effect_key != null) {
          remember.run(row.session_key, row.effect_key, timestamp);
        }
        remove.run(note.sequence);
      }
    });
  }

  close() {
    this.#database.close();
  }
}
