import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  TelegramApi,
  maximumAttachmentBytes,
} from "telegram-pi-bridge/telegram";
import { attachmentRefusalReport } from "../policy/development.mjs";
import { createAttachmentPreparation } from "./prepare.mjs";
import { jpegImage, pngImage } from "./test-support/synthetic-images.mjs";

function attachment(overrides = {}) {
  return {
    fileIdentifier: "telegram-file",
    fileUniqueIdentifier: "telegram-unique-file",
    fileName: "portada.png",
    mimeType: "image/png",
    fileSize: null,
    origin: "message",
    ...overrides,
  };
}

function context(
  testContext,
  { bytes = pngImage({ width: 200, height: 100 }) } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "mr-attachment-preparation-"));
  testContext.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const temporaryDirectory = join(directory, "tmp");
  mkdirSync(temporaryDirectory);
  const worktreePath = join(directory, "worktree");
  mkdirSync(worktreePath);
  const telegram = {
    downloads: [],
    async getFile({ fileIdentifier }) {
      return { file_id: fileIdentifier, file_path: "documents/file_1.png" };
    },
    async downloadFile(options) {
      this.downloads.push(options);
      return bytes;
    },
  };
  const events = [];
  return {
    directory,
    temporaryDirectory,
    worktreePath,
    telegram,
    events,
    prepareAttachment: createAttachmentPreparation({
      telegram,
      logger: (event) => events.push(event),
    }),
  };
}

test("downloads and cleans the attachment without writing it to the worktree", async (context_) => {
  const {
    prepareAttachment,
    worktreePath,
    telegram,
    temporaryDirectory,
    events,
  } = context(context_);
  const original = pngImage({ width: 200, height: 100 });

  const result = await prepareAttachment({
    attachment: attachment(),
  });

  assert.equal(result.refusal, undefined);
  assert.deepEqual(result.image, {
    type: "png",
    mimeType: "image/png",
    extension: ".png",
    width: 200,
    height: 100,
    orientation: 1,
    bytes: original,
    origin: "message",
  });
  assert.equal(
    existsSync(join(worktreePath, ".agent-attachments")),
    false,
    "the trusted preparation never writes the image to the worktree",
  );
  assert.equal(telegram.downloads.length, 1);
  // The caller of the bridge chooses the limit; the download is bounded anyway.
  assert.ok(Number.isSafeInteger(telegram.downloads[0].maximumBytes));
  assert.deepEqual(readdirSync(temporaryDirectory), []);
  assert.deepEqual(events, []);
});

test("refuses an unsupported document without writing anything", async (context_) => {
  const { prepareAttachment, worktreePath, temporaryDirectory } = context(
    context_,
    { bytes: Buffer.from("%PDF-1.7 synthetic document") },
  );

  const result = await prepareAttachment({
    attachment: attachment({
      fileName: "informe.pdf",
      mimeType: "application/pdf",
    }),
    worktreePath,
  });

  assert.equal(result.refusal.reason, "unsupported_type");
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
  assert.deepEqual(readdirSync(temporaryDirectory), []);
});

test("refuses a fake type when the extension does not match the bytes", async (context_) => {
  const { prepareAttachment, worktreePath } = context(context_, {
    bytes: jpegImage({ width: 120, height: 80 }),
  });

  const result = await prepareAttachment({
    attachment: attachment(),
    worktreePath,
  });

  assert.equal(result.refusal.reason, "fake_type");
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
});

test("refuses a download without a file path and removes its temporary directory", async (context_) => {
  const { prepareAttachment, worktreePath, telegram, temporaryDirectory } =
    context(context_);
  telegram.getFile = async () => ({ file_id: "telegram-file" });

  const result = await prepareAttachment({
    attachment: attachment(),
    worktreePath,
  });

  assert.equal(result.refusal.reason, "download_failed");
  assert.deepEqual(readdirSync(temporaryDirectory), []);
});

test("reports a failed download without throwing", async (context_) => {
  const { prepareAttachment, worktreePath, telegram, events } =
    context(context_);
  telegram.getFile = async () => {
    throw new Error("network error");
  };

  const result = await prepareAttachment({
    attachment: attachment(),
    worktreePath,
  });

  assert.equal(result.refusal.reason, "download_failed");
  assert.deepEqual(events, ["attachment_preparation_failed"]);
});

test("refuses an undeclared oversized download with the real size", async (context_) => {
  const { worktreePath, temporaryDirectory } = context(context_);
  const oversized = maximumAttachmentBytes + 1;
  const downloadApi = new TelegramApi({
    botToken: "123:synthetic-token",
    baseUrl: "http://telegram.test",
    fetchImpl: async (url) => {
      if (url.endsWith("/getFile")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { file_id: "telegram-file", file_path: "documents/file" },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response(Buffer.alloc(oversized, 1));
    },
  });
  const prepareThroughApi = createAttachmentPreparation({
    telegram: downloadApi,
  });

  const result = await prepareThroughApi({
    attachment: attachment({ fileSize: null }),
  });

  assert.equal(result.refusal.reason, "too_large");
  assert.equal(result.refusal.bytes, oversized);
  assert.match(attachmentRefusalReport(result.refusal), /20 MB/u);
  assert.deepEqual(readdirSync(temporaryDirectory), []);
  assert.equal(existsSync(join(worktreePath, ".agent-attachments")), false);
});
