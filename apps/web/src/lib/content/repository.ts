import { getCollection } from "astro:content";
import { fileURLToPath } from "node:url";
import { assertEventDateConsistency, getMadridDate } from "./events";
import {
  type ContentSource,
  createPublicationCatalog,
  type PublicationCatalog,
} from "./publication";
import {
  collectLocalResourcePaths,
  resolveLocalResourcePath,
} from "./resources";
import { assertUniquePublishedPaths } from "./routes";

async function validateLocalResources(source: unknown): Promise<void> {
  const appDirectory = fileURLToPath(new URL("../../../", import.meta.url));
  const paths = collectLocalResourcePaths(source);
  await Promise.all(
    [...paths].map((resourcePath) =>
      resolveLocalResourcePath(appDirectory, resourcePath),
    ),
  );
}

export async function getPublicationCatalog(): Promise<PublicationCatalog> {
  const [schools, events, entities, documents, externalActions, contact] =
    await Promise.all([
      getCollection("schools"),
      getCollection("events"),
      getCollection("entities"),
      getCollection("documents"),
      getCollection("externalActions"),
      getCollection("contact"),
    ]);
  const source: ContentSource = {
    schools: schools.map(({ data }) => data),
    events: events.map(({ data }) => data),
    entities: entities.map(({ data }) => data),
    documents: documents.map(({ data }) => data),
    externalActions: externalActions.map(({ data }) => data),
    contact: contact.map(({ data }) => data),
  };
  const today = process.env.BUILD_TODAY ?? getMadridDate(new Date());
  assertEventDateConsistency(source.events, today);
  await validateLocalResources(source);
  const catalog = createPublicationCatalog(source);
  assertUniquePublishedPaths(catalog);
  return catalog;
}
