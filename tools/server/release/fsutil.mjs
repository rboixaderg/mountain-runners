// Bounded, non-blocking reads for untrusted uploads (phase 5, task 5.3).

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

// Reads an upload with a hard bound and a regular-file check on the SAME open
// descriptor: a FIFO or device placed in incoming/ cannot block or exhaust the
// daemon (O_NONBLOCK keeps the open from hanging), and the file cannot be
// swapped between the check and the read.
export function readFileBounded(path, maxBytes) {
  const descriptor = openSync(
    path,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new Error(`Refusing to read ${path}: it is not a regular file.`);
    }
    if (stats.size > maxBytes) {
      throw new Error(
        `Upload exceeds the input limit: ${stats.size} bytes > ${maxBytes} bytes.`,
      );
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
