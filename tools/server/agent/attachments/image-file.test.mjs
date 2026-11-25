import assert from "node:assert/strict";
import { test } from "node:test";
import { maximumAttachmentBytes } from "telegram-pi-bridge/telegram";
import {
  maximumAttachmentLongSide,
  prepareImageAttachment,
} from "./image-file.mjs";
import { inspectImage } from "./image-format.mjs";
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

const jpegDefaultScanData = Buffer.from([
  0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33,
]);

function jpegWithScanData(scanData) {
  const base = jpegImage({ width: 100, height: 100 });
  const scanStart = base.indexOf(jpegDefaultScanData);
  return Buffer.concat([
    base.subarray(0, scanStart),
    scanData,
    base.subarray(scanStart + jpegDefaultScanData.length),
  ]);
}

// A frame header shorter than the eight bytes the marker requires.
function jpegWithShortFrameSegment() {
  const base = jpegImage({ width: 100, height: 100 });
  const frameStart = base.indexOf(Buffer.from([0xff, 0xc0]));
  const frame = Buffer.alloc(2 + 7);
  frame[0] = 0xff;
  frame[1] = 0xc0;
  frame.writeUInt16BE(7, 2);
  // Precision, height and width, without the component count.
  base.copy(frame, 4, frameStart + 4, frameStart + 9);
  return Buffer.concat([
    base.subarray(0, frameStart),
    frame,
    base.subarray(frameStart + 19),
  ]);
}

// A frame header that describes no component at all.
function jpegWithoutFrameComponents() {
  const base = jpegImage({ width: 100, height: 100 });
  const frameStart = base.indexOf(Buffer.from([0xff, 0xc0]));
  const frame = Buffer.alloc(2 + 8);
  frame[0] = 0xff;
  frame[1] = 0xc0;
  frame.writeUInt16BE(8, 2);
  base.copy(frame, 4, frameStart + 4, frameStart + 9);
  frame[9] = 0;
  return Buffer.concat([
    base.subarray(0, frameStart),
    frame,
    base.subarray(frameStart + 19),
  ]);
}

function webpChunk(fourcc, payload) {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)]);
}

function webpWithChunks(bytes, ...chunks) {
  return webpFileFromChunks([bytes.subarray(12), ...chunks]);
}

function webpFileFromChunks(chunks) {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
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

test("keeps the EXIF orientation before stripping every metadata container", () => {
  // A minimal big-endian TIFF: one IFD entry, the orientation tag, SHORT, 1.
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "ascii");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(6, 18);
  const original = jpegImage({
    width: 320,
    height: 240,
    metadata: [
      {
        marker: 0xe1,
        data: Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]),
      },
    ],
  });

  const image = accept({
    bytes: original,
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
  });

  assert.equal(image.orientation, 6);
  assert.equal(image.width, 320);
  assert.equal(image.height, 240);
  assert.equal(inspectImage(image.bytes).hasMetadata, false);
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

test("truncates a JPEG at its end marker and keeps none of the extra data", () => {
  const reference = jpegImage({ width: 100, height: 100 });
  for (const extra of [
    Buffer.alloc(16),
    // An appended multi-picture image and a Motion Photo video.
    jpegImage({ width: 40, height: 30 }),
    Buffer.from("ftypmp42 synthetic-video GPS 41.4 2.1"),
  ]) {
    const original = Buffer.concat([reference, extra]);
    assert.equal(inspectImage(original).hasMetadata, true);

    const image = accept({
      bytes: original,
      fileName: "foto.jpg",
      mimeType: "image/jpeg",
    });

    assert.deepEqual(Buffer.from(image.bytes), reference);
    assert.equal(image.width, 100);
    assert.equal(image.height, 100);
  }
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

test("removes JPEG APP2 multi-picture and APP12 segments", () => {
  const metadata = [
    { marker: 0xe2, data: Buffer.from("MPF\0synthetic-thumbnail") },
    { marker: 0xec, data: Buffer.from("Ducky\0synthetic-app12") },
  ];
  const original = jpegImage({ width: 300, height: 200, metadata });
  const reference = jpegImage({ width: 300, height: 200 });

  const image = accept({
    bytes: original,
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
  });

  assert.deepEqual(Buffer.from(image.bytes), reference);
});

test("accepts fill bytes before a restart marker in a scan", () => {
  const bytes = jpegWithScanData(
    Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xff, 0xd0, 0x33]),
  );

  const image = accept({
    bytes,
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
  });

  assert.deepEqual(Buffer.from(image.bytes), bytes);
  assert.equal(image.width, 100);
});

