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
      "school:ca:escola-btt",
      "school:ca:escola-skimo",
      "school:ca:escola-trail",
      "event:ca:anella-verda",
      "event:ca:berga-trail",
      "event:ca:cros-de-queralt",
      "event:ca:escalada-castell-areny",
      "event:ca:escalada-queralt",
      "event:ca:les-classiques-de-berga",
      "event:ca:llobregat-x-la-diabetis",
      "event:ca:minivolta-a-la-maria",
      "event:ca:quina-berguedana",
      "event:ca:ultra-pirineu",
      "school:es:escuela-btt",
      "school:es:escuela-esqui-montana",
      "school:es:escuela-trail",
      "event:es:anella-verde",
      "event:es:berga-trail",
      "event:es:cros-de-queralt",
      "event:es:escalada-castell-areny",
      "event:es:escalada-queralt",
      "event:es:les-classiques-de-berga",
      "event:es:llobregat-x-la-diabetis",
      "event:es:minivolta-a-la-maria",
      "event:es:quina-berguedana",
      "event:es:ultra-pirineu",
      "school:en:mtb-school",
      "school:en:ski-mountaineering-school",
      "school:en:trail-school",
      "event:en:green-ring",
      "event:en:berga-trail",
      "event:en:cros-de-queralt",
      "event:en:escalada-castell-areny",
      "event:en:escalada-queralt",
      "event:en:les-classiques-de-berga",
      "event:en:llobregat-x-la-diabetis",
      "event:en:minivolta-a-la-maria",
      "event:en:quina-berguedana",
      "event:en:ultra-pirineu",
    ]);
    expect(catalog.documents.has("private-draft")).toBe(false);
    expect(getPublishedLocalResources(catalog)).toEqual([
      "src/assets/collaborators/aina-vila.png",
      "src/assets/collaborators/alexandra-bruy.png",
      "src/assets/collaborators/bicixtrem.jpg",
      "src/assets/collaborators/centre-optic.jpg",
      "src/assets/collaborators/cimetir.jpg",
      "src/assets/collaborators/clinica-jessica-genesca.png",
      "src/assets/collaborators/elit.png",
      "src/assets/collaborators/estetica-adela.png",
      "src/assets/collaborators/farmacia-cosp.png",
      "src/assets/collaborators/four-riders-bike-park.png",
      "src/assets/collaborators/intersport-serramarti.png",
      "src/assets/collaborators/joieria-climent.png",
      "src/assets/collaborators/ortopedia-alvarez-saz-cabra.jpg",
      "src/assets/collaborators/pedratour.png",
      "src/assets/collaborators/peu-de-via.webp",
      "src/assets/collaborators/podologia-ingrid-soca.jpg",
      "src/assets/collaborators/ramirs-sabaters.png",
      "src/assets/collaborators/rios-running-berga.jpeg",
      "src/assets/collaborators/snowlockers.png",
      "src/assets/collaborators/veloberga.jpg",
      "src/assets/collaborators/visites-al-bergueda.jpg",
      "src/assets/entities/basquet-berga.jpg",
      "src/assets/entities/club-atletic-berga.png",
      "src/assets/entities/club-esportiu-berga.png",
      "src/assets/entities/club-esqui-bergueda.png",
      "src/assets/entities/club-voleibol-berga.jpg",
      "src/assets/events/anella-verda-cover.webp",
      "src/assets/events/escalada-castell-areny-cover.jpg",
      "src/assets/events/escalada-queralt-cover.jpg",
      "src/assets/events/les-classiques-de-berga-cover.png",
      "src/assets/events/llobregat-x-la-diabetis-cover.png",
      "src/assets/events/quina-berguedana-cover.jpg",
      "src/assets/logo_mountain_runners.png",
      "src/assets/schools/escola-btt-card.jpg",
      "src/assets/schools/escola-btt.jpg",
      "src/assets/schools/escola-skimo-card.jpg",
      "src/assets/schools/escola-skimo.jpg",
      "src/assets/schools/escola-trail-card.jpg",
      "src/assets/schools/escola-trail.jpg",
      "src/assets/schools/gallery/btt/btt-session-0009.jpg",
      "src/assets/schools/gallery/btt/btt-session-0031.jpg",
      "src/assets/schools/gallery/btt/btt-session-0123.jpg",
      "src/assets/schools/gallery/btt/btt-session-0139.jpg",
      "src/assets/schools/gallery/btt/btt-session-0203.jpg",
      "src/assets/schools/gallery/btt/btt-session-0239.jpg",
      "src/assets/schools/gallery/skimo/skimo-session-0295.jpg",
      "src/assets/schools/gallery/skimo/skimo-session-2385.jpg",
      "src/assets/schools/gallery/skimo/skimo-session-4221.jpg",
      "src/assets/schools/gallery/skimo/skimo-session-4284.jpg",
      "src/assets/schools/gallery/trail/trail-friday-pics-07.jpg",
      "src/assets/schools/gallery/trail/trail-friday-pics-26.jpg",
      "src/assets/schools/gallery/trail/trail-session-08.jpg",
      "src/assets/schools/gallery/trail/trail-session-21.jpg",
      "src/assets/schools/gallery/trail/trail-session-23.jpg",
      "src/assets/schools/gallery/trail/trail-session-29.jpg",
      "src/content-assets/documents/estatuts-mrb.pdf",
    ]);
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
          delete (mountainDay.editions[0]!.modalities[0]! as { ca?: string })
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
    expect(catalog.contact?.email).toBe("mailto:info@mountainrunners.cat");
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
