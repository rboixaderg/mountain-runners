import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRoute } from "astro";
import { getPublishedLocalResources } from "../../lib/content/publication";
import {
  getPublicationCatalog,
  getPublishedHomepage,
} from "../../lib/content/repository";
import {
  collectLocalResourcePaths,
  resolveLocalResourcePath,
} from "../../lib/content/resources";

const contentTypes = new Map([
  [".avif", "image/avif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export async function getStaticPaths() {
  const [catalog, homepage] = await Promise.all([
    getPublicationCatalog(),
    getPublishedHomepage(),
  ]);
  const resources = collectLocalResourcePaths(
    homepage,
    new Set(getPublishedLocalResources(catalog)),
  );
  return [...resources].sort().map((sourcePath) => ({
    params: {
      resource: sourcePath.replace(/^src\//u, ""),
    },
    props: { sourcePath },
  }));
}

export const GET: APIRoute = async ({ props }) => {
  const sourcePath = props.sourcePath;
  if (typeof sourcePath !== "string") {
    return new Response("Not found", { status: 404 });
  }

  const appDirectory = fileURLToPath(new URL("../../../", import.meta.url));
  const filePath = await resolveLocalResourcePath(appDirectory, sourcePath);
  const contentType = contentTypes.get(path.extname(filePath));
  if (contentType === undefined) {
    return new Response("Unsupported resource", { status: 415 });
  }

  return new Response(await readFile(filePath), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
};
