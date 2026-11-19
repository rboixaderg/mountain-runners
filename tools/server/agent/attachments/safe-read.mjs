// Bounded read of a file the model or the sandbox can change.
//
// The worktree and the container output are untrusted. A symbolic link must
// never be followed, a special file must never block the trusted process and a
// file must never be read without a size bound. The descriptor is opened with
// `O_NONBLOCK` so a FIFO does not wait for a writer, and the size is enforced
// again while reading because the file can grow after `fstat`. This helper is
// dependency free so the Pi profile can copy it next to the `view_attachment`
// reader.

import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

const readChunkBytes = 64 * 1024;

function readBounded(descriptor, maximumBytes) {
  const chunks = [];
  let totalBytes = 0;
  while (totalBytes <= maximumBytes) {
    const chunkBytes = Math.min(readChunkBytes, maximumBytes + 1 - totalBytes);
    const chunk = Buffer.alloc(chunkBytes);
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) {
      return Buffer.concat(chunks, totalBytes);
    }
    chunks.push(chunk.subarray(0, bytesRead));
    totalBytes += bytesRead;
  }
  return null;
}

/** The bytes of a regular file opened without following links, or null. */
export function readRegularFileNoFollow(path, maximumBytes) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maximumBytes) {
      return null;
    }
    return readBounded(descriptor, maximumBytes);
  } catch {
    return null;
  } finally {
    closeSync(descriptor);
  }
}
