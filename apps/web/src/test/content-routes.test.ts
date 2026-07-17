import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  collectionSchemas,
  type Document,
  type Entity,
  type Event,
  type School,
} from "../lib/content/models";
import {
  createPublicationCatalog,
  type ContentSource,
} from "../lib/content/publication";
import {
  assertRouteDomains,
  createPublicSiteOrigin,
  getAlternateUrls,
  getCanonicalUrl,
  getSitemapUrls,
  getVariantPath,
  routeDomains,
} from "../lib/content/routes";
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
  const [schools, events, entities, documents] = await Promise.all([
    loadCollection<School>("schools", collectionSchemas.schools),
    loadCollection<Event>("events", collectionSchemas.events),
    loadCollection<Entity>("entities", collectionSchemas.entities),
    loadCollection<Document>("documents", collectionSchemas.documents),
  ]);
  return { schools, events, entities, documents };
}

describe("localized route contract", () => {
  it("uses localized domains and absolute canonical URLs", async () => {
    const catalog = createPublicationCatalog(await loadSource());
    const school = catalog.variants.find(({ kind }) => kind === "school")!;
    const event = catalog.variants.find(({ kind }) => kind === "event")!;

    expect(getVariantPath(school)).toBe("/ca/escoles/escola-trail/");
    expect(getVariantPath(event)).toBe("/ca/esdeveniments/jornada-muntanya/");
    expect(getCanonicalUrl(event)).toBe(
      "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
    );
    expect(getAlternateUrls(catalog, event)).toEqual([
      {
        locale: "ca",
        href: "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
      },
    ]);
  });

  it("includes only published routes in the sitemap", async () => {
    const catalog = createPublicationCatalog(await loadSource());

    expect(getSitemapUrls(catalog)).toEqual([
      "https://mountainrunners.cat/ca/",
      "https://mountainrunners.cat/ca/escoles/escola-trail/",
      "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
    ]);
  });

  it("rejects reserved and colliding route domains", () => {
    const duplicate = structuredClone(routeDomains);
    duplicate.event.ca = "escoles";
    expect(() => assertRouteDomains(duplicate)).toThrow(
      "Duplicate ca route domain: escoles",
    );

    const reserved = structuredClone(routeDomains);
    reserved.event.ca = "api";
    expect(() => assertRouteDomains(reserved)).toThrow(
      "Reserved ca event route domain: api",
    );
  });

  it("accepts only the approved HTTPS canonical origin", () => {
    expect(
      createPublicSiteOrigin("https://mountainrunners.cat").toString(),
    ).toBe("https://mountainrunners.cat/");

    for (const value of [
      "http://mountainrunners.cat",
      "https://www.mountainrunners.cat",
      "https://user:pass@mountainrunners.cat",
      "https://mountainrunners.cat/path",
      "https://mountainrunners.cat?query=value",
      "https://mountainrunners.cat#fragment",
      "https://mountainrunners.cat/%0a",
      " https://mountainrunners.cat",
      "//mountainrunners.cat",
    ]) {
      expect(() => createPublicSiteOrigin(value)).toThrow();
    }
  });
});
