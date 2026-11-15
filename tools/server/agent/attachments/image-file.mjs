// Validation of an admitted image attachment (T8.4).
//
// The bytes are the authority: the container is detected from its signature and
// must match the declared extension and MIME type, the dimensions are read from
// the headers, and the metadata containers are removed. Nothing is resized or
// re-encoded, so a file above a limit is refused with its real size and
// dimensions instead of being silently changed.
//
// The accepted table and the byte limit come from the bridge, which applies the
// same contract to the declared metadata at admission.

import {
  acceptedImageDocuments,
  fileNameExtension,
  maximumAttachmentBytes,
} from "telegram-pi-bridge/telegram";
import {
  detectImageType,
  inspectImage,
  stripImageMetadata,
} from "./image-format.mjs";
import { attachmentRefusalReasons } from "./refusals.mjs";

// A long side above this needs a different export, not a larger image.
export const maximumAttachmentLongSide = 2400;

function matchesDeclaredType(documentType, { fileName, mimeType }) {
  const extension = fileNameExtension(fileName);
  const declaredMimeType =
    typeof mimeType === "string" ? mimeType.toLowerCase() : null;
  return (
    extension !== null &&
    documentType.extensions.includes(extension) &&
    declaredMimeType === documentType.mimeType
  );
}

/**
 * The cleaned image, or the reason to refuse it. A fake type is a container
 * that does not match the declared extension or MIME type; a damaged image is
 * one whose structure cannot be parsed or whose cleaned result does not keep
 * the same image without metadata.
 */
export function prepareImageAttachment({ bytes, fileName, mimeType }) {
  const byteSize = bytes.length;
  if (byteSize > maximumAttachmentBytes) {
    return {
      refusal: { reason: attachmentRefusalReasons.tooLarge, bytes: byteSize },
    };
  }
  const type = detectImageType(bytes);
  if (type === null) {
    return {
      refusal: {
        reason: attachmentRefusalReasons.unsupportedType,
        bytes: byteSize,
      },
    };
  }
  const documentType = acceptedImageDocuments.find(
    (entry) => entry.type === type,
  );
  if (!matchesDeclaredType(documentType, { fileName, mimeType })) {
    return {
      refusal: {
        reason: attachmentRefusalReasons.fakeType,
        type,
        bytes: byteSize,
      },
    };
  }
  const inspected = inspectImage(bytes);
  if (inspected === null) {
    return {
      refusal: {
        reason: attachmentRefusalReasons.damagedImage,
        type,
        bytes: byteSize,
      },
    };
  }
  if (
    inspected.width > maximumAttachmentLongSide ||
    inspected.height > maximumAttachmentLongSide
  ) {
    return {
      refusal: {
        reason: attachmentRefusalReasons.dimensionsAboveLimit,
        type,
        width: inspected.width,
        height: inspected.height,
        bytes: byteSize,
      },
    };
  }
  let cleaned;
  try {
    cleaned = stripImageMetadata(bytes, type);
  } catch {
    return {
      refusal: {
        reason: attachmentRefusalReasons.damagedImage,
        type,
        bytes: byteSize,
      },
    };
  }
  const verified = inspectImage(cleaned);
  if (
    verified === null ||
    verified.type !== type ||
    verified.width !== inspected.width ||
    verified.height !== inspected.height ||
    verified.hasMetadata
  ) {
    return {
      refusal: {
        reason: attachmentRefusalReasons.damagedImage,
        type,
        bytes: byteSize,
      },
    };
  }
  return {
    image: {
      type,
      mimeType: documentType.mimeType,
      extension: documentType.canonicalExtension,
      width: inspected.width,
      height: inspected.height,
      bytes: cleaned,
    },
  };
}
