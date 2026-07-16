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

function variantKeys(source: ContentSource) {
  return createPublicationCatalog(source).variants.map(
    ({ kind, locale, slug }) => `${kind}:${locale}:${slug}`,
  );
}

describe("publication catalog", () => {
  it("publishes only complete localized variants", async () => {
    const source = await loadSource();
    const catalog = createPublicationCatalog(source);

    expect(variantKeys(source)).toEqual([
      "school:ca:escola-trail",
      "event:ca:jornada-muntanya",
    ]);
    expect(catalog.documents.has("private-draft")).toBe(false);
    expect(getPublishedLocalResources(catalog)).toEqual([
      "src/content-assets/documents/club-guide.pdf",
    ]);
  });

  it("applies completeness transitively to event references", async () => {
    const source = await loadSource();
    source.documents.find(({ id }) => id === "club-guide")!.published = false;

    const catalog = createPublicationCatalog(source);
    expect(variantKeys(source)).not.toContain("event:ca:jornada-muntanya");
    expect(catalog.documents.has("club-guide")).toBe(false);
  });

  it("requires translated fields across publication models", async () => {
    const mutations = [
      {
        expected: "school:ca:escola-trail",
        apply: (source: ContentSource) => {
          delete (source.schools[0]!.sections.prices as { ca?: string }).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          delete (source.events[0]!.editions[0]!.location as { ca?: string })
            .ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          delete (
            source.events[0]!.editions[0]!.modalities[0]! as { ca?: string }
          ).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          source.entities[0]!.membershipBenefit = {
            title: { ca: "Benefit" },
            description: { ca: "Description" },
          };
          delete (
            source.entities[0]!.membershipBenefit.description as { ca?: string }
          ).ca;
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

  it("rejects missing references, duplicate ids, and duplicate localized slugs", async () => {
    const sourceWithMissingReference = await loadSource();
    sourceWithMissingReference.events[0]!.organizerIds = ["missing-entity"];
    expect(() => createPublicationCatalog(sourceWithMissingReference)).toThrow(
      "event mountain-day references missing entity: missing-entity",
    );

    const sourceWithDuplicateId = await loadSource();
    sourceWithDuplicateId.schools.push(
      structuredClone(sourceWithDuplicateId.schools[0]!),
    );
    expect(() => createPublicationCatalog(sourceWithDuplicateId)).toThrow(
      "Duplicate school id: trail-school",
    );

    const sourceWithDuplicateSlug = await loadSource();
    sourceWithDuplicateSlug.schools.push(
      structuredClone(sourceWithDuplicateSlug.schools[0]!),
    );
    sourceWithDuplicateSlug.schools[1]!.id = "duplicate-school";
    expect(() => createPublicationCatalog(sourceWithDuplicateSlug)).toThrow(
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
});
