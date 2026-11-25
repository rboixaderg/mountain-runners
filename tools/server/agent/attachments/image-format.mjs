// Image containers of the private agent (T8.4), without dependencies.
//
// Dimensions and metadata come from the headers only: no pixel is decoded and
// no library is added. Rewriting drops the metadata containers and copies the
// image data byte for byte, so the cleaned file is still the same image.
//
// The three formats are the only ones the service accepts. A file whose
// structure cannot be parsed is refused by the caller instead of being guessed:
// checksums are verified where the container defines one and the whole file
// must be consumed by its structure.

const imageTypes = {
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
};

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Only the chunks that are part of the image itself survive inspection. Every
// other ancillary chunk is metadata, including private and standard chunks the
// list does not need (pHYs, eXIf, text and time chunks). The colour profile
// (iCCP) is decided apart, in `readPngStructure`.
const pngKeptChunks = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
]);
const webpKeptChunks = new Set(["VP8X", "VP8 ", "VP8L", "ALPH"]);
const webpAnimationFlag = 0x02;
const webpExifFlag = 0x08;
const webpXmpFlag = 0x04;
const webpIccFlag = 0x20;
// The colour profile is kept in the three formats, because removing it changes
// the colours. Its contents are not inspected, so its size is bounded: a larger
// profile is removed.
const maximumProfileBytes = 64 * 1024;
// Structural segments of a JPEG. APP0 and APP2 are kept only when they carry
// JFIF or an ICC profile; every other APP segment and COM are metadata.
const jpegApp0Marker = 0xe0;
const jpegApp2Marker = 0xe2;
const jpegJfifSignature = "JFIF\0";
const jpegIccSignature = "ICC_PROFILE\0";
const jpegKeptMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc, 0xcd,
  0xce, 0xcf, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xdb, 0xdc, 0xdd,
]);

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

function readUint16BigEndian(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LittleEndian(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
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

function readUint32LittleEndian(bytes, offset) {
  return (
    ((bytes[offset + 3] << 24) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 1] << 8) |
      bytes[offset]) >>>
    0
  );
}

function readUint24LittleEndian(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readAscii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index]);
  }
  return text;
}

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

function isJpegFrameMarker(marker) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function isJpegProfileSegment(marker, bytes, payloadStart, segmentLength) {
  return (
    marker === jpegApp2Marker &&
    segmentLength >= 16 &&
    readAscii(bytes, payloadStart, jpegIccSignature.length) === jpegIccSignature
  );
}

// Whether a marker segment belongs to the image. Anything else is metadata and
// is removed, including APP2 multi-picture files that embed a thumbnail with
// its own EXIF data.
function isJpegKeptSegment(marker, bytes, payloadStart, segmentLength) {
  if (marker === jpegApp0Marker) {
    return (
      segmentLength >= 16 &&
      readAscii(bytes, payloadStart, jpegJfifSignature.length) ===
        jpegJfifSignature
    );
  }
  if (marker === jpegApp2Marker) {
    return isJpegProfileSegment(marker, bytes, payloadStart, segmentLength);
  }
  return jpegKeptMarkers.has(marker);
}

/** The container type of the image, from its signature, or null. */
export function detectImageType(bytes) {
  if (startsWith(bytes, pngSignature)) {
    return imageTypes.png;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return imageTypes.jpeg;
  }
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === "RIFF" &&
    readAscii(bytes, 8, 4) === "WEBP"
  ) {
    return imageTypes.webp;
  }
  return null;
}

