import assert from "node:assert/strict";
import { test } from "node:test";
import { maximumAttachmentBytes } from "telegram-pi-bridge/telegram";
import {
  maximumAttachmentLongSide,
  prepareImageAttachment,
} from "./image-file.mjs";
import {
  jpegImage,
  jpegProgressiveImage,
  pngChunk,
  pngImage,
  pngSignature,
  webpCanvasOnlyImage,
  webpExtendedImage,
  webpLosslessImage,
  webpLossyImage,
} from "./test-support/synthetic-images.mjs";

function accept({ bytes, fileName, mimeType }) {
  const result = prepareImageAttachment({ bytes, fileName, mimeType });
  assert.equal(result.refusal, undefined);
  return result.image;
}

function refusal({ bytes, fileName, mimeType }) {
  const result = prepareImageAttachment({ bytes, fileName, mimeType });
  assert.equal(result.image, undefined);
  return result.refusal;
}

test("accepts a JPEG, a PNG and both WebP encodings with their dimensions", () => {
  const cases = [
    {
      bytes: jpegImage({ width: 1200, height: 800 }),
      fileName: "portada.jpg",
      mimeType: "image/jpeg",
      type: "jpeg",
      extension: ".jpg",
      width: 1200,
      height: 800,
    },
    {
      bytes: jpegImage({ width: 640, height: 480 }),
      fileName: "portada.jpeg",
      mimeType: "image/jpeg",
      type: "jpeg",
      extension: ".jpg",
      width: 640,
      height: 480,
    },
    {
      bytes: pngImage({ width: 800, height: 600 }),
      fileName: "portada.png",
      mimeType: "image/png",
      type: "png",
      extension: ".png",
      width: 800,
      height: 600,
    },
    {
      bytes: webpLossyImage({ width: 640, height: 480 }),
      fileName: "foto.webp",
      mimeType: "image/webp",
      type: "webp",
      extension: ".webp",
      width: 640,
      height: 480,
    },
    {
      bytes: webpLosslessImage({ width: 1024, height: 768 }),
      fileName: "foto.webp",
      mimeType: "image/webp",
      type: "webp",
      extension: ".webp",
      width: 1024,
      height: 768,
    },
    {
      bytes: webpExtendedImage({ width: 1500, height: 900 }),
      fileName: "foto.webp",
      mimeType: "image/webp",
      type: "webp",
      extension: ".webp",
      width: 1500,
      height: 900,
    },
  ];

  for (const testCase of cases) {
    const image = accept(testCase);
    assert.equal(image.type, testCase.type);
    assert.equal(image.extension, testCase.extension);
    assert.equal(image.mimeType, testCase.mimeType);
    assert.equal(image.width, testCase.width);
    assert.equal(image.height, testCase.height);
  }
});

test("refuses bytes that are not an accepted image", () => {
  const result = refusal({
    bytes: Buffer.from("%PDF-1.7 synthetic document"),
    fileName: "informe.pdf",
    mimeType: "application/pdf",
  });

  assert.equal(result.reason, "unsupported_type");
});

test("refuses a fake type when the bytes do not match the declared name", () => {
  const bytes = pngImage({ width: 100, height: 100 });

  assert.equal(
    refusal({ bytes, fileName: "portada.jpg", mimeType: "image/jpeg" }).reason,
    "fake_type",
  );
  assert.equal(
    refusal({ bytes, fileName: "portada.png", mimeType: "image/jpeg" }).reason,
    "fake_type",
  );
  assert.equal(
    refusal({ bytes, fileName: "portada", mimeType: "image/png" }).reason,
    "fake_type",
  );
});

test("refuses a truncated or corrupt header", () => {
  const png = pngImage({ width: 100, height: 100 });
  const jpeg = jpegImage({ width: 100, height: 100 });
  const webp = Buffer.from(webpLossyImage({ width: 100, height: 100 }));
  webp.writeUInt32LE(webp.length + 40, 4);

  for (const [bytes, fileName, mimeType] of [
    [png.subarray(0, 24), "portada.png", "image/png"],
    [jpeg.subarray(0, jpeg.length - 6), "portada.jpg", "image/jpeg"],
    [webp, "foto.webp", "image/webp"],
  ]) {
    const result = refusal({ bytes, fileName, mimeType });
    assert.equal(result.reason, "damaged_image");
  }
});

