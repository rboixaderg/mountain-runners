import { createBuildCache } from "./build-cache";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { imageMetadata } from "astro/assets/utils";
import { resolveLocalResourcePath } from "./resources";
import type { Document, School } from "./models";

export type ImageResource = School["cover"]["resource"];
type Resource = ImageResource | Document["resource"];

const defaultAppDirectory = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export function getResourceHref(resource: Resource): string {
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

const cacheSize = createBuildCache<
  { width: number; height: number } | undefined
>();

export function getLocalImageSize(
  resourcePath: string,
  appDirectory = defaultAppDirectory,
) {
  return cacheSize(JSON.stringify([appDirectory, resourcePath]), () =>
    readLocalImageSize(resourcePath, appDirectory),
  );
}

async function readLocalImageSize(
  resourcePath: string,
  appDirectory: string,
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