// Every chunk is bounded by the file and carries a valid CRC; the header comes
// first with its exact length, image data is present and IEND closes the file.
// The only colour profile kept is the first one, before the image data.
function readPngStructure(bytes) {
  let offset = pngSignature.length;
  let dimensions = null;
  let hasImageData = false;
  let hasMetadata = false;
  let hasProfileChunk = false;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      return null;
    }
    const length = readUint32BigEndian(bytes, offset);
    const chunkType = readAscii(bytes, offset + 4, 4);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) {
      return null;
    }
    const expectedCrc = readUint32BigEndian(bytes, chunkEnd - 4);
    if (crc32(bytes.subarray(offset + 4, chunkEnd - 4)) !== expectedCrc) {
      return null;
    }
    if (dimensions === null) {
      if (chunkType !== "IHDR" || length !== 13) {
        return null;
      }
      dimensions = {
        width: readUint32BigEndian(bytes, offset + 8),
        height: readUint32BigEndian(bytes, offset + 12),
      };
      if (dimensions.width === 0 || dimensions.height === 0) {
        return null;
      }
    } else if (chunkType === "IHDR") {
      return null;
    }
    if (chunkType === "IDAT") {
      hasImageData = true;
    }
    let isKept = pngKeptChunks.has(chunkType);
    if (chunkType === "iCCP") {
      isKept =
        !hasProfileChunk && !hasImageData && length <= maximumProfileBytes;
      hasProfileChunk = true;
    }
    if (isKept) {
      chunks.push(bytes.subarray(offset, chunkEnd));
    } else {
      // An unknown critical chunk changes how the image must be decoded, so the
      // file is refused instead of stripped.
      if ((bytes[offset + 4] & 0x20) === 0) {
        return null;
      }
      hasMetadata = true;
    }
    offset = chunkEnd;
    if (chunkType === "IEND") {
      if (length !== 0 || offset !== bytes.length || !hasImageData) {
        return null;
      }
      return { dimensions, chunks, hasMetadata };
    }
  }
  return null;
}

function inspectPng(bytes) {
  const structure = readPngStructure(bytes);
  if (structure === null) {
    return null;
  }
  return {
    type: imageTypes.png,
    ...structure.dimensions,
    hasMetadata: structure.hasMetadata,
  };
}

// Where the entropy-coded data of a scan stops: the index of the 0xFF that
// starts the next marker. Stuffed data (FF 00), restart markers (FF D0-FF D7)
// and any fill bytes (FF FF) belong to the scan, even before a restart marker.
function jpegScanEnd(bytes, start) {
  let offset = start;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let followingIndex = offset + 1;
    while (followingIndex < bytes.length && bytes[followingIndex] === 0xff) {
      followingIndex += 1;
    }
    if (followingIndex >= bytes.length) {
      return -1;
    }
    const following = bytes[followingIndex];
    if (following === 0x00 || (following >= 0xd0 && following <= 0xd7)) {
      offset = followingIndex + 1;
      continue;
    }
    return offset;
  }
  return -1;
}

/**
 * Walk the whole JPEG, progressive scans included, and return the ordered
 * pieces of the image: every marker segment, every entropy-coded scan and the
 * first EOI. Data after that EOI (extra images, a Motion Photo video, padding)
 * is not a piece, so stripping drops it, and until then it counts as metadata.
 * Null means the structure cannot be read or no frame or scan is present.
 */
