// Loads the real editorial content from disk and validates it with the same
// restricted YAML loader and Zod schemas the build uses, so tests assert
// against the published artifact instead of hand-written fixtures.
//
// `getPublicationCatalog` reads through `astro:content` and only exists inside
// an Astro build, so tests and E2E reuse this module-level loader instead.

import { readFile, readdir } from "node:fs/promises";
import type { z } from "zod";
import { getMadridDate } from "../../lib/content/events";
import {
  collectionSchemas,
  type Contact,
  type Document,
  type Entity,
  type Event,
  type ExternalAction,
  type School,
} from "../../lib/content/models";
import {
  createPublicationCatalog,
  type ContentSource,
  type PublicationCatalog,
} from "../../lib/content/publication";
import { parseRestrictedYaml } from "../../lib/content/yaml";

async function loadCollection<T>(directory: string, schema: z.ZodType<T>) {
  const directoryUrl = new URL(`../../content/${directory}/`, import.meta.url);
  const files = (await readdir(directoryUrl))
    .filter((file) => file.endsWith(".yaml"))
    .sort();
  return Promise.all(
    files.map(async (file) =>
      parseRestrictedYaml(
        await readFile(new URL(file, directoryUrl), "utf8"),
        schema,
      ),
    ),
  );
}

export async function loadContentSource(): Promise<ContentSource> {
  const [schools, events, entities, documents, externalActions, contact] =
    await Promise.all([
      loadCollection<School>("schools", collectionSchemas.schools),
      loadCollection<Event>("events", collectionSchemas.events),
      loadCollection<Entity>("entities", collectionSchemas.entities),
      loadCollection<Document>("documents", collectionSchemas.documents),
      loadCollection<ExternalAction>(
        "external-actions",
        collectionSchemas.externalActions,
      ),
      loadCollection<Contact>("contact", collectionSchemas.contact),
    ]);
  return { schools, events, entities, documents, externalActions, contact };
}

// The reference date the build used, so status and date expectations never
// depend on the day a test happens to run.
export function buildToday(): string {
  return process.env.BUILD_TODAY ?? getMadridDate(new Date());
}

export async function loadPublicationCatalog(): Promise<PublicationCatalog> {
  return createPublicationCatalog(await loadContentSource());
}
