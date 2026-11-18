// Bounded read of a file the model or the sandbox can change.
//
// The worktree and the container output are untrusted. A symbolic link must
// never be followed and a file must never be read without a size bound. This
// helper is dependency free so the Pi profile can copy it next to the
// `view_attachment` reader.

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

/** The bytes of a regular file opened without following links, or null. */
export function readRegularFileNoFollow(path, maximumBytes) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maximumBytes) {
      return null;
    }
    return readFileSync(descriptor);
  } catch {
    return null;
  } finally {
    closeSync(descriptor);
  }
}
