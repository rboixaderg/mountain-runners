import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultExifOrientation,
  readExifOrientation,
} from "./exif-orientation.mjs";
import {
  jpegImage,
  pngChunk,
  pngImage,
} from "./test-support/synthetic-images.mjs";

function tiffWithOrientation(value, { littleEndian = false } = {}) {
  const buffer = Buffer.alloc(26);
  if (littleEndian) {
    buffer.write("II", 0, "ascii");
    buffer.writeUInt16LE(42, 2);
    buffer.writeUInt32LE(8, 4);
    buffer.writeUInt16LE(1, 8);
    buffer.writeUInt16LE(0x0112, 10);
    buffer.writeUInt16LE(3, 12);
    buffer.writeUInt32LE(1, 14);
    buffer.writeUInt16LE(value, 18);
    return buffer;
  }
  buffer.write("MM", 0, "ascii");
  buffer.writeUInt16BE(42, 2);
  buffer.writeUInt32BE(8, 4);
  buffer.writeUInt16BE(1, 8);
  buffer.writeUInt16BE(0x0112, 10);
  buffer.writeUInt16BE(3, 12);
  buffer.writeUInt32BE(1, 14);
  buffer.writeUInt16BE(value, 18);
  return buffer;
}

function tiffWithoutOrientation() {
  const buffer = Buffer.alloc(26);
  buffer.write("MM", 0, "ascii");
  buffer.writeUInt16BE(42, 2);
  buffer.writeUInt32BE(8, 4);
  buffer.writeUInt16BE(1, 8);
  buffer.writeUInt16BE(0x011a, 10);
  buffer.writeUInt16BE(3, 12);
  buffer.writeUInt32BE(1, 14);
  buffer.writeUInt16BE(72, 18);
  return buffer;
}

function jpegWithTiff(tiff) {
  return jpegImage({
    width: 640,
    height: 480,
    metadata: [
      {
        marker: 0xe1,
        data: Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]),
      },
    ],
  });
}

function webpWithExif(tiff) {
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + 8 + payload.length, 4);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write("EXIF", 0, "ascii");
  chunkHeader.writeUInt32LE(payload.length, 4);
  return Buffer.concat([
    header,
    Buffer.from("WEBP", "ascii"),
    chunkHeader,
    payload,
  ]);
}

test("reads every EXIF orientation from a JPEG in both byte orders", () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.equal(
      readExifOrientation(
        jpegWithTiff(tiffWithOrientation(orientation)),
        "jpeg",
      ),
      orientation,
    );
    assert.equal(
      readExifOrientation(
        jpegWithTiff(tiffWithOrientation(orientation, { littleEndian: true })),
        "jpeg",
      ),
      orientation,
    );
  }
});

test("reads the EXIF orientation of a PNG and a WebP", () => {
  const png = pngImage({
    width: 320,
    height: 240,
    metadata: [{ type: "eXIf", data: tiffWithOrientation(6) }],
  });
  assert.equal(readExifOrientation(png, "png"), 6);

  const prefixedPng = pngImage({
    width: 320,
    height: 240,
    metadata: [
      {
        type: "eXIf",
        data: Buffer.concat([
          Buffer.from("Exif\0\0", "latin1"),
          tiffWithOrientation(8),
        ]),
      },
    ],
  });
  assert.equal(readExifOrientation(prefixedPng, "png"), 8);

  assert.equal(
    readExifOrientation(webpWithExif(tiffWithOrientation(3)), "webp"),
    3,
  );
});

test("defaults to the neutral orientation without valid metadata", () => {
  assert.equal(
    readExifOrientation(jpegImage({ width: 100, height: 100 }), "jpeg"),
    defaultExifOrientation,
  );
  assert.equal(
    readExifOrientation(pngImage({ width: 10, height: 10 }), "png"),
    1,
  );
  assert.equal(readExifOrientation(webpWithExif(Buffer.alloc(0)), "webp"), 1);
  assert.equal(
    readExifOrientation(jpegWithTiff(tiffWithoutOrientation()), "jpeg"),
    1,
  );
});

test("ignores an invalid orientation value instead of trusting it", () => {
  for (const value of [0, 9, 0xffff]) {
    assert.equal(
      readExifOrientation(jpegWithTiff(tiffWithOrientation(value)), "jpeg"),
      1,
      `orientation ${value}`,
    );
  }
});

test("never throws on a truncated EXIF header", () => {
  const tiff = tiffWithOrientation(6);
  for (const length of [0, 1, 2, 4, 7, 9, 20]) {
    assert.equal(
      readExifOrientation(jpegWithTiff(tiff.subarray(0, length)), "jpeg"),
      1,
      `truncated at ${length}`,
    );
  }
  const png = pngImage({
    width: 10,
    height: 10,
    metadata: [{ type: "eXIf", data: tiff.subarray(0, 9) }],
  });
  assert.equal(readExifOrientation(png, "png"), 1);
  assert.equal(readExifOrientation(Buffer.alloc(0), "jpeg"), 1);
});

test("skips an XMP APP1 segment and keeps looking for the EXIF one", () => {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1, 0x00, 0x0a]),
    Buffer.from("xmp-data"),
    Buffer.from([0xff, 0xe1, 0x00, 0x22]),
    Buffer.from("Exif\0\0", "latin1"),
    tiffWithOrientation(7),
    Buffer.from([0xff, 0xd9]),
  ]);

  assert.equal(readExifOrientation(bytes, "jpeg"), 7);
});

test("reads the EXIF orientation through marker fill bytes and standalone markers", () => {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    // A restart marker outside a scan and a fill byte before the APP1 marker.
    Buffer.from([0xff, 0xd0]),
    Buffer.from([0xff, 0xff, 0xe1, 0x00, 0x22]),
    Buffer.from("Exif\0\0", "latin1"),
    tiffWithOrientation(6),
    Buffer.from([0xff, 0xd9]),
  ]);

  assert.equal(readExifOrientation(bytes, "jpeg"), 6);
});

test("keeps the PNG chunk walk bounded by the declared length", () => {
  const chunk = pngChunk("eXIf", tiffWithOrientation(6));
  const truncated = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk.subarray(0, 10),
  ]);

  assert.equal(readExifOrientation(truncated, "png"), 1);
});
