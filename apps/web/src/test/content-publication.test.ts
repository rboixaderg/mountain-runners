import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  collectionSchemas,
  type Document,
  type Entity,
  type Event,
  type Page,
  type School,
  type Site,
} from "../lib/content/models";
import {
  createPublicationCatalog,
  getPublishedLocalResources,
  type ContentSource,
} from "../lib/content/publication";
import { parseRestrictedYaml } from "../lib/content/yaml";

async function loadCollection<T>(directory: string, schema: z.ZodType<T>) {
  const directoryUrl = new URL(`../content/${directory}/`, import.meta.url);
  const files = (await readdir(directoryUrl))
    .filter((file) => file.endsWith(".yaml"))
    .sort();
  return Promise.all(
    files.map(async (file) => {
      const source = await readFile(new URL(file, directoryUrl), "utf8");
      return parseRestrictedYaml(source, schema);
    }),
  );
}

async function loadSource(): Promise<ContentSource> {
  const [site, pages, schools, events, entities, documents] = await Promise.all(
    [
      loadCollection<Site>("site", collectionSchemas.site),
      loadCollection<Page>("pages", collectionSchemas.pages),
      loadCollection<School>("schools", collectionSchemas.schools),
      loadCollection<Event>("events", collectionSchemas.events),
      loadCollection<Entity>("entities", collectionSchemas.entities),
      loadCollection<Document>("documents", collectionSchemas.documents),
    ],
  );
  return { site, pages, schools, events, entities, documents };
}

function variantKeys(source: ContentSource) {
  return createPublicationCatalog(source).variants.map(
    ({ kind, locale, slug }) => `${kind}:${locale}:${slug}`,
  );
}

describe("publication catalog", () => {
  it("publishes only complete localized variants", async () => {
    const source = await loadSource();
    const catalog = createPublicationCatalog(source);
    const keys = catalog.variants.map(
      ({ kind, locale, slug }) => `${kind}:${locale}:${slug}`,
    );

    expect(keys).toEqual([
      "page:ca:qui-som",
      "school:ca:escola-trail",
      "event:ca:jornada-muntanya",
      "page:es:quienes-somos",
    ]);
    expect(keys.join(" ")).not.toContain("internal-draft");
    expect(catalog.documents.has("private-draft")).toBe(false);
    expect(getPublishedLocalResources(catalog)).toEqual([
      "src/content-assets/documents/club-guide.pdf",
    ]);
  });

  it("applies completeness transitively to nested blocks and documents", async () => {
    const source = await loadSource();
    const page = source.pages.find(({ id }) => id === "club")!;
    const richText = page.blocks.find(({ type }) => type === "rich-text")!;
    if (richText.type !== "rich-text") throw new Error("Expected rich text");
    delete richText.body.es;

    expect(variantKeys(source)).not.toContain("page:es:quienes-somos");

    const sourceWithDraftDocument = await loadSource();
    sourceWithDraftDocument.documents.find(
      ({ id }) => id === "club-guide",
    )!.published = false;
    const catalog = createPublicationCatalog(sourceWithDraftDocument);
    const keys = catalog.variants.map(
      ({ kind, locale, slug }) => `${kind}:${locale}:${slug}`,
    );
    expect(keys.some((key) => key.startsWith("page:"))).toBe(false);
    expect(keys.some((key) => key.startsWith("event:"))).toBe(false);
    expect(catalog.documents.has("club-guide")).toBe(false);
  });

  it("excludes unpublished entities from public queries and variants", async () => {
    const source = await loadSource();
    source.entities[0]!.published = false;

    const catalog = createPublicationCatalog(source);

    expect(catalog.entities.has("mountain-runners")).toBe(false);
    expect(catalog.variants.some(({ kind }) => kind === "event")).toBe(false);
  });

  it("rejects missing references and duplicate localized slugs", async () => {
    const source = await loadSource();
    source.events[0]!.organizerIds = ["missing-entity"];
    expect(() => createPublicationCatalog(source)).toThrow(
      "references missing entity",
    );

    const duplicateSource = await loadSource();
    duplicateSource.pages.push(structuredClone(duplicateSource.pages[0]!));
    duplicateSource.pages[1]!.id = "duplicate-page";
    expect(() => createPublicationCatalog(duplicateSource)).toThrow(
      "Duplicate localized slugs",
    );
  });

  it("keeps activity independent from editorial visibility", async () => {
    const source = await loadSource();
    source.events[0]!.active = false;
    expect(variantKeys(source)).toContain("event:ca:jornada-muntanya");

    source.events[0]!.published = false;
    expect(variantKeys(source)).not.toContain("event:ca:jornada-muntanya");
  });

  it("requires exactly one site entry", async () => {
    const source = await loadSource();
    source.site = [];
    expect(() => createPublicationCatalog(source)).toThrow(
      "exactly one site entry",
    );
  });
});
