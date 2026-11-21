// Test-only seeding of preview requests the current service can no longer
// write. Since the `preview` label, a request is stored directly as awaiting;
// a row written while the service still posted `/preview` may remain
// `commenting` or `uncertain` after a restart, and the tests reproduce it with
// a raw insert.

import { DatabaseSync } from "node:sqlite";

/**
 * Insert one legacy request in `state` into a store whose schema already
 * exists (a `PreviewRequestStore` was opened on the same path).
 */
export function seedLegacyPreviewRequest(
  databasePath,
  {
    state,
    updateIdentifier,
    sessionKey,
    authorIdentifier,
    pullRequestNumber,
    commitSha,
    createdAt,
  },
) {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO preview_requests
         (update_identifier, session_key, author_identifier, pull_request_number, commit_sha, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        updateIdentifier,
        sessionKey,
        authorIdentifier,
        pullRequestNumber,
        commitSha,
        state,
        createdAt,
        createdAt,
      );
  } finally {
    database.close();
  }
}

/** A legacy request whose `/preview` post may or may not have happened. */
export function seedUncertainPreviewRequest(databasePath, request) {
  seedLegacyPreviewRequest(databasePath, { ...request, state: "uncertain" });
}
