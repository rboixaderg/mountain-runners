import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Contact } from "../lib/content/models";
import { hasCompleteTranslation, type Locale } from "../lib/content/primitives";
import {
  createPublicationCatalog,
  getPublishedLocalResources,
  type ContentSource,
} from "../lib/content/publication";
import { collectLocalResourcePaths } from "../lib/content/resources";
import { loadContentSource } from "./support/publication-catalog";

const loadSource = loadContentSource;

function variantKeys(source: ContentSource) {
  return createPublicationCatalog(source).variants.map(
    ({ kind, locale, slug }) => `${kind}:${locale}:${slug}`,
  );
}

describe("publication catalog", () => {
  it("publishes only complete localized variants", async () => {
    const source = await loadSource();
    const catalog = createPublicationCatalog(source);

    // The publication set is derived from the content, so the contract is not
    // a fixed roster but the rule: every published variant exists, and each one
    // carries a complete translation in its own locale. Removing a single
    // translation below proves the rule is enforced per locale.
    expect(catalog.variants.length).toBeGreaterThan(0);
    for (const variant of catalog.variants) {
      const name =
        "name" in variant.entry ? variant.entry.name : variant.entry.title;
      expect(hasCompleteTranslation(name, variant.locale)).toBe(true);
      expect(hasCompleteTranslation(variant.entry.slug, variant.locale)).toBe(
        true,
      );
    }

    const incompleteLocale: Locale = "en";
    const translatedEvent = source.events.find(
      (event) =>
        event.published &&
        hasCompleteTranslation(event.title, incompleteLocale),
    )!;
    // Slugs may be identical across locales; only the incomplete variant
    // should disappear, not another translation of the same event.
    translatedEvent.slug[incompleteLocale] = translatedEvent.slug.ca;
    const incompleteKey = `event:${incompleteLocale}:${translatedEvent.slug[incompleteLocale]}`;
    const completeKeys = variantKeys(source);
    expect(completeKeys).toContain(incompleteKey);
    expect(completeKeys).toContain(`event:ca:${translatedEvent.slug.ca}`);

    delete (translatedEvent.title as Partial<Record<Locale, string>>)[
      incompleteLocale
    ];
    expect(variantKeys(source)).toEqual(
      completeKeys.filter((key) => key !== incompleteKey),
    );
  });

  it("keeps unpublished and unavailable resources out of the public output", async () => {
    const source = await loadSource();
    const catalog = createPublicationCatalog(source);
    const resources = getPublishedLocalResources(catalog);

    // Nothing unpublished and nothing temporarily unavailable may reach the
    // build, and everything that does must exist on disk.
    expect(catalog.documents.has("private-draft")).toBe(false);

    const unavailable = source.documents.filter(
      ({ published, availability }) =>
        published && availability !== "available",
    );
    expect(unavailable.length).toBeGreaterThan(0);
    for (const document of unavailable) {
      // A published but unavailable document stays in the catalog so the page
      // can explain the state; only its file must stay out of the build.
      expect(catalog.documents.has(document.id)).toBe(true);
      for (const path of collectLocalResourcePaths(document)) {
        expect(resources).not.toContain(path);
      }
    }
    const unpublishedDocuments = source.documents.filter(
      ({ published }) => !published,
    );
    expect(unpublishedDocuments.length).toBeGreaterThan(0);
    for (const document of unpublishedDocuments) {
      expect(catalog.documents.has(document.id)).toBe(false);
      for (const path of collectLocalResourcePaths(document)) {
        expect(resources).not.toContain(path);
      }
    }
    // No entity is unpublished today, so one is unpublished here to prove the
    // rule instead of asserting today's roster.
    const entity = source.entities.find(
      (candidate) =>
        catalog.entities.has(candidate.id) &&
        candidate.logo.resource.kind === "local",
    )!;
    const unpublished = createPublicationCatalog({
      ...source,
      entities: source.entities.map((candidate) =>
        candidate.id === entity.id
          ? { ...candidate, published: false }
          : candidate,
      ),
    });
    expect(unpublished.entities.has(entity.id)).toBe(false);
    const unpublishedResources = getPublishedLocalResources(unpublished);
    for (const path of collectLocalResourcePaths(entity)) {
      expect(unpublishedResources).not.toContain(path);
    }

    // Resource paths are relative to the application root, where the build reads
    // them from.
    const appDirectory = fileURLToPath(new URL("../../", import.meta.url));
    for (const resourcePath of resources) {
      await expect(
        stat(resolve(appDirectory, resourcePath)),
        resourcePath,
      ).resolves.toBeDefined();
    }
  });

  it("applies completeness transitively to event references", async () => {
    const source = await loadSource();
    const mountainDay = source.events.find(({ id }) => id === "mountain-day")!;
    mountainDay.published = true;
    source.documents.find(({ id }) => id === "club-guide")!.published = false;

    const catalog = createPublicationCatalog(source);
    expect(variantKeys(source)).not.toContain("event:ca:jornada-muntanya");
    expect(catalog.documents.has("club-guide")).toBe(false);
  });

  it("requires translated fields across publication models", async () => {
    const mutations = [
      {
        expected: "school:ca:escola-btt",
        apply: (source: ContentSource) => {
          delete (source.schools[0]!.sections.prices as { ca?: string }).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          const mountainDay = source.events.find(
            ({ id }) => id === "mountain-day",
          )!;
          mountainDay.published = true;
          delete (mountainDay.editions[0]!.location as { ca?: string }).ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          const mountainDay = source.events.find(
            ({ id }) => id === "mountain-day",
          )!;
          mountainDay.published = true;
          delete (mountainDay.editions[0]!.modalities![0]! as { ca?: string })
            .ca;
        },
      },
      {
        expected: "event:ca:jornada-muntanya",
        apply: (source: ContentSource) => {
          const mountainDay = source.events.find(
            ({ id }) => id === "mountain-day",
          )!;
          mountainDay.published = true;
          const mountainRunners = source.entities.find(
            ({ id }) => id === "mountain-runners",
          )!;
          mountainRunners.membershipBenefit = {
            title: { ca: "Benefit" },
            description: { ca: "Description" },
          };
          delete (
            mountainRunners.membershipBenefit.description as { ca?: string }
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

  it("requires every published image attribution in the variant locale", async () => {
    const source = await loadSource();
    const bttSchool = source.schools.find(({ id }) => id === "btt-school")!;
    delete (bttSchool.gallery[0]!.attribution as { es?: string }).es;

    const publishedVariants = variantKeys(source);

    expect(publishedVariants).toContain("school:ca:escola-btt");
    expect(publishedVariants).not.toContain("school:es:escuela-btt");
    expect(publishedVariants).toContain("school:en:mtb-school");
  });

  it("requires referenced entity attributions in the variant locale", async () => {
    const source = await loadSource();
    const mountainRunners = source.entities.find(
      ({ id }) => id === "mountain-runners",
    )!;

    mountainRunners.attribution = {
      ca: "Atribució",
      es: "Atribución",
      en: "Attribution",
    };
    delete (mountainRunners.attribution as { es?: string }).es;

    const publishedVariants = variantKeys(source);

    expect(publishedVariants).toContain("event:ca:ultra-pirineu");
    expect(publishedVariants).not.toContain("event:es:ultra-pirineu");
    expect(publishedVariants).toContain("event:en:ultra-pirineu");
  });

  it("requires referenced document attributions in the variant locale", async () => {
    const source = await loadSource();
    const ultraPirineu = source.events.find(
      ({ id }) => id === "ultra-pirineu",
    )!;
    const clubGuide = source.documents.find(({ id }) => id === "club-guide")!;

    ultraPirineu.editions[0]!.documentIds = ["club-guide"];
    clubGuide.attribution = {
      ca: "Atribució",
      es: "Atribución",
      en: "Attribution",
    };
    delete (clubGuide.attribution as { es?: string }).es;

    const publishedVariants = variantKeys(source);

    expect(publishedVariants).toContain("event:ca:ultra-pirineu");
    expect(publishedVariants).not.toContain("event:es:ultra-pirineu");
    expect(publishedVariants).toContain("event:en:ultra-pirineu");
  });

  it("excludes unpublished entities from public queries and variants", async () => {
    const source = await loadSource();
    const mountainDay = source.events.find(({ id }) => id === "mountain-day")!;
    mountainDay.published = true;
    const mountainRunners = source.entities.find(
      ({ id }) => id === "mountain-runners",
    )!;
    mountainRunners.published = false;

    const catalog = createPublicationCatalog(source);
    expect(catalog.entities.has("mountain-runners")).toBe(false);
    expect(catalog.variants.some(({ kind }) => kind === "event")).toBe(false);
  });

  it("keeps unpublished entity logos out of the public resources", async () => {
    const source = await loadSource();
    source.entities.find(({ id }) => id === "elit")!.published = false;

    const catalog = createPublicationCatalog(source);
    expect(getPublishedLocalResources(catalog)).not.toContain(
      "src/assets/collaborators/elit.png",
    );
    expect(getPublishedLocalResources(catalog)).toContain(
      "src/assets/collaborators/visites-al-bergueda.jpg",
    );
  });

  it("rejects missing references, duplicate ids, and duplicate localized slugs", async () => {
    const sourceWithMissingReference = await loadSource();
    const mountainDay = sourceWithMissingReference.events.find(
      ({ id }) => id === "mountain-day",
    )!;
    mountainDay.organizerIds = ["missing-entity"];
    expect(() => createPublicationCatalog(sourceWithMissingReference)).toThrow(
      "event mountain-day references missing entity: missing-entity",
    );

    const sourceWithDuplicateId = await loadSource();
    sourceWithDuplicateId.schools.push(
      structuredClone(sourceWithDuplicateId.schools[0]!),
    );
    expect(() => createPublicationCatalog(sourceWithDuplicateId)).toThrow(
      "Duplicate school id: btt-school",
    );

    const sourceWithDuplicateSlug = await loadSource();
    sourceWithDuplicateSlug.schools.push(
      structuredClone(sourceWithDuplicateSlug.schools[0]!),
    );
    sourceWithDuplicateSlug.schools.at(-1)!.id = "duplicate-school";
    expect(() => createPublicationCatalog(sourceWithDuplicateSlug)).toThrow(
      "Duplicate localized slugs",
    );
  });

  it("keeps activity independent from editorial visibility", async () => {
    const source = await loadSource();
    const mountainDay = source.events.find(({ id }) => id === "mountain-day")!;
    mountainDay.published = true;
    mountainDay.active = false;
    expect(variantKeys(source)).toContain("event:ca:jornada-muntanya");

    mountainDay.published = false;
    expect(variantKeys(source)).not.toContain("event:ca:jornada-muntanya");
  });

  it("excludes a synthetic open-registration event without its URL", async () => {
    const source = await loadSource();
    const mountainDay = source.events.find(({ id }) => id === "mountain-day")!;
    mountainDay.published = true;
    delete mountainDay.registrationUrl;

    expect(variantKeys(source)).not.toContain("event:ca:jornada-muntanya");
  });

  it("accepts the synthetic open-registration event with its event-level URL", async () => {
    const source = await loadSource();
    const mountainDay = source.events.find(({ id }) => id === "mountain-day")!;
    mountainDay.published = true;

    expect(variantKeys(source)).toContain("event:ca:jornada-muntanya");
  });

  it("excludes a synthetic open-registration school without its URL", async () => {
    const source = await loadSource();
    const trailSchool = source.schools.find(({ id }) => id === "trail-school")!;
    trailSchool.registrationStatus = "open";
    delete trailSchool.registrationUrl;

    expect(variantKeys(source)).not.toContain("school:ca:escola-trail");
  });

  it("publishes an open-registration school when its URL is translated", async () => {
    const source = await loadSource();
    const trailSchool = source.schools.find(({ id }) => id === "trail-school")!;
    trailSchool.registrationStatus = "open";
    trailSchool.registrationUrl = {
      ca: "https://example.org/escola-trail/inscripcio",
    };

    expect(variantKeys(source)).toContain("school:ca:escola-trail");
  });

  it("keeps a school published when a press video title lacks a translation", async () => {
    const source = await loadSource();
    const trailSchool = source.schools.find(({ id }) => id === "trail-school")!;
    delete trailSchool.pressVideo?.title.en;

    expect(variantKeys(source)).toContain("school:en:trail-school");
  });

  it("does not publish a school with an external image resource", async () => {
    const source = await loadSource();
    const trailSchool = source.schools.find(({ id }) => id === "trail-school")!;
    trailSchool.cover.resource = {
      kind: "external",
      url: "https://images.example.org/trail-cover.webp",
    };

    expect(variantKeys(source)).not.toContain("school:ca:escola-trail");
  });

  it("publishes external actions and contact data for the default locale", async () => {
    const source = await loadSource();
    const catalog = createPublicationCatalog(source);

    expect([...catalog.externalActions.keys()]).toEqual([
      "federation",
      "member-signup",
      "newsletter",
    ]);
    expect(catalog.contact?.id).toBe("mountain-runners-contact");
    expect(catalog.contact?.email).toBe("info@mountainrunners.cat");
    expect(catalog.contact?.phones).toEqual(["+34938213747", "+34691910774"]);
    expect(catalog.entities.get("mountain-runners")?.links).toEqual([
      { kind: "website", url: "https://mountainrunners.cat/" },
      { kind: "instagram", url: "https://www.instagram.com/infomountain/" },
      { kind: "strava", url: "https://www.strava.com/clubs/156769" },
    ]);
    expect(catalog.entities.get("mountain-runners")?.promotionalVideoUrl).toBe(
      "https://www.youtube.com/watch?v=EUV5uETCjeo",
    );
  });

  it("excludes unpublished external actions and contact data", async () => {
    const source = await loadSource();
    source.externalActions.find(({ id }) => id === "newsletter")!.published =
      false;
    source.contact[0]!.published = false;

    const catalog = createPublicationCatalog(source);
    expect(catalog.externalActions.has("newsletter")).toBe(false);
    expect(catalog.contact).toBeUndefined();
  });

  it("requires exactly one contact record", async () => {
    const sourceWithoutContact = await loadSource();
    sourceWithoutContact.contact = [];
    expect(() => createPublicationCatalog(sourceWithoutContact)).toThrow(
      "Expected exactly one contact entry, found 0",
    );

    const sourceWithMultipleContacts = await loadSource();
    const secondContact = structuredClone(
      sourceWithMultipleContacts.contact[0]!,
    );
    secondContact.id = "secondary-contact";
    sourceWithMultipleContacts.contact.push(secondContact);
    expect(() => createPublicationCatalog(sourceWithMultipleContacts)).toThrow(
      "Expected exactly one contact entry, found 2",
    );
  });

  it("rejects an invalid About page statutes reference", async () => {
    const sourceWithoutStatutes = await loadSource();
    sourceWithoutStatutes.documents = sourceWithoutStatutes.documents.filter(
      ({ id }) => id !== "estatuts",
    );
    expect(() => createPublicationCatalog(sourceWithoutStatutes)).toThrow(
      "About page references missing or unpublished document: estatuts",
    );

    const sourceWithUnpublishedStatutes = await loadSource();
    sourceWithUnpublishedStatutes.documents.find(
      ({ id }) => id === "estatuts",
    )!.published = false;
    expect(() =>
      createPublicationCatalog(sourceWithUnpublishedStatutes),
    ).toThrow(
      "About page references missing or unpublished document: estatuts",
    );
  });

  it("rejects missing or unpublished external actions referenced by the Members page", async () => {
    const sourceWithoutSignup = await loadSource();
    sourceWithoutSignup.externalActions =
      sourceWithoutSignup.externalActions.filter(
        ({ id }) => id !== "member-signup",
      );
    expect(() => createPublicationCatalog(sourceWithoutSignup)).toThrow(
      "Members page references missing or unpublished external action: member-signup",
    );

    const sourceWithUnpublishedFederation = await loadSource();
    sourceWithUnpublishedFederation.externalActions.find(
      ({ id }) => id === "federation",
    )!.published = false;
    expect(() =>
      createPublicationCatalog(sourceWithUnpublishedFederation),
    ).toThrow(
      "Members page references missing or unpublished external action: federation",
    );
  });

  it("excludes external actions and contact data without a complete Catalan translation", async () => {
    const source = await loadSource();
    const memberSignup = source.externalActions.find(
      ({ id }) => id === "member-signup",
    )!;
    delete (memberSignup.url as { ca?: string }).ca;
    source.contact[0]!.address = {
      es: "Dirección de prueba",
    } as Contact["address"];

    const catalog = createPublicationCatalog(source);
    expect(catalog.externalActions.has("member-signup")).toBe(false);
    expect(catalog.contact).toBeUndefined();
  });

  it("keeps unavailable document resources out of the public output", async () => {
    const source = await loadSource();
    const clubGuide = source.documents.find(({ id }) => id === "club-guide")!;
    const guideResource = "src/content-assets/documents/club-guide.pdf";

    const catalog = createPublicationCatalog(source);
    expect(getPublishedLocalResources(catalog)).not.toContain(guideResource);

    clubGuide.availability = "available";
    const catalogWithAvailableGuide = createPublicationCatalog(source);
    expect(getPublishedLocalResources(catalogWithAvailableGuide)).toContain(
      guideResource,
    );
  });

  it("keeps unavailable document resources referenced by editions out of the public output", async () => {
    const source = await loadSource();
    const mountainDay = source.events.find(({ id }) => id === "mountain-day")!;
    mountainDay.published = true;
    const guideResource = "src/content-assets/documents/club-guide.pdf";

    const catalog = createPublicationCatalog(source);
    expect(getPublishedLocalResources(catalog)).not.toContain(guideResource);

    source.documents.find(({ id }) => id === "club-guide")!.availability =
      "available";
    const catalogWithAvailableGuide = createPublicationCatalog(source);
    expect(getPublishedLocalResources(catalogWithAvailableGuide)).toContain(
      guideResource,
    );
  });
});
