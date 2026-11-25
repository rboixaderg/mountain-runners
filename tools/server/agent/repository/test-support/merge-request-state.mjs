// Test-only reads of the merge requests, straight from their SQLite file.
import { DatabaseSync } from "node:sqlite";
import { MergeRequestStore } from "../merge-request-store.mjs";

export function mergeRequestState(path, updateIdentifier) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database
      .prepare("SELECT state FROM merge_requests WHERE update_identifier = ?")
      .get(updateIdentifier)?.state;
  } finally {
    database.close();
  }
}

export class InspectableMergeRequestStore extends MergeRequestStore {
  #path;

  constructor(path, options) {
    super(path, options);
    this.#path = path;
  }

  state(updateIdentifier) {
    return mergeRequestState(this.#path, updateIdentifier);
  }
}
