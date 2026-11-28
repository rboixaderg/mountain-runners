import { createBuildCache } from "./build-cache";
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

const cacheCatalog = createBuildCache<PublicationCatalog>();
const cachePostVariants = createBuildCache<PostVariant[]>();

function publicationDate(): string {
  return process.env.BUILD_TODAY ?? getMadridDate(new Date());
}

export function getPublicationCatalog(): Promise<PublicationCatalog> {
  const today = publicationDate();
  const preview = import.meta.env.PUBLIC_PREVIEW === "true";
  return cacheCatalog(JSON.stringify([today, preview]), () =>
    loadCatalog(today),
  );
}

async function loadCatalog(today: string): Promise<PublicationCatalog> {
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
  assertEventDateConsistency(source.events, today);
  await validateLocalResources(source);
  const catalog = createPublicationCatalog(source);
  assertUniquePublishedPaths(catalog);
  return catalog;
}

async function loadPostSource(): Promise<PostSource> {
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

function getPostVariants(preview: boolean): Promise<PostVariant[]> {
  const today = publicationDate();
  const key = JSON.stringify([today, preview]);
  return cachePostVariants(key, async () => {
    const source = await loadPostSource();
    return preview
      ? createPreviewPostVariants(source, today)
      : createPublishedPostVariants(source, today);
  });
}

export function getPublishedPostVariants(): Promise<PostVariant[]> {
  return getPostVariants(false);
}

export function getPreviewPostVariants(): Promise<PostVariant[]> {
  return getPostVariants(true);
}

export function getBuildPostVariants(): Promise<PostVariant[]> {
  return import.meta.env.PUBLIC_PREVIEW === "true"
    ? getPreviewPostVariants()
    : getPublishedPostVariants();
}
