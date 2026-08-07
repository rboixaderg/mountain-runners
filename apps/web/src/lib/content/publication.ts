import type {
  Contact,
  Document,
  Entity,
  Event,
  ExternalAction,
  School,
} from "./models";
import { externalActionIds, statutesDocumentId } from "./models";
import {
  defaultLocale,
  findDuplicateLocalizedSlugs,
  hasCompleteTranslation,
  knownLocales,
  type Locale,
  type Translatable,
} from "./primitives";
import { collectLocalResourcePaths } from "./resources";

export type ContentSource = {
  schools: School[];
  events: Event[];
  entities: Entity[];
  documents: Document[];
  externalActions: ExternalAction[];
  contact: Contact[];
};

export type PublishedVariant =
  | { kind: "school"; locale: Locale; slug: string; entry: School }
  | { kind: "event"; locale: Locale; slug: string; entry: Event };

export type PublicationCatalog = {
  variants: PublishedVariant[];
  entities: Map<string, Entity>;
  documents: Map<string, Document>;
  externalActions: Map<string, ExternalAction>;
  contact: Contact | undefined;
};

export function getPublishedLocalResources(
  catalog: PublicationCatalog,
): string[] {
  const resources = new Set<string>();

  for (const variant of catalog.variants) {
    collectLocalResourcePaths(variant.entry, resources);

    if (variant.kind === "event") {
      for (const edition of variant.entry.editions) {
        for (const id of edition.documentIds) {
          collectLocalResourcePaths(catalog.documents.get(id), resources);
        }
      }
    }
  }

  // Published entities are public data: events render the ones they
  // reference and the Members fixed page renders the directory logos, so
  // their local resources belong to the public output.
  for (const entity of catalog.entities.values()) {
    collectLocalResourcePaths(entity, resources);
  }

  // The About fixed page links the statutes document from the published
  // collection, so its local resource is part of the public output.
  collectLocalResourcePaths(
    catalog.documents.get(statutesDocumentId),
    resources,
  );

  return [...resources].sort();
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

function isExternalActionComplete(
  action: ExternalAction,
  locale: Locale,
): boolean {
  return (
    action.published &&
    (action.status !== "available" ||
      (action.url !== undefined && isTranslated(action.url, locale)))
  );
}

function isContactComplete(contact: Contact, locale: Locale): boolean {
  return (
    contact.published &&
    isTranslated(contact.address, locale) &&
    isTranslated(contact.hours, locale)
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
  const hasCompleteRegistrationUrl = (
    edition: Event["editions"][number],
  ): boolean =>
    (edition.registrationUrl !== undefined &&
      isTranslated(edition.registrationUrl, locale)) ||
    (event.registrationUrl !== undefined &&
      isTranslated(event.registrationUrl, locale));

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
          hasCompleteRegistrationUrl(edition)) &&
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

function assertSingleContact(contactEntries: readonly Contact[]): void {
  if (contactEntries.length !== 1) {
    throw new Error(
      `Expected exactly one contact entry, found ${contactEntries.length}`,
    );
  }
}

function assertStatutesReference(documents: readonly Document[]): void {
  const statutes = documents.find(({ id }) => id === statutesDocumentId);
  if (statutes === undefined || !statutes.published) {
    throw new Error(
      `About page references missing or unpublished document: ${statutesDocumentId}`,
    );
  }
}

function assertExternalActionsReference(
  externalActions: readonly ExternalAction[],
): void {
  for (const actionId of [
    externalActionIds.memberSignup,
    externalActionIds.federation,
  ]) {
    const action = externalActions.find(({ id }) => id === actionId);
    if (action === undefined || !action.published) {
      throw new Error(
        `Members page references missing or unpublished external action: ${actionId}`,
      );
    }
  }
}

export function createPublicationCatalog(
  source: ContentSource,
): PublicationCatalog {
  const entities = indexById(source.entities, "entity");
  const documents = indexById(source.documents, "document");
  indexById(source.schools, "school");
  indexById(source.events, "event");
  indexById(source.externalActions, "external action");
  indexById(source.contact, "contact");
  assertSingleContact(source.contact);
  assertStatutesReference(source.documents);
  assertExternalActionsReference(source.externalActions);
  assertUniqueSlugs("schools", source.schools);
  assertUniqueSlugs("events", source.events);
  assertReferences(source, entities, documents);

  const variants: PublishedVariant[] = [];
  for (const locale of knownLocales) {
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

  const publishedEntities = new Map(
    [...entities].filter(([, entity]) => entity.published),
  );
  const publishedDocuments = new Map(
    [...documents].filter(([, document]) => document.published),
  );
  const publishedExternalActions = new Map(
    source.externalActions
      .filter((action) => isExternalActionComplete(action, defaultLocale))
      .map((action) => [action.id, action]),
  );
  const publishedContact = source.contact.find((entry) =>
    isContactComplete(entry, defaultLocale),
  );

  return {
    variants,
    entities: publishedEntities,
    documents: publishedDocuments,
    externalActions: publishedExternalActions,
    contact: publishedContact,
  };
}
