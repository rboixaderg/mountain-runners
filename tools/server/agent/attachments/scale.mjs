// Downscaling of a stored image inside the sandbox (T8.8).
//
// Reading the pixels of an untrusted image must not happen in the trusted
// service process. The service stages the header-cleaned bytes in the ignored
// attachment directory of the worktree, a short Node script inside the existing
// container decodes them with the `sharp` that the repository already installs
// offline, and the trusted process reads the result back. Nothing is trusted
// from the container: the output is re-validated with the header parser before
// it is stored or shown to the model.
//
// The metadata stripper removed the EXIF container, so the orientation travels
// as service data in a manifest next to the staged bytes and the script applies
// it explicitly. The re-encoded image must also stay within the Git object
// budget the secret scan enforces, or an admitted photo could make the
// publication fail at push time.

import { lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { removeAttachmentDirectory } from "./destination.mjs";
import {
  defaultExifOrientation,
  exifOrientations,
} from "./exif-orientation.mjs";
import { detectImageType, inspectImage } from "./image-format.mjs";
import { maximumAttachmentLongSide } from "./image-file.mjs";
import { attachmentRefusalReasons } from "./refusals.mjs";
import { readRegularFileNoFollow } from "./safe-read.mjs";

export const attachmentScaleDirectoryName = ".scaling";
export const maximumScaleOutputBytes = 20 * 1024 * 1024;
// The same limit the secret scan applies to a Git object: an image above it
// would never reach the public repository.
export const maximumGitObjectBytes = 2 * 1024 * 1024;

const scaleScript = `
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/work/apps/web/package.json");
const sharp = require("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const input = join(here, "in");
const output = join(here, "out");
const maximumLongSide = ${maximumAttachmentLongSide};
const maximumBytes = ${maximumGitObjectBytes};
await mkdir(output, { recursive: true });
const manifest = JSON.parse(
  await readFile(join(here, "manifest.json"), "utf8"),
);

// The orientation is applied by hand: the EXIF container is already gone, so
// sharp cannot read it from the image. The pairs of rotation and mirror match
// what sharp's own EXIF handling produces.
function orient(image, orientation) {
  if (orientation === 2) return image.flop();
  if (orientation === 3) return image.rotate(180);
  if (orientation === 4) return image.flip();
  if (orientation === 5) return image.rotate(270).flop();
  if (orientation === 6) return image.rotate(90);
  if (orientation === 7) return image.rotate(90).flop();
  if (orientation === 8) return image.rotate(270);
  return image;
}

// The dimensions the person sees once the orientation is applied.
function displaySize(info, orientation) {
  const swapsSides = orientation >= 5 && orientation <= 8;
  const width = swapsSides ? info.height : info.width;
  const height = swapsSides ? info.width : info.height;
  const factor = Math.min(1, maximumLongSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

function resized(image, size) {
  return image.clone().resize({
    width: size.width,
    height: size.height,
    fit: "inside",
    withoutEnlargement: true,
  });
}

async function encode(image, format, size) {
  if (format === "png") {
    const lossless = await resized(image, size)
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (lossless.length <= maximumBytes) return lossless;
    // A photographic PNG rarely fits the Git object budget losslessly: a
    // palette keeps the format and the pixels the person sent.
    return resized(image, size)
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
  }
  const encodeLossy =
    format === "webp"
      ? (pipeline, quality) => pipeline.webp({ quality }).toBuffer()
      : (pipeline, quality) => pipeline.jpeg({ quality }).toBuffer();
  let bytes = null;
  for (const quality of [82, 70, 60, 50, 40]) {
    bytes = await encodeLossy(resized(image, size), quality);
    if (bytes.length <= maximumBytes) break;
  }
  return bytes;
}

for (const { name, orientation } of manifest) {
  const source = join(input, name);
  const destination = join(output, name);
  const info = await sharp(source).metadata();
  const unchanged =
    orientation === 1 &&
    Math.max(info.width, info.height) <= maximumLongSide &&
    (await stat(source)).size <= maximumBytes;
  if (unchanged) {
    await copyFile(source, destination);
    continue;
  }
  const image = orient(sharp(source), orientation);
  const target = displaySize(info, orientation);
  let size = target;
  let bytes = await encode(image, info.format, size);
  // A budget overrun keeps the image visible by reducing its dimensions; the
  // trusted process refuses anything that still does not fit.
  for (let factor = 0.85; bytes.length > maximumBytes && factor >= 0.2; factor *= 0.85) {
    size = {
      width: Math.max(1, Math.round(target.width * factor)),
      height: Math.max(1, Math.round(target.height * factor)),
    };
    bytes = await encode(image, info.format, size);
  }
  await writeFile(destination, bytes);
}
`;

/** The orientation the manifest reports, or the neutral one. */
function manifestOrientation(image) {
  return exifOrientations.includes(image.orientation)
    ? image.orientation
    : defaultExifOrientation;
}

/** Whether an image needs the sandbox to decode, rotate and downscale it. */
export function needsDownscale({ width, height, orientation = 1, bytes }) {
  return (
    width > maximumAttachmentLongSide ||
    height > maximumAttachmentLongSide ||
    orientation !== defaultExifOrientation ||
    (bytes !== undefined && bytes.length > maximumGitObjectBytes)
  );
}

/**
 * The sandbox command that installs the offline dependencies and runs the
 * downscale script. The script lives in a fresh directory the trusted process
 * created inside the worktree, so the model never wrote it.
 */
export function buildScaleCommand({
  worktreePath,
  stagingDirectory,
  prepareCommand = null,
}) {
  const scriptPath = join(stagingDirectory, "scale.mjs");
  const relativeScript = relative(worktreePath, scriptPath)
    .split(sep)
    .join("/");
  const steps = [];
  if (prepareCommand !== null) {
    steps.push(prepareCommand);
  }
  steps.push(`cd /work/apps/web && node /work/${relativeScript}`);
  return ["bash", "-lc", steps.join(" && ")];
}

/**
 * Stage the images that need downscaling, run the sandbox and re-validate every
 * output. Returns the image list with the new bytes, or a refusal.
 */
export async function scaleImageAttachments({
  images,
  worktreePath,
  execute,
  prepareCommand = null,
  signal,
}) {
  // The model controls the worktree: a symbolic link where the directory
  // belongs is removed instead of followed.
  removeAttachmentDirectory({ worktreePath });
  const attachmentDirectory = join(worktreePath, ".agent-attachments");
  mkdirSync(attachmentDirectory, { mode: 0o755 });
  try {
    if (!lstatSync(attachmentDirectory).isDirectory()) {
      return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
    }
  } catch {
    return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
  }
  const stagingDirectory = mkdtempSync(
    join(attachmentDirectory, `${attachmentScaleDirectoryName}-`),
  );
  const inputDirectory = join(stagingDirectory, "in");
  const outputDirectory = join(stagingDirectory, "out");
  mkdirSync(inputDirectory, { mode: 0o700 });
  try {
    const staged = images.map((image, index) => {
      const name = `scale-${index}${image.extension}`;
      writeFileSync(join(inputDirectory, name), image.bytes, { mode: 0o600 });
      return { image, name };
    });
    writeFileSync(
      join(stagingDirectory, "manifest.json"),
      `${JSON.stringify(
        staged.map(({ image, name }) => ({
          name,
          orientation: manifestOrientation(image),
        })),
      )}\n`,
      { mode: 0o600 },
    );
    writeFileSync(join(stagingDirectory, "scale.mjs"), scaleScript, {
      mode: 0o600,
    });

    const result = await execute(
      buildScaleCommand({ worktreePath, stagingDirectory, prepareCommand }),
      { signal },
    );
    if (result?.timedOut) {
      return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
    }
    if (result?.exitCode !== 0) {
      return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
    }

    let outputIsDirectory = false;
    try {
      // The sandbox controls the worktree: every directory on the way to the
      // output must still be a real directory, never a symbolic link that
      // redirects the read.
      outputIsDirectory =
        lstatSync(attachmentDirectory).isDirectory() &&
        lstatSync(stagingDirectory).isDirectory() &&
        lstatSync(outputDirectory).isDirectory();
    } catch {
      outputIsDirectory = false;
    }
    if (!outputIsDirectory) {
      return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
    }

    const scaled = [];
    for (const { image, name } of staged) {
      const bytes = readRegularFileNoFollow(
        join(outputDirectory, name),
        maximumScaleOutputBytes,
      );
      if (bytes === null) {
        return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
      }
      const type = detectImageType(bytes);
      const inspected = inspectImage(bytes);
      if (
        type === null ||
        type !== image.type ||
        inspected === null ||
        inspected.hasMetadata ||
        inspected.width > maximumAttachmentLongSide ||
        inspected.height > maximumAttachmentLongSide ||
        bytes.length > maximumGitObjectBytes
      ) {
        // The container failed to produce a usable reduction of a valid image.
        return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
      }
      scaled.push({
        ...image,
        bytes,
        width: inspected.width,
        height: inspected.height,
        orientation: defaultExifOrientation,
      });
    }
    return { images: scaled };
  } finally {
    removeAttachmentDirectory({ worktreePath });
  }
}