test("refuses an image above the byte limit before parsing it", () => {
  const bytes = Buffer.concat([
    pngSignature(),
    Buffer.alloc(maximumAttachmentBytes),
  ]);

  const result = refusal({
    bytes,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.equal(result.reason, "too_large");
  assert.equal(result.bytes, bytes.length);
});

test("accepts an image above the long side because the sandbox downscales it", () => {
  for (const [width, height] of [
    [maximumAttachmentLongSide + 1, 10],
    [10, maximumAttachmentLongSide + 1],
  ]) {
    const image = accept({
      bytes: pngImage({ width, height }),
      fileName: "portada.png",
      mimeType: "image/png",
    });

    assert.equal(image.width, width);
    assert.equal(image.height, height);
  }
});

test("accepts a file exactly at both limits", () => {
  const base = pngImage({
    width: maximumAttachmentLongSide,
    height: maximumAttachmentLongSide,
  });
  const bytes = pngImage({
    width: maximumAttachmentLongSide,
    height: maximumAttachmentLongSide,
    filler: maximumAttachmentBytes - base.length - 12,
  });
  assert.equal(bytes.length, maximumAttachmentBytes);

  const image = accept({
    bytes,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.equal(image.width, maximumAttachmentLongSide);
  assert.equal(image.height, maximumAttachmentLongSide);
});

test("removes JPEG metadata and keeps the image data byte for byte", () => {
  const metadata = [
    {
      marker: 0xe1,
      data: Buffer.concat([
        Buffer.from("Exif\0\0", "latin1"),
        Buffer.from("GPS 41.4 2.1"),
      ]),
    },
    { marker: 0xe1, data: Buffer.from("http://ns.adobe.com/xap/1.0/\0<xmp/>") },
    { marker: 0xed, data: Buffer.from("Photoshop 3.0 synthetic IPTC") },
    { marker: 0xfe, data: Buffer.from("synthetic comment") },
  ];
  const original = jpegImage({ width: 300, height: 200, metadata });
  const reference = jpegImage({ width: 300, height: 200 });
  assert.notDeepEqual(Buffer.from(original), reference);

  const image = accept({
    bytes: original,
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
  });

  assert.deepEqual(Buffer.from(image.bytes), reference);
});

test("removes PNG text and EXIF chunks and keeps the image data byte for byte", () => {
  const metadata = [
    { type: "eXIf", data: Buffer.from("synthetic-exif-gps") },
    { type: "tEXt", data: Buffer.from("Comment\0synthetic text") },
    { type: "iTXt", data: Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<xmp/>") },
    { type: "zTXt", data: Buffer.from("Raw profile type exif\0\0synthetic") },
    { type: "tIME", data: Buffer.from([0x07, 0xea, 1, 2, 3, 4, 5]) },
  ];
  const original = pngImage({ width: 320, height: 240, metadata });
  const reference = pngImage({ width: 320, height: 240 });
  assert.notDeepEqual(Buffer.from(original), reference);

  const image = accept({
    bytes: original,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.deepEqual(Buffer.from(image.bytes), reference);
});

test("removes WebP EXIF and XMP chunks and clears their flags", () => {
  const original = webpExtendedImage({
    width: 500,
    height: 400,
    exif: true,
    xmp: true,
  });
  const reference = webpExtendedImage({ width: 500, height: 400 });
  assert.notDeepEqual(Buffer.from(original), reference);

  const image = accept({
    bytes: original,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.deepEqual(Buffer.from(image.bytes), reference);
  assert.equal(image.width, 500);
  assert.equal(image.height, 400);
});

function pngHeader(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return header;
}

test("refuses a PNG whose header does not have its exact length", () => {
  const bytes = Buffer.concat([
    pngSignature(),
    pngChunk("IHDR", pngHeader(10, 10).subarray(0, 8)),
    pngChunk("IDAT", Buffer.from([1, 2, 3])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  const result = refusal({
    bytes,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a PNG with a bad chunk checksum", () => {
  const bytes = Buffer.from(pngImage({ width: 10, height: 10 }));
  // The IHDR CRC starts after the signature, the length, the type and the data.
  bytes[8 + 8 + 13] ^= 0xff;

  const result = refusal({
    bytes,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a PNG without image data", () => {
  const bytes = Buffer.concat([
    pngSignature(),
    pngChunk("IHDR", pngHeader(10, 10)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  const result = refusal({
    bytes,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a PNG with data after its end chunk", () => {
  const bytes = Buffer.concat([
    pngImage({ width: 10, height: 10 }),
    Buffer.from([0x00]),
  ]);

  const result = refusal({
    bytes,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses an extended WebP without a frame", () => {
  const bytes = webpCanvasOnlyImage({ width: 100, height: 100 });

  const result = refusal({
    bytes,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a WebP whose canvas does not match its frame", () => {
  const bytes = webpExtendedImage({
    width: 1,
    height: 1,
    frameWidth: 3000,
    frameHeight: 1,
  });

  const result = refusal({
    bytes,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses an animated WebP", () => {
  const bytes = webpExtendedImage({ width: 100, height: 100, animated: true });

  const result = refusal({
    bytes,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a JPEG without its end marker", () => {
  const jpeg = jpegImage({ width: 100, height: 100 });

  const result = refusal({
    bytes: jpeg.subarray(0, jpeg.length - 2),
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a JPEG with data after its end marker", () => {
  const bytes = Buffer.concat([
    jpegImage({ width: 100, height: 100 }),
    Buffer.from([0x00]),
  ]);

  const result = refusal({
    bytes,
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
  });

  assert.equal(result.reason, "damaged_image");
});

test("removes metadata between the scans of a progressive JPEG", () => {
  const betweenScans = [
    {
      marker: 0xe1,
      data: Buffer.concat([
        Buffer.from("Exif\0\0", "latin1"),
        Buffer.from("GPS 41.4 2.1"),
      ]),
    },
    { marker: 0xed, data: Buffer.from("Photoshop 3.0 synthetic IPTC") },
  ];
  const beforeEoi = [{ marker: 0xfe, data: Buffer.from("synthetic comment") }];
  const original = jpegProgressiveImage({
    width: 300,
    height: 200,
    betweenScans,
    beforeEoi,
  });
  const reference = jpegProgressiveImage({ width: 300, height: 200 });
  assert.notDeepEqual(Buffer.from(original), reference);

  const image = accept({
    bytes: original,
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
  });

  assert.deepEqual(Buffer.from(image.bytes), reference);
  assert.equal(image.width, 300);
  assert.equal(image.height, 200);
});
