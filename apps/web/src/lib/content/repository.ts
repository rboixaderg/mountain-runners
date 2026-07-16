import { getCollection } from "astro:content";
import { fileURLToPath } from "node:url";
import {
  createPublicationCatalog,
  type ContentSource,
  type PublicationCatalog,
} from "./publication";
import { resolveLocalResourcePath } from "./resources";

function collectLocalResourcePaths(value: unknown, paths = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectLocalResourcePaths(item, paths);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "local" && typeof record.path === "string") {
      paths.add(record.path);
    }
    for (const item of Object.values(record)) {
      collectLocalResourcePaths(item, paths);
    }
  }
  return paths;
}

async function validateLocalResources(source: ContentSource): Promise<void> {
  const appDirectory = fileURLToPath(new URL("../../../", import.meta.url));
  const paths = collectLocalResourcePaths(source);
  await Promise.all(
    [...paths].map((resourcePath) =>
      resolveLocalResourcePath(appDirectory, resourcePath),
    ),
  );
}

export async function getPublicationCatalog(): Promise<PublicationCatalog> {
  const [site, pages, schools, events, entities, documents] = await Promise.all(
    [
      getCollection("site"),
      getCollection("pages"),
      getCollection("schools"),
      getCollection("events"),
      getCollection("entities"),
      getCollection("documents"),
    ],
  );
  const source: ContentSource = {
    site: site.map(({ data }) => data),
    pages: pages.map(({ data }) => data),
    schools: schools.map(({ data }) => data),
    events: events.map(({ data }) => data),
    entities: entities.map(({ data }) => data),
    documents: documents.map(({ data }) => data),
  };
  await validateLocalResources(source);
  return createPublicationCatalog(source);
}
