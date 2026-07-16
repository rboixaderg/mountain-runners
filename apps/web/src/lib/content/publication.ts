import type {
  Document,
  Entity,
  Event,
  Page,
  PageBlock,
  School,
  Site,
} from "./models";
import {
  findDuplicateLocalizedSlugs,
  hasCompleteTranslation,
  knownLocales,
  type Locale,
  type Translatable,
} from "./primitives";

export type ContentSource = {
  site: Site[];
  pages: Page[];
  schools: School[];
  events: Event[];
  entities: Entity[];
  documents: Document[];
};

export type PublishedVariant =
  | { kind: "page"; locale: Locale; slug: string; entry: Page }
  | { kind: "school"; locale: Locale; slug: string; entry: School }
  | { kind: "event"; locale: Locale; slug: string; entry: Event };

export type PublicationCatalog = {
  site: Site;
  variants: PublishedVariant[];
  entities: Map<string, Entity>;
  documents: Map<string, Document>;
};

function collectLocalResourcePaths(value: unknown, paths = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectLocalResourcePaths(item, paths);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "local" && typeof record.path === "string") {
      paths.add(record.path);
    }
    for (const item of Object.values(record)) {
      collectLocalResourcePaths(item, paths);
    }
  }
  return paths;
}

export function getPublishedLocalResources(
  catalog: PublicationCatalog,
): string[] {
  const resources = new Set<string>();

  for (const variant of catalog.variants) {
    collectLocalResourcePaths(variant.entry, resources);

    if (variant.kind === "page") {
      for (const block of variant.entry.blocks) {
        if (block.type !== "documents") continue;
        for (const id of block.documentIds) {
          collectLocalResourcePaths(catalog.documents.get(id), resources);
        }
      }
    }

    if (variant.kind === "event") {
      for (const id of [
        ...variant.entry.organizerIds,
        ...variant.entry.collaboratorIds,
      ]) {
        collectLocalResourcePaths(catalog.entities.get(id), resources);
      }
      for (const edition of variant.entry.editions) {
        for (const id of edition.documentIds) {
          collectLocalResourcePaths(catalog.documents.get(id), resources);
        }
      }
    }
  }

  return [...resources].sort();
}

export function getPublicResourcePath(resourcePath: string): string {
  return `/content-resources/${resourcePath.replace(/^src\//u, "")}`;
}

function isTranslated<T>(value: Translatable<T>, locale: Locale): boolean {
  return hasCompleteTranslation(value, locale);
}

function isImageComplete(
  image: { alt: Translatable<string> },
  locale: Locale,
): boolean {
  return isTranslated(image.alt, locale);
}

function isEntityComplete(entity: Entity, locale: Locale): boolean {
  return (
    entity.published &&
    isTranslated(entity.name, locale) &&
    isTranslated(entity.description, locale) &&
    isImageComplete(entity.logo, locale) &&
    (entity.membershipBenefit === undefined ||
      (isTranslated(entity.membershipBenefit.title, locale) &&
        isTranslated(entity.membershipBenefit.description, locale)))
  );
}

function isDocumentComplete(document: Document, locale: Locale): boolean {
  return (
    document.published &&
    isTranslated(document.title, locale) &&
    isTranslated(document.description, locale)
  );
}

function isBlockComplete(
  block: PageBlock,
  locale: Locale,
  documents: ReadonlyMap<string, Document>,
): boolean {
  switch (block.type) {
    case "rich-text":
      return isTranslated(block.body, locale);
    case "image":
      return isImageComplete(block.image, locale);
    case "gallery":
      return block.images.every((image) => isImageComplete(image, locale));
    case "links":
      return block.links.every(
        (link) =>
          isTranslated(link.label, locale) && isTranslated(link.url, locale),
      );
    case "documents":
      return block.documentIds.every((id) => {
        const document = documents.get(id);
        return document !== undefined && isDocumentComplete(document, locale);
      });
  }
}

function isPageComplete(
  page: Page,
  locale: Locale,
  documents: ReadonlyMap<string, Document>,
): boolean {
  return (
    page.published &&
    isTranslated(page.slug, locale) &&
    isTranslated(page.title, locale) &&
    isTranslated(page.summary, locale) &&
    isTranslated(page.seoTitle, locale) &&
    isTranslated(page.seoDescription, locale) &&
    page.blocks.every((block) => isBlockComplete(block, locale, documents))
  );
}

