import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentMegabytes,
  attachmentRefusalReasons,
  imageDocumentRefusal,
  largestPhotoSize,
} from "../../src/telegram/attachments.mjs";

function imageDocument(overrides = {}) {
  return {
    file_id: "telegram-file",
    file_unique_id: "telegram-unique-file",
    file_name: "portada.png",
    mime_type: "image/png",
    file_size: 1200000,
    ...overrides,
  };
}

test("refuses an image document without a usable file identifier", () => {
  for (const fileId of ["", "   "]) {
    assert.deepEqual(imageDocumentRefusal(imageDocument({ file_id: fileId })), {
      reason: attachmentRefusalReasons.invalidPhoto,
    });
  }
  assert.deepEqual(imageDocumentRefusal(imageDocument()), null);
});

test("selects only a photo size with a usable reference and a real area", () => {
  const photo = [
    { file_id: "   ", width: 4096, height: 3072, file_size: 900000 },
    { file_id: "zero-width", width: 0, height: 5000, file_size: 800000 },
    { file_id: "negative", width: -10, height: 5000, file_size: 700000 },
    { file_id: "usable", width: 1280, height: 960, file_size: 200000 },
  ];

  assert.equal(largestPhotoSize(photo)?.file_id, "usable");
  assert.equal(
    largestPhotoSize([{ file_id: "  ", width: 10, height: 10 }]),
    null,
  );
});

test("rounds a size up so a file above the limit never reads as the limit", () => {
  assert.equal(attachmentMegabytes(1024 * 1024), "1,0");
  assert.equal(attachmentMegabytes(20 * 1024 * 1024), "20,0");
  assert.equal(attachmentMegabytes(20 * 1024 * 1024 + 1), "20,1");
});
