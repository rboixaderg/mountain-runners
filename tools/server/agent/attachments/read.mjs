// Read one stored attachment for the `view_attachment` tool (T8.8).
//
// The tool runs in the Pi process, outside the container, so it reads the
// attachment copy in the worktree. The model controls that worktree through the
// sandbox and could replace a file with a symbolic link to a host file: the
// name must come from the service list, the file is opened without following a
// symbolic link, it must be a regular file under the size bound, and its image
// header is validated again before any byte reaches the model.
//
// This module must stay free of application imports and dependencies: the Pi
// profile copies it next to the sandbox extension.

import { lstatSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { detectImageType, inspectImage } from "./image-format.mjs";
import { readRegularFileNoFollow } from "./safe-read.mjs";

export const maximumViewedAttachmentBytes = 20 * 1024 * 1024;
export const viewedAttachmentNamePattern = /^imatge-\d+\.(jpg|png|webp)$/u;

const mimeTypes = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * The image of a stored attachment, or the reason it cannot be returned. The
 * caller passes the name the service listed; a free path is never accepted.
 */
export function readAttachmentImage({ directory, name, names }) {
  if (!viewedAttachmentNamePattern.test(name) || !names.includes(name)) {
    return { refusal: "unknown_name" };
  }
  const root = resolve(directory);
  // The model controls the worktree: the attachment directory itself must be a
  // real directory, never a symbolic link that redirects the whole lookup.
  try {
    if (!lstatSync(root).isDirectory()) {
      return { refusal: "unreadable" };
    }
  } catch {
    return { refusal: "unreadable" };
  }
  const target = resolve(join(root, name));
  if (!target.startsWith(`${root}${sep}`)) {
    return { refusal: "unknown_name" };
  }

  const bytes = readRegularFileNoFollow(target, maximumViewedAttachmentBytes);
  if (bytes === null) {
    return { refusal: "unreadable" };
  }

  const type = detectImageType(bytes);
  const inspected = inspectImage(bytes);
  if (
    type === null ||
    inspected === null ||
    inspected.type !== type ||
    inspected.hasMetadata
  ) {
    return { refusal: "invalid_image" };
  }
  return {
    image: {
      type,
      mimeType: mimeTypes[type],
      width: inspected.width,
      height: inspected.height,
      bytes,
    },
  };
}
