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
import {
  assertFixedPageRouteSegments,
  assertRouteDomains,
  fixedPageRouteSegments,
  getFixedPagePath,
  getLocalizedAlternatives,
  getCanonicalUrl,
  getPublicDetailVariants,
  getSitemapUrls,
  getVariantPath,
  routeDomains,
} from "../lib/content/routes";
import { parseRestrictedYaml } from "../lib/content/yaml";

const publicSiteOrigin = new URL("https://mountainrunners.cat");

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
  for (const event of events) {
    event.published = event.id === "mountain-day";
  }
  return { schools, events, entities, documents, externalActions, contact };
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
    const school = catalog.variants.find(
      ({ kind, entry }) => kind === "school" && entry.id === "trail-school",
    )!;
    const event = catalog.variants.find(({ kind }) => kind === "event")!;

    expect(getVariantPath(school)).toBe("/ca/escoles/escola-trail/");
    expect(getVariantPath(event)).toBe("/ca/esdeveniments/jornada-muntanya/");
    expect(getCanonicalUrl(event, publicSiteOrigin)).toBe(
      "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
    );
    expect(getLocalizedAlternatives(catalog, event, publicSiteOrigin)).toEqual([
      {
        locale: "ca",
        href: "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
      },
    ]);
  });

  it("keeps unpublished content out of available detail routes and sitemap", async () => {
    const catalog = createPublicationCatalog(await loadSource());

    expect(
      getPublicDetailVariants(catalog).map((variant) =>
        getVariantPath(variant),
      ),
    ).toEqual([
      "/ca/escoles/escola-btt/",
      "/ca/escoles/escola-skimo/",
      "/ca/escoles/escola-trail/",
      "/ca/esdeveniments/jornada-muntanya/",
    ]);
    expect(getSitemapUrls(catalog, publicSiteOrigin)).toEqual([
      "https://mountainrunners.cat/ca/",
      "https://mountainrunners.cat/ca/avis-legal/",
      "https://mountainrunners.cat/ca/contacte/",
      "https://mountainrunners.cat/ca/cookies/",
      "https://mountainrunners.cat/ca/documents/",
      "https://mountainrunners.cat/ca/escoles/",
      "https://mountainrunners.cat/ca/escoles/escola-btt/",
      "https://mountainrunners.cat/ca/escoles/escola-skimo/",
      "https://mountainrunners.cat/ca/escoles/escola-trail/",
      "https://mountainrunners.cat/ca/esdeveniments/",
      "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
      "https://mountainrunners.cat/ca/privacitat/",
      "https://mountainrunners.cat/ca/qui-som/",
      "https://mountainrunners.cat/ca/socis/",
    ]);
  });

  it("uses localized paths and alternates for complete translations only", async () => {
    const source = await loadSource();
    addTranslations(source, "es");
    addTranslations(source, "en");
    source.schools[0]!.slug.es = "escuela-btt";
    source.schools[0]!.slug.en = "btt-school";
    source.schools[1]!.slug.es = "escuela-skimo";
    source.schools[1]!.slug.en = "skimo-school";
    source.schools[2]!.slug.es = "escuela-trail";
    source.schools[2]!.slug.en = "trail-school";
    const mountainDay = source.events.find(({ id }) => id === "mountain-day")!;
    mountainDay.slug.es = "jornada-montana";
    mountainDay.slug.en = "mountain-day";

    const completeCatalog = createPublicationCatalog(source);
    expect(
      completeCatalog.variants.map((variant) => getVariantPath(variant)),
    ).toEqual([
      "/ca/escoles/escola-btt/",
      "/ca/escoles/escola-skimo/",
      "/ca/escoles/escola-trail/",
      "/ca/esdeveniments/jornada-muntanya/",
      "/es/escuelas/escuela-btt/",
      "/es/escuelas/escuela-skimo/",
      "/es/escuelas/escuela-trail/",
      "/es/eventos/jornada-montana/",
      "/en/schools/btt-school/",
      "/en/schools/skimo-school/",
      "/en/schools/trail-school/",
      "/en/events/mountain-day/",
    ]);

    const spanishEvent = completeCatalog.variants.find(
      ({ kind, locale }) => kind === "event" && locale === "es",
    )!;
    expect(
      getLocalizedAlternatives(completeCatalog, spanishEvent, publicSiteOrigin),
    ).toEqual([
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

    expect(getSitemapUrls(completeCatalog, publicSiteOrigin)).toEqual(
      expect.arrayContaining([
        "https://mountainrunners.cat/ca/esdeveniments/",
        "https://mountainrunners.cat/es/eventos/",
        "https://mountainrunners.cat/en/events/",
      ]),
    );

    delete (mountainDay.title as { en?: string }).en;
    const incompleteCatalog = createPublicationCatalog(source);
    expect(
      incompleteCatalog.variants.map((variant) => getVariantPath(variant)),
    ).not.toContain("/en/events/mountain-day/");
    expect(getSitemapUrls(incompleteCatalog, publicSiteOrigin)).not.toContain(
      "https://mountainrunners.cat/en/events/mountain-day/",
    );
    expect(
      getLocalizedAlternatives(
        incompleteCatalog,
        incompleteCatalog.variants.find(
          ({ kind, locale }) => kind === "event" && locale === "es",
        )!,
        publicSiteOrigin,
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

    const fixedRoute = structuredClone(routeDomains);
    fixedRoute.event.ca = "ca";
    expect(() => assertRouteDomains(fixedRoute)).toThrow(
      "Reserved ca event route domain: ca",
    );
  });

  it("uses localized fixed-page paths and keeps them out of content domains", () => {
    expect(fixedPageRouteSegments.about).toEqual({
      ca: "qui-som",
      es: "quienes-somos",
      en: "about",
    });
    expect(fixedPageRouteSegments.members).toEqual({
      ca: "socis",
      es: "socios",
      en: "members",
    });
    expect(getFixedPagePath("about", "ca")).toBe("/ca/qui-som/");
    expect(getFixedPagePath("about", "es")).toBe("/es/quienes-somos/");
    expect(getFixedPagePath("about", "en")).toBe("/en/about/");
    expect(getFixedPagePath("members", "ca")).toBe("/ca/socis/");
    expect(getFixedPagePath("members", "es")).toBe("/es/socios/");
    expect(getFixedPagePath("members", "en")).toBe("/en/members/");
    expect(fixedPageRouteSegments.contact).toEqual({
      ca: "contacte",
      es: "contacto",
      en: "contact",
    });
    expect(fixedPageRouteSegments.documents).toEqual({
      ca: "documents",
      es: "documentos",
      en: "documents",
    });
    expect(fixedPageRouteSegments["legal-notice"]).toEqual({
      ca: "avis-legal",
      es: "aviso-legal",
      en: "legal-notice",
    });
    expect(fixedPageRouteSegments["legal-privacy"]).toEqual({
      ca: "privacitat",
      es: "privacidad",
      en: "privacy",
    });
    expect(fixedPageRouteSegments["legal-cookies"]).toEqual({
      ca: "cookies",
      es: "cookies",
      en: "cookies",
    });
    expect(getFixedPagePath("contact", "ca")).toBe("/ca/contacte/");
    expect(getFixedPagePath("documents", "ca")).toBe("/ca/documents/");
    expect(getFixedPagePath("legal-notice", "ca")).toBe("/ca/avis-legal/");
    expect(getFixedPagePath("legal-privacy", "ca")).toBe("/ca/privacitat/");
    expect(getFixedPagePath("legal-cookies", "ca")).toBe("/ca/cookies/");
  });

  it("rejects invalid fixed-page segments", () => {
    const mutableSegments = (
      segments: typeof fixedPageRouteSegments,
    ): Record<keyof typeof fixedPageRouteSegments, Record<string, string>> =>
      structuredClone(segments);

    const duplicate = mutableSegments(fixedPageRouteSegments);
    duplicate.about.ca = "escoles";
    expect(() => assertFixedPageRouteSegments(duplicate)).toThrow(
      "Fixed page segment collides with a content domain: ca/escoles",
    );

    const reserved = mutableSegments(fixedPageRouteSegments);
    reserved.about.ca = "api";
    expect(() => assertFixedPageRouteSegments(reserved)).toThrow(
      "Reserved ca about fixed page segment: api",
    );

    const invalid = mutableSegments(fixedPageRouteSegments);
    invalid.about.ca = "QuiSom";
    expect(() => assertFixedPageRouteSegments(invalid)).toThrow(
      "Invalid ca about fixed page segment: QuiSom",
    );
  });
});