function readJpegStructure(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const pieces = [];
  let offset = 2;
  let dimensions = null;
  let scanCount = 0;
  let hasMetadata = false;
  let profileBytes = 0;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const markerStart = offset;
    while (bytes[offset + 1] === 0xff) {
      offset += 1;
      if (offset + 1 >= bytes.length) {
        return null;
      }
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9) {
      const end = offset + 2;
      pieces.push({ start: markerStart, end });
      if (dimensions === null || scanCount === 0) {
        return null;
      }
      // The profile spans several segments: all of them stay or none does.
      const oversizedProfile = profileBytes > maximumProfileBytes;
      return {
        dimensions,
        pieces: oversizedProfile
          ? pieces.filter((piece) => !piece.isProfile)
          : pieces,
        hasMetadata: hasMetadata || oversizedProfile || end !== bytes.length,
      };
    }
    // A second SOI, a TEM or a restart marker outside a scan is not a
    // parseable structure.
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker < 0xc0
    ) {
      return null;
    }
    if (offset + 4 > bytes.length) {
      return null;
    }
    const segmentLength = readUint16BigEndian(bytes, offset + 2);
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      return null;
    }
    const payloadStart = offset + 4;
    const isKept = isJpegKeptSegment(
      marker,
      bytes,
      payloadStart,
      segmentLength,
    );
    const isProfile = isJpegProfileSegment(
      marker,
      bytes,
      payloadStart,
      segmentLength,
    );
    if (!isKept) {
      hasMetadata = true;
    }
    if (isProfile) {
      profileBytes += segmentLength - 2;
    }
    if (isJpegFrameMarker(marker)) {
      if (dimensions !== null) {
        return null;
      }
      // The frame header must describe its components inside its own segment,
      // so the dimensions are never read from the following segment.
      if (segmentLength < 8) {
        return null;
      }
      const componentCount = bytes[offset + 9];
      if (componentCount < 1 || segmentLength !== 8 + 3 * componentCount) {
        return null;
      }
      dimensions = {
        height: readUint16BigEndian(bytes, offset + 5),
        width: readUint16BigEndian(bytes, offset + 7),
      };
      if (dimensions.width === 0 || dimensions.height === 0) {
        return null;
      }
    }
    if (isKept) {
      pieces.push({ start: markerStart, end: segmentEnd, isProfile });
    }
    offset = segmentEnd;
    if (marker !== 0xda) {
      continue;
    }
    if (dimensions === null) {
      return null;
    }
    scanCount += 1;
    const scanEnd = jpegScanEnd(bytes, offset);
    if (scanEnd === -1) {
      return null;
    }
    if (scanEnd > offset) {
      pieces.push({ start: offset, end: scanEnd });
    }
    offset = scanEnd;
  }
  return null;
}

function inspectJpeg(bytes) {
  const structure = readJpegStructure(bytes);
  if (structure === null) {
    return null;
  }
  return {
    type: imageTypes.jpeg,
    ...structure.dimensions,
    hasMetadata: structure.hasMetadata,
  };
}

function inspectWebpFrame(bytes, payloadStart, chunkSize) {
  if (chunkSize < 10 || bytes[payloadStart + 3] !== 0x9d) {
    return null;
  }
  // The low bit of the frame tag distinguishes a key frame from an
  // interframe: only a key frame is a complete image.
  if ((bytes[payloadStart] & 1) !== 0) {
    return null;
  }
  if (bytes[payloadStart + 4] !== 0x01 || bytes[payloadStart + 5] !== 0x2a) {
    return null;
  }
  return {
    width: readUint16LittleEndian(bytes, payloadStart + 6) & 0x3fff,
    height: readUint16LittleEndian(bytes, payloadStart + 8) & 0x3fff,
  };
}

function inspectWebpLossless(bytes, payloadStart, chunkSize) {
  if (chunkSize < 5 || bytes[payloadStart] !== 0x2f) {
    return null;
  }
  const bits = readUint32LittleEndian(bytes, payloadStart + 1);
  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
  };
}

