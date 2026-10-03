import { getCollection } from "astro:content";
import { fileURLToPath } from "node:url";
import {
  createPublicationCatalog,
  type ContentSource,
  type PublicationCatalog,
} from "./publication";
import { assertEventDateConsistency, getMadridDate } from "./events";
import {
  collectLocalResourcePaths,
  resolveLocalResourcePath,
} from "./resources";
import { assertUniquePublishedPaths } from "./routes";
import {
  createPublishedPostVariants,
  createPreviewPostVariants,
  type PostSource,
  type PostVariant,
} from "./posts";

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

async function getPostSource(): Promise<PostSource> {
  const [posts, events] = await Promise.all([
    getCollection("posts"),
    getCollection("events"),
  ]);
  const entries = posts.map(({ data }) => data);
  await validateLocalResources(entries);
  return {
    posts: entries,
    eventIds: new Set(events.map(({ data }) => data.id)),
  };
}

export async function getPublishedPostVariants(): Promise<PostVariant[]> {
  const today = process.env.BUILD_TODAY ?? getMadridDate(new Date());
  return createPublishedPostVariants(await getPostSource(), today);
}

export async function getPreviewPostVariants(): Promise<PostVariant[]> {
  const today = process.env.BUILD_TODAY ?? getMadridDate(new Date());
  return createPreviewPostVariants(await getPostSource(), today);
}

export async function getBuildPostVariants(): Promise<PostVariant[]> {
  if (import.meta.env.PUBLIC_PREVIEW === "true") {
    return getPreviewPostVariants();
  }
  return getPublishedPostVariants();
}
