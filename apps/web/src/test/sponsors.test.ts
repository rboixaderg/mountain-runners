import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  collectionSchemas,
  type Contact,
  type Document,
  type Entity,
  type Event,
  type ExternalAction,
  type School,
} from "../lib/content/models";
import {
  createPublicationCatalog,
  type ContentSource,
} from "../lib/content/publication";
import { getSponsorEntities } from "../lib/content/sponsors";
import { parseRestrictedYaml } from "../lib/content/yaml";

async function loadCollection<T>(directory: string, schema: z.ZodType<T>) {
  const directoryUrl = new URL(`../content/${directory}/`, import.meta.url);
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

async function loadSource(): Promise<ContentSource> {
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

describe("homepage sponsors", () => {
  it("derives sponsors from published entities marked as sponsors", async () => {
    const catalog = createPublicationCatalog(await loadSource());
    const sponsors = getSponsorEntities(catalog, "ca");

    expect(sponsors.map((entity) => entity.id)).toEqual(["vera"]);
    for (const entity of sponsors) {
      expect(entity.sponsor).toBe(true);
    }
  });

  it("excludes collaborators and the club itself", async () => {
    const catalog = createPublicationCatalog(await loadSource());
    const sponsorIds = getSponsorEntities(catalog, "ca").map(
      (entity) => entity.id,
    );

    expect(sponsorIds).not.toContain("mountain-runners");
    expect(sponsorIds).not.toContain("aina-vila");
  });

  it("excludes unpublished sponsors from the wall", async () => {
    const source = await loadSource();
    source.entities.find(({ id }) => id === "vera")!.published = false;

    const catalog = createPublicationCatalog(source);
    expect(getSponsorEntities(catalog, "ca")).toHaveLength(0);
  });
});
