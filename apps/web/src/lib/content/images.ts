import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { imageMetadata } from "astro/assets/utils";
import { resolveLocalResourcePath } from "./resources";
import type { Document, School } from "./models";

export type ImageResource = School["cover"]["resource"];

const defaultAppDirectory = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export function getResourceHref(resource: ImageResource): string {
  return resource.kind === "local"
    ? `/content-resources/${resource.path.replace(/^src\//u, "")}`
    : resource.url;
}

export function getDocumentHref(
  document: Document | undefined,
): string | undefined {
  return document?.availability === "available"
    ? getResourceHref(document.resource)
    : undefined;
}

export async function getLocalImageSize(
  resourcePath: string,
  appDirectory = defaultAppDirectory,
): Promise<{ width: number; height: number } | undefined> {
  try {
    const filePath = await resolveLocalResourcePath(appDirectory, resourcePath);
    const metadata = await imageMetadata(
      new Uint8Array(await readFile(filePath)),
    );
    return { width: metadata.width, height: metadata.height };
  } catch {
    return undefined;
  }
}
