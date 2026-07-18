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

process.env.PUBLIC_SITE_ORIGIN ??= "https://mountainrunners.cat";

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

function addTranslations(value: unknown, locale: "es" | "en"): void {
  if (Array.isArray(value)) {
    value.forEach((item) => addTranslations(item, locale));
    return;
  }

  if (value === null || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if (typeof record.ca === "string") {
    record[locale] = `${locale} translation for ${record.ca}`;
  }
  Object.values(record).forEach((item) => addTranslations(item, locale));
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

  it("uses localized paths and alternates for complete translations only", async () => {
    const source = await loadSource();
    addTranslations(source, "es");
    addTranslations(source, "en");
    source.schools[0]!.slug.es = "escuela-trail";
    source.schools[0]!.slug.en = "trail-school";
    source.events[0]!.slug.es = "jornada-montana";
    source.events[0]!.slug.en = "mountain-day";

    const completeCatalog = createPublicationCatalog(source);
    expect(
      completeCatalog.variants.map((variant) => getVariantPath(variant)),
    ).toEqual([
      "/ca/escoles/escola-trail/",
      "/ca/esdeveniments/jornada-muntanya/",
      "/es/escuelas/escuela-trail/",
      "/es/eventos/jornada-montana/",
      "/en/schools/trail-school/",
      "/en/events/mountain-day/",
    ]);

    const spanishEvent = completeCatalog.variants.find(
      ({ kind, locale }) => kind === "event" && locale === "es",
    )!;
    expect(getAlternateUrls(completeCatalog, spanishEvent)).toEqual([
      {
        locale: "ca",
        href: "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
      },
      {
        locale: "es",
        href: "https://mountainrunners.cat/es/eventos/jornada-montana/",
      },
      {
        locale: "en",
        href: "https://mountainrunners.cat/en/events/mountain-day/",
      },
    ]);

    delete (source.events[0]!.title as { en?: string }).en;
    const incompleteCatalog = createPublicationCatalog(source);
    expect(
      incompleteCatalog.variants.map((variant) => getVariantPath(variant)),
    ).not.toContain("/en/events/mountain-day/");
    expect(getSitemapUrls(incompleteCatalog)).not.toContain(
      "https://mountainrunners.cat/en/events/mountain-day/",
    );
    expect(
      getAlternateUrls(
        incompleteCatalog,
        incompleteCatalog.variants.find(
          ({ kind, locale }) => kind === "event" && locale === "es",
        )!,
      ),
    ).not.toContainEqual({
      locale: "en",
      href: "https://mountainrunners.cat/en/events/mountain-day/",
    });
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
