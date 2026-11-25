// Image attachments sent to a topic.
//
// A compressed photo and an image document are admitted the same way: the
// declared type and file size are checked here, so an unsupported or oversized
// file is answered when it arrives instead of occupying the queue. The real
// bytes are validated by the application when the instruction runs: downloading
// at admission would keep the file before anyone uses it.
//
// Telegram delivers a compressed photo as several sizes of a JPEG and without
// a file name or MIME type. The largest size is the one the person sent.
//
// This table is the shared contract between admission and that later
// validation, which compares the real bytes with the declared extension and
// MIME type.

// The Telegram Bot API refuses to download a file above 20 MB.
export const maximumAttachmentBytes = 20 * 1024 * 1024;

// One album addressed to the bot is one instruction with at most five images.
export const maximumImagesPerInstruction = 5;

export const acceptedImageDocuments = [
  {
    type: "jpeg",
    mimeType: "image/jpeg",
    extensions: ["jpg", "jpeg"],
    canonicalExtension: ".jpg",
  },
  {
    type: "png",
    mimeType: "image/png",
    extensions: ["png"],
    canonicalExtension: ".png",
  },
  {
    type: "webp",
    mimeType: "image/webp",
    extensions: ["webp"],
    canonicalExtension: ".webp",
  },
];

/** Where the image of an instruction comes from. */
export const attachmentOrigins = {
  message: "message",
  reply: "reply",
};

export const attachmentRefusalReasons = {
  unsupportedDocument: "unsupported_document",
  invalidPhoto: "invalid_photo",
  declaredTooLarge: "declared_too_large",
  tooManyImages: "too_many_images",
};

// A declared MIME type reaches a private trace, so only a plain token survives.
const declaredMimePattern =
  /^[a-z][a-z0-9.+-]{0,40}\/[a-z0-9][a-z0-9.+-]{0,40}$/u;

/** The lower-case extension of a Telegram file name, without the dot. */
export function fileNameExtension(fileName) {
  if (typeof fileName !== "string") {
    return null;
  }
  const baseName = fileName.slice(fileName.lastIndexOf("/") + 1);
  const dot = baseName.lastIndexOf(".");
  return dot === -1 ? null : baseName.slice(dot + 1).toLowerCase();
}

/** The accepted image type a document declares, or null. */
function declaredImageDocument(document) {
  const extension = fileNameExtension(document.file_name);
  const mimeType =
    typeof document.mime_type === "string"
      ? document.mime_type.toLowerCase()
      : null;
  if (extension === null || mimeType === null) {
    return null;
  }
  return (
    acceptedImageDocuments.find(
      (entry) =>
        entry.mimeType === mimeType && entry.extensions.includes(extension),
    ) ?? null
  );
}

// What a person and the private trace can call the declared type without
// echoing an arbitrary string from Telegram.
function declaredTypeLabel(document) {
  const declared = declaredImageDocument(document);
  if (declared !== null) {
    return declared.type;
  }
  const mimeType =
    typeof document.mime_type === "string"
      ? document.mime_type.toLowerCase()
      : null;
  return mimeType !== null && declaredMimePattern.test(mimeType)
    ? mimeType
    : undefined;
}

/**
 * Why a declared document cannot be admitted, or null when it can. The size is
 * only checked when Telegram declares it; the download enforces it again.
 */
export function imageDocumentRefusal(document) {
  if (typeof document?.file_id !== "string" || document.file_id.trim() === "") {
    // Without a file reference Telegram cannot return the bytes, so the image
    // is as unusable as an unreadable photo.
    return { reason: attachmentRefusalReasons.invalidPhoto };
  }
  const declared = declaredImageDocument(document);
  if (declared === null) {
    return {
      reason: attachmentRefusalReasons.unsupportedDocument,
      type: declaredTypeLabel(document),
    };
  }
  if (
    Number.isSafeInteger(document.file_size) &&
    document.file_size > maximumAttachmentBytes
  ) {
    return {
      reason: attachmentRefusalReasons.declaredTooLarge,
      type: declared.type,
      bytes: document.file_size,
    };
  }
  return null;
}

// Telegram does not order the sizes; the largest one is the image the person
// sent. The area is enough, with the declared size as a stable tie-break.
function photoArea(size) {
  if (
    !Number.isSafeInteger(size?.width) ||
    !Number.isSafeInteger(size?.height) ||
    size.width < 1 ||
    size.height < 1
  ) {
    return 0;
  }
  return size.width * size.height;
}

/** The photo size that carries the whole image, or null. */
export function largestPhotoSize(photo) {
  if (!Array.isArray(photo)) {
    return null;
  }
  let largest = null;
  for (const size of photo) {
    if (typeof size?.file_id !== "string" || size.file_id.trim() === "") {
      continue;
    }
    if (largest === null || photoArea(size) > photoArea(largest)) {
      largest = size;
      continue;
    }
    if (
      photoArea(size) === photoArea(largest) &&
      Number.isSafeInteger(size.file_size) &&
      (!Number.isSafeInteger(largest.file_size) ||
        size.file_size > largest.file_size)
    ) {
      largest = size;
    }
  }
  return largest;
}

/**
 * Why a compressed photo cannot be admitted, or null when it can. Telegram
 * already re-encoded it as a JPEG, so only the size can be wrong.
 */
export function photoRefusal(size) {
  if (size === null) {
    return { reason: attachmentRefusalReasons.invalidPhoto };
  }
  if (
    Number.isSafeInteger(size.file_size) &&
    size.file_size > maximumAttachmentBytes
  ) {
    return {
      reason: attachmentRefusalReasons.declaredTooLarge,
      type: "jpeg",
      bytes: size.file_size,
    };
  }
  return null;
}

/** The durable description of an admitted image document. */
export function imageDocumentAttachment(document, origin) {
  return {
    fileIdentifier: document.file_id,
    fileUniqueIdentifier: document.file_unique_id,
    fileName:
      typeof document.file_name === "string" ? document.file_name : null,
    mimeType:
      typeof document.mime_type === "string" ? document.mime_type : null,
    fileSize: Number.isSafeInteger(document.file_size)
      ? document.file_size
      : null,
    origin,
  };
}

/** The durable description of an admitted compressed photo. */
export function photoAttachment(size, origin) {
  return {
    fileIdentifier: size.file_id,
    fileUniqueIdentifier: size.file_unique_id,
    // Telegram omits the name and the type of a compressed photo. It is a JPEG.
    fileName: "foto.jpg",
    mimeType: "image/jpeg",
    fileSize: Number.isSafeInteger(size.file_size) ? size.file_size : null,
    origin,
    width: Number.isSafeInteger(size.width) ? size.width : null,
    height: Number.isSafeInteger(size.height) ? size.height : null,
  };
}

/**
 * Bytes rendered for a person, with one decimal and never the file name. The
 * value rounds up so a file just above 20 MB never reads as exactly 20,0 MB.
 */
export function attachmentMegabytes(bytes) {
  return (Math.ceil((bytes / (1024 * 1024)) * 10) / 10)
    .toFixed(1)
    .replace(".", ",");
}

/**
 * The private trace of a refused attachment: the reason, the declared type and
 * the size when known, and never the original file name or its content.
 */
export function attachmentRefusalDetail({ reason, type, bytes }) {
  const parts = [`reason=${reason}`];
  if (type !== undefined) {
    parts.push(`type=${type}`);
  }
  if (bytes !== undefined) {
    parts.push(`bytes=${bytes}`);
  }
  return parts.join(" ");
}
