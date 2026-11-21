// EXIF orientation of an image, read from its header (T8.7).
//
// The metadata stripper removes the EXIF container before the bytes reach the
// worktree, which also removes the only record of how the camera was held. This
// reader keeps that one value: the sandbox applies the matching rotation after
// the pixels are decoded, so a photo from a phone is not stored sideways.
//
// Only the header is read: no pixel is decoded, no dependency is added, and a
// malformed container yields the neutral orientation instead of throwing.

// The eight EXIF orientations, as TIFF defines them. Values outside the list
// are invalid metadata and are treated as the neutral orientation.
export const exifOrientations = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
export const defaultExifOrientation = 1;

const exifHeader = "Exif\0\0";
const orientationTag = 0x0112;
const shortType = 3;

function readUint16BigEndian(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BigEndian(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint16LittleEndian(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LittleEndian(bytes, offset) {
  return (
    ((bytes[offset + 3] << 24) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 1] << 8) |
      bytes[offset]) >>>
    0
  );
}

function readAscii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index]);
  }
  return text;
}

/** The TIFF payload of an EXIF block, skipping the optional `Exif\0\0` label. */
function tiffPayload(payload) {
  if (payload.length >= exifHeader.length) {
    if (readAscii(payload, 0, exifHeader.length) === exifHeader) {
      return payload.subarray(exifHeader.length);
    }
  }
  return payload;
}

/**
 * The orientation in the first TIFF image file directory. The entry must be a
 * single SHORT in the declared byte order; anything else is not an orientation.
 */
function orientationFromTiff(tiff) {
  if (tiff.length < 8) {
    return defaultExifOrientation;
  }
  const byteOrder = readAscii(tiff, 0, 2);
  const littleEndian = byteOrder === "II";
  if (!littleEndian && byteOrder !== "MM") {
    return defaultExifOrientation;
  }
  const readUint16 = littleEndian
    ? readUint16LittleEndian
    : readUint16BigEndian;
  const readUint32 = littleEndian
    ? readUint32LittleEndian
    : readUint32BigEndian;
  if (readUint16(tiff, 2) !== 42) {
    return defaultExifOrientation;
  }
  const directoryOffset = readUint32(tiff, 4);
  if (directoryOffset + 2 > tiff.length) {
    return defaultExifOrientation;
  }
  const entryCount = readUint16(tiff, directoryOffset);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = directoryOffset + 2 + index * 12;
    if (entryOffset + 12 > tiff.length) {
      return defaultExifOrientation;
    }
    if (readUint16(tiff, entryOffset) !== orientationTag) {
      continue;
    }
    if (
      readUint16(tiff, entryOffset + 2) !== shortType ||
      readUint32(tiff, entryOffset + 4) !== 1
    ) {
      return defaultExifOrientation;
    }
    const value = readUint16(tiff, entryOffset + 8);
    return exifOrientations.includes(value) ? value : defaultExifOrientation;
  }
  return defaultExifOrientation;
}

function jpegExifPayload(bytes) {
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    // Fill bytes before a marker are legal and belong to the marker itself.
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    // A temporary or restart marker carries no segment: skip it and continue.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) {
      return null;
    }
    const segmentLength = readUint16BigEndian(bytes, offset + 2);
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      return null;
    }
    if (
      marker === 0xe1 &&
      segmentLength >= 2 + exifHeader.length &&
      readAscii(bytes, offset + 4, exifHeader.length) === exifHeader
    ) {
      return bytes.subarray(offset + 4, segmentEnd);
    }
    offset = segmentEnd;
  }
  return null;
}

function pngExifPayload(bytes) {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32BigEndian(bytes, offset);
    const chunkType = readAscii(bytes, offset + 4, 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + length;
    if (payloadEnd + 4 > bytes.length) {
      return null;
    }
    if (chunkType === "eXIf") {
      return bytes.subarray(payloadStart, payloadEnd);
    }
    if (chunkType === "IEND") {
      return null;
    }
    offset = payloadEnd + 4;
  }
  return null;
}

function webpExifPayload(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = readAscii(bytes, offset, 4);
    const chunkSize = readUint32LittleEndian(bytes, offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkSize;
    if (payloadEnd > bytes.length) {
      return null;
    }
    if (fourcc === "EXIF") {
      return bytes.subarray(payloadStart, payloadEnd);
    }
    offset = payloadEnd + (chunkSize % 2);
  }
  return null;
}

/**
 * The EXIF orientation of the image (`1`..`8`), or `1` when the container has
 * no readable orientation. A damaged or truncated header never throws.
 */
export function readExifOrientation(bytes, type) {
  let payload = null;
  if (type === "jpeg") {
    payload = jpegExifPayload(bytes);
  } else if (type === "png") {
    payload = pngExifPayload(bytes);
  } else if (type === "webp") {
    payload = webpExifPayload(bytes);
  }
  if (payload === null || payload.length === 0) {
    return defaultExifOrientation;
  }
  return orientationFromTiff(tiffPayload(payload));
}
