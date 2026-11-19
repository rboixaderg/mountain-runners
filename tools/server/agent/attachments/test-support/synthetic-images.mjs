// Synthetic images for the attachment tests.
//
// The fixtures are built in memory, so no binary file is committed. Each one is
// structurally valid for the header parser: only the containers, the declared
// dimensions and the metadata chunks matter to what the service reads.

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const chunkType = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([chunkType, data])), 0);
  return Buffer.concat([length, chunkType, data, crc]);
}

export function pngSignature() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/**
 * A PNG with an optional metadata chunk list before the image data. `filler`
 * pads the image data with a second IDAT chunk to reach an exact total size;
 * the parser only needs image data to be present.
 */
export function pngImage({ width, height, metadata = [], filler = 0 }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const chunks = [pngChunk("IHDR", header)];
  for (const chunk of metadata) {
    chunks.push(pngChunk(chunk.type, chunk.data));
  }
  chunks.push(pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x01, 0x02])));
  if (filler > 0) {
    chunks.push(pngChunk("IDAT", Buffer.alloc(filler)));
  }
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([pngSignature(), ...chunks]);
}

function jpegSegment(marker, payload) {
  const header = Buffer.from([0xff, marker, 0x00, 0x00]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** A baseline JPEG: JFIF, optional metadata segments, one frame and one scan. */
const jpegApp0 = () =>
  jpegSegment(
    0xe0,
    Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  );

function jpegFrame(marker, { width, height }) {
  const frame = Buffer.alloc(15);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3;
  for (let component = 0; component < 3; component += 1) {
    frame[6 + component * 3] = component + 1;
    frame[7 + component * 3] = 0x11;
  }
  return jpegSegment(marker, frame);
}

const jpegScanHeader = () =>
  Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);

// Stuffed data (FF 00) and a restart marker (FF D0) exercise the scan walk.
const jpegScanData = () =>
  Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]);

/** A baseline JPEG: JFIF, optional metadata segments, one frame and one scan. */
export function jpegImage({ width, height, metadata = [] }) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegApp0(),
    ...metadata.map((segment) => jpegSegment(segment.marker, segment.data)),
    jpegFrame(0xc0, { width, height }),
    jpegSegment(0xda, jpegScanHeader()),
    jpegScanData(),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/**
 * A progressive JPEG: two scans, with metadata segments allowed between the
 * scans and between the last scan and the end marker.
 */
export function jpegProgressiveImage({
  width,
  height,
  betweenScans = [],
  beforeEoi = [],
}) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegApp0(),
    jpegFrame(0xc2, { width, height }),
    jpegSegment(0xda, jpegScanHeader()),
    jpegScanData(),
    ...betweenScans.map((segment) => jpegSegment(segment.marker, segment.data)),
    jpegSegment(0xda, jpegScanHeader()),
    jpegScanData(),
    ...beforeEoi.map((segment) => jpegSegment(segment.marker, segment.data)),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function webpChunk(fourcc, payload) {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  const padding = Buffer.alloc(payload.length % 2);
  return Buffer.concat([header, payload, padding]);
}

function webpFile(chunks) {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function vp8LossyChunk(width, height) {
  const payload = Buffer.alloc(10);
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width & 0x3fff, 6);
  payload.writeUInt16LE(height & 0x3fff, 8);
  return webpChunk("VP8 ", payload);
}

function vp8LosslessChunk(width, height) {
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  return webpChunk("VP8L", payload);
}

function vp8ExtendedChunk({ width, height, exif, xmp, animated }) {
  const payload = Buffer.alloc(10);
  payload[0] =
    (exif ? 0x08 : 0) | (xmp ? 0x04 : 0) | (animated ? 0x02 : 0) | 0x10;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webpChunk("VP8X", payload);
}

export function webpLossyImage({ width, height }) {
  return webpFile([vp8LossyChunk(width, height)]);
}

export function webpLosslessImage({ width, height }) {
  return webpFile([vp8LosslessChunk(width, height)]);
}

/** An extended WebP with a canvas, optionally announcing EXIF and XMP. */
export function webpExtendedImage({
  width,
  height,
  frameWidth = width,
  frameHeight = height,
  exif = false,
  xmp = false,
  animated = false,
}) {
  const chunks = [vp8ExtendedChunk({ width, height, exif, xmp, animated })];
  if (exif) {
    chunks.push(webpChunk("EXIF", Buffer.from("synthetic-exif-gps")));
  }
  if (xmp) {
    chunks.push(webpChunk("XMP ", Buffer.from("synthetic-xmp-packet")));
  }
  chunks.push(vp8LosslessChunk(frameWidth, frameHeight));
  return webpFile(chunks);
}

/** An extended WebP that announces a canvas but carries no frame. */
export function webpCanvasOnlyImage({ width, height }) {
  return webpFile([
    vp8ExtendedChunk({
      width,
      height,
      exif: false,
      xmp: false,
      animated: false,
    }),
  ]);
}
