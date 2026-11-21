// Private, durable tracking of the preview requests of the deterministic
// handler.
//
// Since the `preview` label the service posts nothing: a request is written
// directly as `awaiting`, in one statement. The `commenting` and `uncertain`
// states remain for the rows written while the service still posted `/preview`,
// whose result was unknown: an interrupted `commenting` row is never posted
// again automatically, and a person resolves it. A request awaiting the trusted
// publisher survives a restart and keeps its deadline.
//
// One Telegram update is one row. A person's request for the same pull request
// and commit is allowed only after the previous one ended. A publication of the
// service follows its own preview in the row of the update that published it,
// and an automatic repair reopens that row for its new commit, as the CI watch
// does.
//
// The origin the trusted publisher confirmed is stored with the request, because
// the model of the topic never builds or guesses a preview URL and cannot read
// GitHub from its sandbox.

import { openDatabase, runTransaction } from "./sqlite.mjs";

const schema = `
  CREATE TABLE IF NOT EXISTS preview_requests (
    update_identifier INTEGER PRIMARY KEY,
    session_key TEXT NOT NULL,
    author_identifier INTEGER NOT NULL,
    pull_request_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('commenting', 'awaiting', 'confirmed', 'timed_out', 'failed', 'uncertain')),
    commented_at TEXT,
    confirmed_origin TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS preview_requests_pull_request
    ON preview_requests (session_key, pull_request_number);
  CREATE INDEX IF NOT EXISTS preview_requests_state_commented
    ON preview_requests (state, commented_at);
`;

/**
 * A store created before the confirmed origin was kept gets the column added. It
 * is null for every request that ended before, and a confirmed request without
 * it simply reports no URL.
 */
function ensureConfirmedOriginColumn(database) {
  const columns = database.prepare("PRAGMA table_info(preview_requests)").all();
  if (columns.some((column) => column.name === "confirmed_origin")) {
    return;
  }
  database.exec(
    "ALTER TABLE preview_requests ADD COLUMN confirmed_origin TEXT",
  );
}

export const previewStates = {
  commenting: "commenting",
  awaiting: "awaiting",
  confirmed: "confirmed",
  timedOut: "timed_out",
  failed: "failed",
  uncertain: "uncertain",
};

export const previewBeginResults = {
  begun: "begun",
  duplicate: "duplicate",
  open: "open",
};

// The states a request can end in. A confirmed end also carries the origin the
// trusted publisher confirmed.
const terminalStates = new Set([
  previewStates.confirmed,
  previewStates.timedOut,
  previewStates.failed,
]);

// A request that has not ended: it blocks a new one for the same commit.
const openStates = [
  previewStates.commenting,
  previewStates.awaiting,
  previewStates.uncertain,
];

export class PreviewRequestStore {
  #database;
  #now;

  constructor(path, { now = () => new Date() } = {}) {
    this.#database = openDatabase(path);
    this.#database.exec(schema);
    ensureConfirmedOriginColumn(this.#database);
    this.#now = now;
  }

  #transaction(callback) {
    return runTransaction(this.#database, callback);
  }

  /**
   * Record a person's request, already awaiting the publisher. Returns
   * `duplicate` for an update already handled and `open` while another request
   * for the same pull request and commit has not ended; otherwise `begun`.
   */
  begin({
    updateIdentifier,
    sessionKey,
    authorIdentifier,
    pullRequestNumber,
    commitSha,
  }) {
    return this.#transaction(() => {
      const duplicate = this.#database
        .prepare("SELECT 1 FROM preview_requests WHERE update_identifier = ?")
        .get(updateIdentifier);
      if (duplicate) {
        return previewBeginResults.duplicate;
      }
      const open = this.#database
        .prepare(
          `SELECT 1 FROM preview_requests
           WHERE pull_request_number = ? AND commit_sha = ?
             AND state IN (${openStates.map(() => "?").join(", ")})`,
        )
        .get(pullRequestNumber, commitSha, ...openStates);
      if (open) {
        return previewBeginResults.open;
      }
      const timestamp = this.#now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO preview_requests
           (update_identifier, session_key, author_identifier, pull_request_number, commit_sha, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'awaiting', ?, ?)`,
        )
        .run(
          updateIdentifier,
          sessionKey,
          authorIdentifier,
          pullRequestNumber,
          commitSha,
          timestamp,
          timestamp,
        );
      return previewBeginResults.begun;
    });
  }

  /**
   * Follow the preview of a commit the service just published. The row of the
   * publishing update is written again for this commit, so a later publication
   * of the same update replaces whatever that row waited for or reported.
   */
  track({
    updateIdentifier,
    sessionKey,
    authorIdentifier,
    pullRequestNumber,
    commitSha,
  }) {
    const timestamp = this.#now().toISOString();
    this.#database
      .prepare(
        `INSERT INTO preview_requests
         (update_identifier, session_key, author_identifier, pull_request_number, commit_sha, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'awaiting', ?, ?)
         ON CONFLICT (update_identifier) DO UPDATE SET
           session_key = excluded.session_key,
           author_identifier = excluded.author_identifier,
           pull_request_number = excluded.pull_request_number,
           commit_sha = excluded.commit_sha,
           state = 'awaiting',
           commented_at = NULL,
           confirmed_origin = NULL,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        updateIdentifier,
        sessionKey,
        authorIdentifier,
        pullRequestNumber,
        commitSha,
        timestamp,
        timestamp,
      );
  }

