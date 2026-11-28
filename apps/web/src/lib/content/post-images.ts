import { createBuildCache } from "./build-cache";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { resolveLocalResourcePath } from "./resources";

export const postImageWidths = [480, 1200] as const;
export type PostImageWidth = (typeof postImageWidths)[number];

export function getPostImagePath(
  sourcePath: string,
  width: PostImageWidth,
): string {
  return `${width}/${sourcePath.replace(/^src\//u, "")}.webp`;
}

export function getPostImageHref(
  sourcePath: string,
  width: PostImageWidth,
): string {
  return `/editorial-images/${getPostImagePath(sourcePath, width)}`;
}

const cacheTransform =
  createBuildCache<Awaited<ReturnType<typeof encodePostImage>>>();

export function transformPostImage(sourcePath: string, width: PostImageWidth) {
  return cacheTransform(JSON.stringify([sourcePath, width]), () =>
    encodePostImage(sourcePath, width),
  );
}

async function encodePostImage(sourcePath: string, width: PostImageWidth) {
  const appDirectory = fileURLToPath(new URL("../../../", import.meta.url));
  const filePath = await resolveLocalResourcePath(appDirectory, sourcePath);
  return sharp(filePath)
    .autoOrient()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
}
