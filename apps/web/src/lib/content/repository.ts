import { getCollection } from "astro:content";
import { fileURLToPath } from "node:url";
import {
  createPublicationCatalog,
  type ContentSource,
  type PublicationCatalog,
} from "./publication";
import {
  collectLocalResourcePaths,
  resolveLocalResourcePath,
} from "./resources";
import { assertUniquePublishedPaths } from "./routes";

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
  const [schools, events, entities, documents] = await Promise.all([
    getCollection("schools"),
    getCollection("events"),
    getCollection("entities"),
    getCollection("documents"),
  ]);
  const source: ContentSource = {
    schools: schools.map(({ data }) => data),
    events: events.map(({ data }) => data),
    entities: entities.map(({ data }) => data),
    documents: documents.map(({ data }) => data),
  };
  await validateLocalResources(source);
  const catalog = createPublicationCatalog(source);
  assertUniquePublishedPaths(catalog);
  return catalog;
}