function isSchoolComplete(school: School, locale: Locale): boolean {
  return (
    school.published &&
    isTranslated(school.slug, locale) &&
    isTranslated(school.name, locale) &&
    isTranslated(school.summary, locale) &&
    isTranslated(school.description, locale) &&
    isImageComplete(school.cover, locale) &&
    school.gallery.every((image) => isImageComplete(image, locale)) &&
    Object.values(school.sections).every((section) =>
      isTranslated(section, locale),
    ) &&
    (school.registrationStatus !== "open" ||
      (school.registrationUrl !== undefined &&
        isTranslated(school.registrationUrl, locale)))
  );
}

function isEventComplete(
  event: Event,
  locale: Locale,
  entities: ReadonlyMap<string, Entity>,
  documents: ReadonlyMap<string, Document>,
): boolean {
  const referencedEntities = [...event.organizerIds, ...event.collaboratorIds];

  return (
    event.published &&
    isTranslated(event.slug, locale) &&
    isTranslated(event.title, locale) &&
    isTranslated(event.description, locale) &&
    isImageComplete(event.cover, locale) &&
    event.gallery.every((image) => isImageComplete(image, locale)) &&
    referencedEntities.every((id) => {
      const entity = entities.get(id);
      return entity !== undefined && isEntityComplete(entity, locale);
    }) &&
    event.editions.every(
      (edition) =>
        isTranslated(edition.location, locale) &&
        edition.modalities.every((modality) =>
          isTranslated(modality, locale),
        ) &&
        (edition.registrationStatus !== "open" ||
          (edition.registrationUrl !== undefined &&
            isTranslated(edition.registrationUrl, locale))) &&
        edition.documentIds.every((id) => {
          const document = documents.get(id);
          return document !== undefined && isDocumentComplete(document, locale);
        }),
    )
  );
}

function indexById<T extends { id: string }>(
  collection: readonly T[],
  name: string,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const entry of collection) {
    if (index.has(entry.id))
      throw new Error(`Duplicate ${name} id: ${entry.id}`);
    index.set(entry.id, entry);
  }
  return index;
}

function assertUniqueSlugs(
  collectionName: string,
  entries: readonly { slug: Translatable<string> }[],
): void {
  const duplicates = findDuplicateLocalizedSlugs(
    entries.map((entry) => entry.slug),
  );
  const messages = Object.entries(duplicates).map(
    ([locale, slugs]) => `${locale}: ${slugs.join(", ")}`,
  );
  if (messages.length > 0) {
    throw new Error(
      `Duplicate localized slugs in ${collectionName}: ${messages.join("; ")}`,
    );
  }
}

function assertReferences(
  source: ContentSource,
  entities: ReadonlyMap<string, Entity>,
  documents: ReadonlyMap<string, Document>,
): void {
  const requireReference = (
    kind: string,
    owner: string,
    id: string,
    index: ReadonlyMap<string, unknown>,
  ) => {
    if (!index.has(id)) {
      throw new Error(`${owner} references missing ${kind}: ${id}`);
    }
  };

  for (const page of source.pages) {
    for (const block of page.blocks) {
      if (block.type !== "documents") continue;
      for (const id of block.documentIds) {
        requireReference("document", `page ${page.id}`, id, documents);
      }
    }
  }

  for (const event of source.events) {
    for (const id of [...event.organizerIds, ...event.collaboratorIds]) {
      requireReference("entity", `event ${event.id}`, id, entities);
    }
    for (const edition of event.editions) {
      for (const id of edition.documentIds) {
        requireReference(
          "document",
          `event ${event.id} edition ${edition.id}`,
          id,
          documents,
        );
      }
    }
  }
}

export function createPublicationCatalog(
  source: ContentSource,
): PublicationCatalog {
  if (source.site.length !== 1 || source.site[0]?.id !== "site") {
    throw new Error("The site collection must contain exactly one site entry");
  }

  const entities = indexById(source.entities, "entity");
  const documents = indexById(source.documents, "document");
  assertUniqueSlugs("pages", source.pages);
  assertUniqueSlugs("schools", source.schools);
  assertUniqueSlugs("events", source.events);
  assertReferences(source, entities, documents);

  const variants: PublishedVariant[] = [];
  for (const locale of knownLocales) {
    for (const page of source.pages) {
      if (isPageComplete(page, locale, documents)) {
        variants.push({
          kind: "page",
          locale,
          slug: page.slug[locale]!,
          entry: page,
        });
      }
    }
    for (const school of source.schools) {
      if (isSchoolComplete(school, locale)) {
        variants.push({
          kind: "school",
          locale,
          slug: school.slug[locale]!,
          entry: school,
        });
      }
    }
    for (const event of source.events) {
      if (isEventComplete(event, locale, entities, documents)) {
        variants.push({
          kind: "event",
          locale,
          slug: event.slug[locale]!,
          entry: event,
        });
      }
    }
  }

  return { site: source.site[0], variants, entities, documents };
}
