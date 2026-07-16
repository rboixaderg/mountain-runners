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

  it("requires translated rendered fields across publication models", async () => {
    const mutations = [
      {
        expected: "page:es:quienes-somos",
        apply: (source: ContentSource) => {
          const page = source.pages[0]!;
          const image = {
            type: "image",
            image: {
              resource: { kind: "external", url: "https://example.org/image" },
              alt: { ca: "Image", es: "Imagen" },
            },
          } as const;
          delete (image.image.alt as { es?: string }).es;
          page.blocks.unshift(image);
        },
      },
      {
        expected: "page:es:quienes-somos",
        apply: (source: ContentSource) => {
          const page = source.pages[0]!;
          const links: Extract<Page["blocks"][number], { type: "links" }> = {
            type: "links",
            links: [
              {
                label: { ca: "Link", es: "Enlace" },
                url: {
                  ca: "https://example.org/ca",
                  es: "https://example.org/es",
                },
              },
            ],
          };
          delete (links.links[0]!.url as { es?: string }).es;
          page.blocks.unshift(links);
        },
      },
      {
        expected: "school:ca:escola-trail",
        apply: (source: ContentSource) => {
          const school = source.schools[0]!;
          school.registrationStatus = "open";
          school.registrationUrl = { ca: "https://example.org/register" };
          delete (school.registrationUrl as { ca?: string }).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          const event = source.events[0]!;
          event.editions[0]!.registrationStatus = "open";
          event.editions[0]!.registrationUrl = {
            ca: "https://example.org/register",
          };
          delete (event.editions[0]!.registrationUrl as { ca?: string }).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          const event = source.events[0]!;
          delete (event.editions[0]!.location as { ca?: string }).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          const event = source.events[0]!;
          delete (event.editions[0]!.modalities[0]! as { ca?: string }).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          const entity = source.entities[0]!;
          entity.membershipBenefit = {
            title: { ca: "Benefit" },
            description: { ca: "Description" },
          };
          delete (entity.membershipBenefit.description as { ca?: string }).ca;
        },
      },
    ];

    for (const { expected, apply } of mutations) {
      const source = await loadSource();
      apply(source);
      expect(variantKeys(source)).not.toContain(expected);
    }
  });

  it("excludes unpublished entities from public queries and variants", async () => {
    const source = await loadSource();
    source.entities[0]!.published = false;

    const catalog = createPublicationCatalog(source);

    expect(catalog.entities.has("mountain-runners")).toBe(false);
    expect(catalog.variants.some(({ kind }) => kind === "event")).toBe(false);
  });

  it("rejects missing references and duplicate localized slugs", async () => {
    const missingReferences = [
      {
        error: "page club references missing document: missing-document",
        apply: (source: ContentSource) => {
          const documents = source.pages[0]!.blocks.find(
            (block) => block.type === "documents",
          )!;
          if (documents.type !== "documents")
            throw new Error("Expected documents block");
          documents.documentIds = ["missing-document"];
        },
      },
      {
        error: "event mountain-day references missing entity: missing-entity",
        apply: (source: ContentSource) => {
          source.events[0]!.organizerIds = ["missing-entity"];
        },
      },
      {
        error: "event mountain-day references missing entity: missing-entity",
        apply: (source: ContentSource) => {
          source.events[0]!.collaboratorIds = ["missing-entity"];
        },
      },
      {
        error:
          "event mountain-day edition edition-2027 references missing document: missing-document",
        apply: (source: ContentSource) => {
          source.events[0]!.editions[0]!.documentIds = ["missing-document"];
        },
      },
    ];

    for (const { error, apply } of missingReferences) {
      const source = await loadSource();
      apply(source);
      expect(() => createPublicationCatalog(source)).toThrow(error);
    }

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
