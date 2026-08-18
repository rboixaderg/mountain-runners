// Incoming upload path for the deploy SSH identity (phase 5, task 5.4).
//
// The forced command cannot run scp/sftp (`restrict`), so the gate writes the
// request body to incoming/ itself. The daemon is not involved: it only reads
// those files later during `install`. The write is bounded, hashed, and
// renamed into place so a failed upload never becomes the install input.

import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { approvedLimits } from "./config.mjs";
import { incomingPath } from "./validate.mjs";

export async function receiveIncomingFile({
  fileName,
  stdin,
  maxBytes = approvedLimits.maxArchiveBytes,
}) {
  const destination = incomingPath(fileName);
  const temporaryPath = `${destination}.${process.pid}.${randomBytes(8).toString("hex")}.partial`;
  const hash = createHash("sha256");
  let receivedBytes = 0;

  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      void encoding;
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        callback(
          new Error(
            `Upload exceeds the input limit: ${receivedBytes} bytes > ${maxBytes} bytes.`,
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      stdin,
      limiter,
      createWriteStream(temporaryPath, { mode: 0o640 }),
    );
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  if (receivedBytes === 0) {
    await unlink(temporaryPath).catch(() => {});
    throw new Error("Refusing to store an empty upload.");
  }

  await rename(temporaryPath, destination);
  return {
    fileName,
    sha256: hash.digest("hex"),
    bytes: receivedBytes,
  };
}

export function formatReceiveMessage(result) {
  return `Received ${result.fileName} sha256:${result.sha256} bytes:${result.bytes}`;
}
