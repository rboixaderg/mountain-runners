// Image documents sent to a topic.
//
// A compressed photo is refused: Telegram has already re-encoded it and the
// bridge never re-encodes. The declared type and file size are checked here, so
// an unsupported or oversized file is answered when it arrives instead of
// occupying the queue. The real bytes are validated by the application when the
// instruction runs: downloading at admission would keep the file before anyone
// uses it.
//
// This table is the shared contract between admission and that later
// validation, which compares the real bytes with the declared extension and
// MIME type.

export const maximumAttachmentBytes = 2 * 1024 * 1024;

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

/** Where the document of an instruction comes from. */
export const attachmentOrigins = {
  message: "message",
  reply: "reply",
};

export const attachmentRefusalReasons = {
  photo: "photo",
  unsupportedDocument: "unsupported_document",
  declaredTooLarge: "declared_too_large",
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
export function declaredImageDocument(document) {
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

/** The durable description of an admitted attachment. */
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

/** Bytes rendered for a person, with one decimal and never the file name. */
export function attachmentMegabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
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
