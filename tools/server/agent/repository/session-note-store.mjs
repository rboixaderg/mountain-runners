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

import { clipText } from "../policy/development.mjs";
import { runTransaction } from "./sqlite.mjs";
import { openStateDatabase } from "./state-database.mjs";

export const noteLimits = {
  characters: 1500,
  perSession: 20,
};

export class SessionNoteStore {
  #database;
  #now;

  /**
   * `recoverClaimed` is the recovery a restart needs: a claim only lives inside
   * the turn that made it. A read-only caller, such as the operator command that
   * lists the cases, passes `false` and never mutates the store by opening it.
   */
  constructor(path, { now = () => new Date(), recoverClaimed = true } = {}) {
    this.#database = openStateDatabase(path);
    this.#now = now;
    if (recoverClaimed) {
      this.recoverClaimed();
    }
  }

  #transaction(callback) {
    return runTransaction(this.#database, callback);
  }

  /**
   * A restart found a turn that never finished, so its notes must not reach a
   * later turn. Their identities count as delivered before the rows disappear,
   * atomically, so a retried notice never duplicates an effect the model may
   * already have.
   */
  recoverClaimed() {
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
   * Store one service text of the topic.
   *
   * With an `effectKey`, the note is stored at most once per topic: a repeated
   * announcement of the same effect (a retried Telegram notice) neither
   * duplicates nor revives it. Returns whether the note was stored.
   */
  addNote({ sessionKey, text, effectKey = null }) {
    return this.#transaction(() => {
      // A delivered identity is not revived, and the same undelivered or claimed
      // identity never gets a second row.
      if (
        effectKey !== null &&
        this.#effectWasDelivered(sessionKey, effectKey)
      ) {
        return false;
      }
      const stored =
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
      if (stored) {
        // Only the newest undelivered notes of the topic are kept: an old
        // effect the model never received is less useful than the recent one.
        this.#database
          .prepare(
            `DELETE FROM session_notes
             WHERE session_key = ? AND state = 'undelivered'
               AND sequence NOT IN (
                 SELECT sequence FROM session_notes
                 WHERE session_key = ? AND state = 'undelivered'
                 ORDER BY sequence DESC LIMIT ?
               )`,
          )
          .run(sessionKey, sessionKey, noteLimits.perSession);
      }
      return stored;
    });
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
