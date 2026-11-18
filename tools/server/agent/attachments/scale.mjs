// Downscaling of a stored image inside the sandbox (T8.8).
//
// Reading the pixels of an untrusted image must not happen in the trusted
// service process. The service stages the header-cleaned bytes in the ignored
// attachment directory of the worktree, a short Node script inside the existing
// container decodes them with the `sharp` that the repository already installs
// offline, and the trusted process reads the result back. Nothing is trusted
// from the container: the output is re-validated with the header parser before
// it is stored or shown to the model.

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { removeAttachmentDirectory } from "./destination.mjs";
import { detectImageType, inspectImage } from "./image-format.mjs";
import { maximumAttachmentLongSide } from "./image-file.mjs";
import { attachmentRefusalReasons } from "./refusals.mjs";
import { readRegularFileNoFollow } from "./safe-read.mjs";

export const attachmentScaleDirectoryName = ".scaling";
export const maximumScaleOutputBytes = 20 * 1024 * 1024;

const scaleScript = `
import { createRequire } from "node:module";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/work/apps/web/package.json");
const sharp = require("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const input = join(here, "in");
const output = join(here, "out");
await mkdir(output, { recursive: true });
for (const name of await readdir(input)) {
  const source = join(input, name);
  const info = await sharp(source).metadata();
  if (Math.max(info.width, info.height) <= ${maximumAttachmentLongSide}) {
    await copyFile(source, join(output, name));
    continue;
  }
  const pipeline = sharp(source)
    .rotate()
    .resize({
      width: ${maximumAttachmentLongSide},
      height: ${maximumAttachmentLongSide},
      fit: "inside",
      withoutEnlargement: true,
    });
  const destination = join(output, name);
  if (info.format === "png") {
    await pipeline.png({ compressionLevel: 9 }).toFile(destination);
  } else if (info.format === "webp") {
    await pipeline.webp({ quality: 82 }).toFile(destination);
  } else {
    await pipeline.jpeg({ quality: 82 }).toFile(destination);
  }
}
`;

/** Whether an image needs the sandbox to decode and downscale its pixels. */
export function needsDownscale({ width, height }) {
  return (
    width > maximumAttachmentLongSide || height > maximumAttachmentLongSide
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
  const relativeScript = scriptPath.slice(worktreePath.length + 1);
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
      outputIsDirectory =
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
        inspected.height > maximumAttachmentLongSide
      ) {
        // The container failed to produce a usable reduction of a valid image.
        return { refusal: { reason: attachmentRefusalReasons.scaleFailed } };
      }
      scaled.push({
        ...image,
        bytes,
        width: inspected.width,
        height: inspected.height,
      });
    }
    return { images: scaled };
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
    try {
      if (readdirSync(attachmentDirectory).length === 0) {
        rmSync(attachmentDirectory, { recursive: true, force: true });
      }
    } catch {
      // A directory the model removed meanwhile is already the wanted state.
    }
  }
}
