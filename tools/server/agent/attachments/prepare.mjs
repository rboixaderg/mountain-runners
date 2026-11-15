// Service preparation of an admitted attachment (T8.4).
//
// The download happens when the instruction runs, never at admission. The raw
// bytes only exist in the service temporary directory and are removed in a
// `finally`; the cleaned file is the only copy that reaches the worktree. A
// failure is a refusal with a reason, never an exception that hides the
// instruction result.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  maximumAttachmentBytes,
  TelegramFileTooLargeError,
} from "telegram-pi-bridge/telegram";
import { requestSignal } from "../repository/request-signal.mjs";
import { attachmentFileName, writeAttachmentFile } from "./destination.mjs";
import { prepareImageAttachment } from "./image-file.mjs";
import { attachmentRefusalReasons } from "./refusals.mjs";

export function createAttachmentPreparation({
  telegram,
  temporaryDirectory = tmpdir(),
  logger = () => {},
}) {
  return async function prepareAttachment({
    attachment,
    worktreePath,
    signal,
  }) {
    let directory = null;
    // A stalled read must not hold the instruction loop behind it; the same
    // deadline bounds the lookup and the download.
    const downloadSignal = requestSignal(signal);
    try {
      directory = mkdtempSync(join(temporaryDirectory, "attachment-"));
      const file = await telegram.getFile({
        fileIdentifier: attachment.fileIdentifier,
        signal: downloadSignal,
      });
      if (typeof file?.file_path !== "string" || file.file_path === "") {
        return {
          refusal: { reason: attachmentRefusalReasons.downloadFailed },
        };
      }
      const downloaded = await telegram.downloadFile({
        filePath: file.file_path,
        maximumBytes: maximumAttachmentBytes,
        signal: downloadSignal,
      });
      const rawPath = join(directory, "raw");
      writeFileSync(rawPath, downloaded, { mode: 0o600 });
      const prepared = prepareImageAttachment({
        bytes: readFileSync(rawPath),
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
      });
      if (prepared.refusal) {
        return prepared;
      }
      const fileName = attachmentFileName({
        fileName: attachment.fileName,
        extension: prepared.image.extension,
      });
      const written = writeAttachmentFile({
        worktreePath,
        fileName,
        bytes: prepared.image.bytes,
      });
      if (written.refusal) {
        return written;
      }
      return {
        prepared: {
          relativePath: written.relativePath,
          type: prepared.image.type,
          mimeType: prepared.image.mimeType,
          width: prepared.image.width,
          height: prepared.image.height,
          bytes: prepared.image.bytes.length,
        },
      };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      // The limit was discovered while downloading, so the person gets the same
      // size explanation as a declared oversized file.
      if (error instanceof TelegramFileTooLargeError) {
        return {
          refusal: {
            reason: attachmentRefusalReasons.tooLarge,
            bytes: error.bytes,
          },
        };
      }
      logger(
        "attachment_preparation_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return { refusal: { reason: attachmentRefusalReasons.downloadFailed } };
    } finally {
      if (directory !== null) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  };
}