  /**
   * An automatic repair has no author of its own: it follows the preview of its
   * new commit in the row of the publication it continues, if there is one.
   */
  reopen({ updateIdentifier, pullRequestNumber, commitSha }) {
    const timestamp = this.#now().toISOString();
    return (
      this.#database
        .prepare(
          `UPDATE preview_requests
           SET commit_sha = ?, state = 'awaiting', commented_at = NULL,
               confirmed_origin = NULL, created_at = ?, updated_at = ?
           WHERE update_identifier = ? AND pull_request_number = ?`,
        )
        .run(
          commitSha,
          timestamp,
          timestamp,
          updateIdentifier,
          pullRequestNumber,
        ).changes === 1
    );
  }

  #transition(updateIdentifier, fromState, toState, origin = null) {
    return (
      this.#database
        .prepare(
          `UPDATE preview_requests
           SET state = ?, confirmed_origin = COALESCE(?, confirmed_origin), updated_at = ?
           WHERE update_identifier = ? AND state = ?`,
        )
        .run(
          toState,
          origin,
          this.#now().toISOString(),
          updateIdentifier,
          fromState,
        ).changes === 1
    );
  }

  /**
   * End an awaiting request. The confirmed origin is written with the state, in
   * one statement: a confirmation never ends without the URL the publisher
   * confirmed, and `updated_at` becomes the moment the request ended. A second
   * claim never succeeds. Only a terminal state can end a request, because the
   * row of an ended request is never described by a state it cannot reach.
   */
  finish(updateIdentifier, state, origin = null) {
    if (!terminalStates.has(state)) {
      throw new Error(`Invalid preview end state ${state}.`);
    }
    if (state === previewStates.confirmed && origin === null) {
      throw new Error("A confirmed preview requires the origin it confirmed.");
    }
    // Only a confirmed request keeps an origin: a request that ended another way
    // never leaves a URL behind.
    const confirmedOrigin = state === previewStates.confirmed ? origin : null;
    return this.#transition(
      updateIdentifier,
      previewStates.awaiting,
      state,
      confirmedOrigin,
    );
  }

  awaiting() {
    return this.#database
      .prepare(
        "SELECT * FROM preview_requests WHERE state = 'awaiting' ORDER BY update_identifier",
      )
      .all();
  }

  /** Requests whose post may or may not have happened, oldest first. */
  uncertain() {
    return this.#database
      .prepare(
        `SELECT update_identifier, session_key, pull_request_number, commit_sha,
                created_at
         FROM preview_requests WHERE state = 'uncertain'
         ORDER BY update_identifier`,
      )
      .all();
  }

  /**
   * A person read GitHub and the `/preview` comment exists: the request waits
   * for the publisher as if the post had been confirmed. The deadline restarts
   * now, because the confirmation is read from this moment on, while the comment
   * keeps the moment of the request: that is the instant a workflow run of this
   * request is attributed from. The guarded update refuses a case that is no
   * longer uncertain.
   */
  resolveUncertainCommented(updateIdentifier, commentedAt = null) {
    return this.#resolveUncertain(
      updateIdentifier,
      previewStates.awaiting,
      commentedAt,
    );
  }

  /**
   * A person read GitHub and the `/preview` comment does not exist: nothing was
   * posted and the request ends as failed. The guarded update refuses a case
   * that is no longer uncertain.
   */
  resolveUncertainNotCommented(updateIdentifier) {
    return this.#resolveUncertain(updateIdentifier, previewStates.failed, null);
  }

  #resolveUncertain(updateIdentifier, state, explicitCommentedAt) {
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT created_at FROM preview_requests
           WHERE update_identifier = ? AND state = 'uncertain'`,
        )
        .get(updateIdentifier);
      if (row === undefined) {
        return null;
      }
      const timestamp = this.#now().toISOString();
      // The comment was posted around the moment the request began. Keeping
      // that moment, instead of the later confirmation, is what puts the run of
      // this request inside its own attribution window.
      const commentedAt =
        state === previewStates.awaiting
          ? (explicitCommentedAt ?? row.created_at)
          : null;
      this.#database
        .prepare(
          `UPDATE preview_requests
           SET state = ?, commented_at = COALESCE(?, commented_at), updated_at = ?
           WHERE update_identifier = ? AND state = 'uncertain'`,
        )
        .run(state, commentedAt, timestamp, updateIdentifier);
      return this.#database
        .prepare(
          `SELECT update_identifier, session_key, pull_request_number, commit_sha,
                  created_at
           FROM preview_requests WHERE update_identifier = ?`,
        )
        .get(updateIdentifier);
    });
  }

  state(updateIdentifier) {
    return this.#database
      .prepare("SELECT state FROM preview_requests WHERE update_identifier = ?")
      .get(updateIdentifier)?.state;
  }

  /**
   * A restarted process cannot know whether an interrupted post arrived. Mark
   * every interrupted request uncertain and return them for the private trace.
   */
  recoverCommenting() {
    return this.#transaction(() => {
      const interrupted = this.#database
        .prepare(
          `SELECT update_identifier, session_key, author_identifier, pull_request_number, commit_sha
           FROM preview_requests WHERE state = 'commenting' ORDER BY update_identifier`,
        )
        .all();
      this.#database
        .prepare(
          `UPDATE preview_requests SET state = 'uncertain', updated_at = ?
           WHERE state = 'commenting'`,
        )
        .run(this.#now().toISOString());
      return interrupted;
    });
  }

  /** Requests whose external result is unknown, including earlier restarts. */
  uncertainCount() {
    return this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM preview_requests WHERE state = 'uncertain'",
      )
      .get().count;
  }

  close() {
    this.#database.close();
  }
}