test("refuses a JPEG frame segment that is not a complete header", () => {
  for (const bytes of [
    jpegWithShortFrameSegment(),
    jpegWithoutFrameComponents(),
  ]) {
    const result = refusal({
      bytes,
      fileName: "foto.jpg",
      mimeType: "image/jpeg",
    });

    assert.equal(result.reason, "damaged_image");
  }
});

test("removes PNG private and unlisted ancillary chunks", () => {
  const metadata = [
    { type: "prVW", data: Buffer.alloc(16, 7) },
    { type: "pHYs", data: Buffer.alloc(9, 1) },
  ];
  const original = pngImage({ width: 320, height: 240, metadata });
  const reference = pngImage({ width: 320, height: 240 });

  const image = accept({
    bytes: original,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.deepEqual(Buffer.from(image.bytes), reference);
});

test("keeps the PNG colour profile", () => {
  const original = pngImage({
    width: 320,
    height: 240,
    metadata: [{ type: "iCCP", data: Buffer.from("synthetic-profile") }],
  });

  const image = accept({
    bytes: original,
    fileName: "portada.png",
    mimeType: "image/png",
  });

  assert.deepEqual(Buffer.from(image.bytes), original);
});

test("keeps the WebP colour profile and its flag", () => {
  const extended = webpExtendedImage({ width: 500, height: 400 });
  const header = Buffer.from(extended.subarray(12, 30));
  header[8] |= 0x20;
  const original = webpFileFromChunks([
    header,
    webpChunk("ICCP", Buffer.from("synthetic-profile")),
    extended.subarray(30),
  ]);

  const image = accept({
    bytes: original,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.deepEqual(Buffer.from(image.bytes), original);
});

const maximumProfileBytes = 64 * 1024;

function cleanedBytes(bytes, extension, mimeType) {
  return Buffer.from(
    accept({ bytes, fileName: `foto.${extension}`, mimeType }).bytes,
  );
}

test("keeps one PNG colour profile, before the image data and within 64 KiB", () => {
  const reference = pngImage({ width: 32, height: 24 });
  const profile = (length) => ({ type: "iCCP", data: Buffer.alloc(length, 1) });
  const withProfiles = (...metadata) =>
    pngImage({ width: 32, height: 24, metadata });
  const kept = withProfiles(profile(maximumProfileBytes));
  const late = Buffer.concat([
    reference.subarray(0, -12),
    pngChunk("iCCP", Buffer.from("late")),
    reference.subarray(-12),
  ]);

  for (const [original, expected] of [
    [kept, kept],
    [withProfiles(profile(10), profile(11)), withProfiles(profile(10))],
    [withProfiles(profile(maximumProfileBytes + 1)), reference],
    [withProfiles(profile(maximumProfileBytes + 1), profile(10)), reference],
    [late, reference],
  ]) {
    assert.deepEqual(cleanedBytes(original, "png", "image/png"), expected);
  }
});

test("keeps one WebP colour profile only with its flag and within 64 KiB", () => {
  const extended = webpExtendedImage({ width: 500, height: 400 });
  const frame = extended.subarray(30);
  const header = (flagged) => {
    const chunk = Buffer.from(extended.subarray(12, 30));
    if (flagged) {
      chunk[8] |= 0x20;
    }
    return chunk;
  };
  const profile = (length) => webpChunk("ICCP", Buffer.alloc(length, 1));
  const file = (flagged, ...chunks) =>
    webpFileFromChunks([header(flagged), ...chunks]);
  const kept = file(true, profile(maximumProfileBytes), frame);
  const lossy = webpLossyImage({ width: 500, height: 400 });

  for (const [original, expected] of [
    [kept, kept],
    [
      file(true, profile(10), profile(11), frame),
      file(true, profile(10), frame),
    ],
    [file(true, profile(maximumProfileBytes + 1), frame), extended],
    [file(true, frame, profile(10)), extended],
    [file(true, frame), extended],
    [file(false, profile(10), frame), extended],
    [webpWithChunks(lossy, profile(10)), lossy],
  ]) {
    assert.deepEqual(cleanedBytes(original, "webp", "image/webp"), expected);
  }
});

test("removes a JPEG colour profile whose segments exceed 64 KiB together", () => {
  const profile = (length) => ({
    marker: 0xe2,
    data: Buffer.concat([
      Buffer.from("ICC_PROFILE\0", "latin1"),
      Buffer.alloc(length - 12, 1),
    ]),
  });
  const withProfile = (...metadata) =>
    jpegImage({ width: 100, height: 100, metadata });
  const kept = withProfile(profile(32768), profile(32768));

  assert.deepEqual(cleanedBytes(kept, "jpg", "image/jpeg"), kept);
  assert.deepEqual(
    cleanedBytes(
      withProfile(profile(32768), profile(32769)),
      "jpg",
      "image/jpeg",
    ),
    withProfile(),
  );
});

test("does not take an end marker inside a segment as the end of a JPEG", () => {
  const endMarker = Buffer.from([0xff, 0xd9]);
  const profile = {
    marker: 0xe2,
    data: Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), endMarker]),
  };
  const exif = {
    marker: 0xe1,
    data: Buffer.concat([Buffer.from("Exif\0\0", "latin1"), endMarker]),
  };

  const cleaned = cleanedBytes(
    jpegImage({ width: 100, height: 100, metadata: [exif, profile] }),
    "jpg",
    "image/jpeg",
  );

  assert.deepEqual(
    cleaned,
    jpegImage({ width: 100, height: 100, metadata: [profile] }),
  );
});

test("truncates a progressive JPEG after its last scan", () => {
  const reference = jpegProgressiveImage({ width: 300, height: 200 });

  const cleaned = cleanedBytes(
    Buffer.concat([reference, jpegImage({ width: 40, height: 30 })]),
    "jpg",
    "image/jpeg",
  );

  assert.deepEqual(cleaned, reference);
});

test("strips a WebP chunk outside the allowlist", () => {
  const reference = webpExtendedImage({ width: 500, height: 400 });
  const original = webpWithChunks(
    reference,
    webpChunk("JUNK", Buffer.from("private")),
  );

  const image = accept({
    bytes: original,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.deepEqual(Buffer.from(image.bytes), reference);
});

test("refuses a WebP with more than one VP8X chunk", () => {
  const original = webpWithChunks(
    webpExtendedImage({ width: 100, height: 100 }),
    webpChunk("VP8X", Buffer.alloc(10)),
  );

  const result = refusal({
    bytes: original,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a WebP whose VP8X chunk is not the first one", () => {
  const lossy = webpLossyImage({ width: 100, height: 100 });
  const original = webpWithChunks(lossy, webpChunk("VP8X", Buffer.alloc(10)));

  const result = refusal({
    bytes: original,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a WebP whose VP8X chunk is not ten bytes", () => {
  const lossy = webpLossyImage({ width: 100, height: 100 });
  const original = webpFileFromChunks([
    webpChunk("VP8X", Buffer.alloc(12)),
    lossy.subarray(12),
  ]);

  const result = refusal({
    bytes: original,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.equal(result.reason, "damaged_image");
});

test("refuses a WebP whose VP8 frame is not a key frame", () => {
  const bytes = Buffer.from(webpLossyImage({ width: 100, height: 100 }));
  // The frame tag starts right after the RIFF header and the chunk header.
  bytes[20] |= 1;

  const result = refusal({
    bytes,
    fileName: "foto.webp",
    mimeType: "image/webp",
  });

  assert.equal(result.reason, "damaged_image");
});