// The riff size must consume the file exactly, chunk padding included, and the
// image needs exactly one frame. An extended file also carries a canvas that
// must describe that same frame; animation is not accepted. Only structural
// chunks are kept, so every other chunk is metadata. The only colour profile
// kept follows a VP8X header that announces it, and the header announces one
// only when it is there.
function readWebpStructure(bytes) {
  if (bytes.length < 12) {
    return null;
  }
  const riffSize = readUint32LittleEndian(bytes, 4);
  if (riffSize + 8 !== bytes.length) {
    return null;
  }
  let offset = 12;
  let canvas = null;
  let frame = null;
  let frameCount = 0;
  let hasMetadata = false;
  let announcesProfile = false;
  let hasProfile = false;
  let chunkIndex = 0;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      return null;
    }
    const fourcc = readAscii(bytes, offset, 4);
    const chunkSize = readUint32LittleEndian(bytes, offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkSize;
    const chunkEnd = payloadEnd + (chunkSize % 2);
    if (chunkEnd > bytes.length) {
      return null;
    }
    if (fourcc === "ANMF" || fourcc === "ANIM") {
      return null;
    }
    if (fourcc === "VP8X") {
      // Exactly one extended header, first, with its fixed payload length.
      if (chunkIndex !== 0 || chunkSize !== 10) {
        return null;
      }
      const flags = bytes[payloadStart];
      if ((flags & webpAnimationFlag) !== 0) {
        return null;
      }
      announcesProfile = (flags & webpIccFlag) !== 0;
      if ((flags & (webpExifFlag | webpXmpFlag)) !== 0) {
        hasMetadata = true;
      }
      canvas = {
        width: readUint24LittleEndian(bytes, payloadStart + 4) + 1,
        height: readUint24LittleEndian(bytes, payloadStart + 7) + 1,
      };
    }
    let isKept = webpKeptChunks.has(fourcc);
    if (fourcc === "ICCP") {
      isKept =
        announcesProfile &&
        chunkIndex === 1 &&
        chunkSize <= maximumProfileBytes;
      hasProfile ||= isKept;
    }
    if (isKept) {
      chunks.push(bytes.subarray(offset, chunkEnd));
    } else {
      hasMetadata = true;
    }
    if (fourcc === "VP8 " || fourcc === "VP8L") {
      frameCount += 1;
      frame =
        fourcc === "VP8 "
          ? inspectWebpFrame(bytes, payloadStart, chunkSize)
          : inspectWebpLossless(bytes, payloadStart, chunkSize);
      if (frame === null) {
        return null;
      }
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (offset !== bytes.length || frameCount !== 1) {
    return null;
  }
  if (
    canvas !== null &&
    (canvas.width !== frame.width || canvas.height !== frame.height)
  ) {
    return null;
  }
  const dimensions = canvas ?? frame;
  if (dimensions.width === 0 || dimensions.height === 0) {
    return null;
  }
  return {
    dimensions,
    chunks,
    hasProfile,
    hasMetadata: hasMetadata || announcesProfile !== hasProfile,
  };
}

function inspectWebp(bytes) {
  const structure = readWebpStructure(bytes);
  if (structure === null) {
    return null;
  }
  return {
    type: imageTypes.webp,
    ...structure.dimensions,
    hasMetadata: structure.hasMetadata,
  };
}

/**
 * The type, dimensions and metadata presence of a well-formed image. Null means
 * the bytes are not a parseable JPEG, PNG or WebP.
 */
export function inspectImage(bytes) {
  const type = detectImageType(bytes);
  if (type === imageTypes.png) {
    return inspectPng(bytes);
  }
  if (type === imageTypes.jpeg) {
    return inspectJpeg(bytes);
  }
  if (type === imageTypes.webp) {
    return inspectWebp(bytes);
  }
  return null;
}

function stripJpegMetadata(bytes) {
  const structure = readJpegStructure(bytes);
  if (structure === null) {
    throw new Error("The JPEG structure cannot be read.");
  }
  return Buffer.concat([
    bytes.subarray(0, 2),
    ...structure.pieces.map((piece) => bytes.subarray(piece.start, piece.end)),
  ]);
}

function stripPngMetadata(bytes) {
  const structure = readPngStructure(bytes);
  if (structure === null) {
    throw new Error("The PNG structure cannot be read.");
  }
  return Buffer.concat([
    bytes.subarray(0, pngSignature.length),
    ...structure.chunks,
  ]);
}

function stripWebpMetadata(bytes) {
  const structure = readWebpStructure(bytes);
  if (structure === null) {
    throw new Error("The WebP structure cannot be read.");
  }
  const chunks = structure.chunks.map((chunk) => {
    if (readAscii(chunk, 0, 4) !== "VP8X") {
      return chunk;
    }
    // The flags announce only the chunks that survive.
    const header = Buffer.from(chunk);
    header[8] &= ~(webpExifFlag | webpXmpFlag | webpIccFlag);
    if (structure.hasProfile) {
      header[8] |= webpIccFlag;
    }
    return header;
  });
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/**
 * The same image without metadata containers. The caller re-inspects the result
 * and verifies the type, the dimensions and the absence of metadata.
 */
export function stripImageMetadata(bytes, type) {
  if (type === imageTypes.jpeg) {
    return stripJpegMetadata(bytes);
  }
  if (type === imageTypes.png) {
    return stripPngMetadata(bytes);
  }
  if (type === imageTypes.webp) {
    return stripWebpMetadata(bytes);
  }
  throw new Error(`Unsupported image type ${type}.`);
}
