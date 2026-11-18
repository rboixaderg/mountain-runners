import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { maximumViewedAttachmentBytes, readAttachmentImage } from "./read.mjs";
import { jpegImage, pngImage } from "./test-support/synthetic-images.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-attachment-read-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return directory;
}

test("returns a stored image as image content", (context) => {
  const directory = fixture(context);
  const bytes = pngImage({ width: 320, height: 240 });
  writeFileSync(join(directory, "imatge-1.png"), bytes);

  const result = readAttachmentImage({
    directory,
    name: "imatge-1.png",
    names: ["imatge-1.png"],
  });

  assert.equal(result.refusal, undefined);
  assert.equal(result.image.mimeType, "image/png");
  assert.equal(result.image.width, 320);
  assert.equal(result.image.height, 240);
  assert.deepEqual(result.image.bytes, bytes);
});

test("refuses a name that the service did not list", (context) => {
  const directory = fixture(context);
  writeFileSync(
    join(directory, "imatge-1.png"),
    pngImage({ width: 10, height: 10 }),
  );

  for (const name of ["imatge-2.png", "../imatge-1.png", "imatge-1.gif"]) {
    const result = readAttachmentImage({
      directory,
      name,
      names: ["imatge-1.png"],
    });
    assert.equal(result.refusal, "unknown_name");
  }
});

test("refuses a symbolic link where the attachment directory belongs", (context) => {
  const parent = fixture(context);
  const directory = join(parent, "linked");
  const outside = fixture(context);
  writeFileSync(
    join(outside, "imatge-1.png"),
    pngImage({ width: 10, height: 10 }),
  );
  symlinkSync(outside, directory, "dir");

  const result = readAttachmentImage({
    directory,
    name: "imatge-1.png",
    names: ["imatge-1.png"],
  });

  assert.equal(result.refusal, "unreadable");
});

test("refuses a symbolic link instead of following it", (context) => {
  const directory = fixture(context);
  const outside = fixture(context);
  const target = join(outside, "secret.png");
  writeFileSync(target, pngImage({ width: 10, height: 10 }));
  symlinkSync(target, join(directory, "imatge-1.png"));

  const result = readAttachmentImage({
    directory,
    name: "imatge-1.png",
    names: ["imatge-1.png"],
  });

  assert.equal(result.refusal, "unreadable");
});

test("refuses a file above the size bound", (context) => {
  const directory = fixture(context);
  writeFileSync(
    join(directory, "imatge-1.jpg"),
    Buffer.alloc(maximumViewedAttachmentBytes + 1, 1),
  );

  const result = readAttachmentImage({
    directory,
    name: "imatge-1.jpg",
    names: ["imatge-1.jpg"],
  });

  assert.equal(result.refusal, "unreadable");
});

test("refuses a file that is not a valid image or still has metadata", (context) => {
  const directory = fixture(context);
  writeFileSync(join(directory, "imatge-1.jpg"), "not an image");
  writeFileSync(
    join(directory, "imatge-2.png"),
    pngImage({
      width: 10,
      height: 10,
      metadata: [{ type: "eXIf", data: Buffer.from("gps") }],
    }),
  );

  assert.equal(
    readAttachmentImage({
      directory,
      name: "imatge-1.jpg",
      names: ["imatge-1.jpg"],
    }).refusal,
    "invalid_image",
  );
  assert.equal(
    readAttachmentImage({
      directory,
      name: "imatge-2.png",
      names: ["imatge-2.png"],
    }).refusal,
    "invalid_image",
  );
});

test("refuses a directory with the listed name", (context) => {
  const directory = fixture(context);
  mkdirSync(join(directory, "imatge-1.jpg"));

  const result = readAttachmentImage({
    directory,
    name: "imatge-1.jpg",
    names: ["imatge-1.jpg"],
  });

  assert.equal(result.refusal, "unreadable");
});

test("keeps the image type of a JPEG", (context) => {
  const directory = fixture(context);
  writeFileSync(
    join(directory, "imatge-3.jpg"),
    jpegImage({ width: 640, height: 480 }),
  );

  const result = readAttachmentImage({
    directory,
    name: "imatge-3.jpg",
    names: ["imatge-3.jpg"],
  });

  assert.equal(result.image.mimeType, "image/jpeg");
  assert.equal(result.image.width, 640);
});
