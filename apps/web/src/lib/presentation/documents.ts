import type { Document } from "../content/models";
import type { Locale } from "../content/primitives";

// Canonical message keys for document availability and document types. The
// Documents directory groups entries by type and explains unavailable states
// with these keys, resolved by the components with the current locale.
export const documentAvailabilityMessageKeys = {
  "temporarily-unavailable": "document_temporarily_unavailable",
  archived: "document_archived",
} as const satisfies Record<
  Exclude<Document["availability"], "available">,
  string
>;

export type DocumentAvailabilityMessageKey =
  (typeof documentAvailabilityMessageKeys)[keyof typeof documentAvailabilityMessageKeys];

export const documentTypeOrder = [
  "regulation",
  "form",
  "minutes",
  "guide",
  "other",
] as const satisfies readonly Document["documentType"][];

export type DocumentType = (typeof documentTypeOrder)[number];

export const documentTypeMessageKeys = {
  regulation: "document_type_regulation",
  form: "document_type_form",
  minutes: "document_type_minutes",
  guide: "document_type_guide",
  other: "document_type_other",
} as const satisfies Record<Document["documentType"], string>;

export type DocumentTypeMessageKey =
  (typeof documentTypeMessageKeys)[keyof typeof documentTypeMessageKeys];

export const resourceLocaleMessageKeys = {
  ca: "language_ca",
  es: "language_es",
  en: "language_en",
} as const satisfies Record<Locale, string>;

export type ResourceLocaleMessageKey =
  (typeof resourceLocaleMessageKeys)[keyof typeof resourceLocaleMessageKeys];

// The availability key is identical in every language and the component
// resolves the text with its own locale. The locale parameter keeps the
// ADR 0006 contract that every presentation helper accepts the locale.
export function getDocumentAvailabilityMessageKey(
  availability: Document["availability"],
  locale: Locale,
): DocumentAvailabilityMessageKey | undefined {
  void locale;
  if (availability === "available") return undefined;
  return documentAvailabilityMessageKeys[availability];
}

export type DocumentGroup = {
  documentType: DocumentType;
  documents: Document[];
};

// The directory groups published documents by type in an editorial order that
// comes from code, never from the YAML files. Within a group the entries are
// ordered by translated title for the rendered locale.
export function getDocumentGroups(
  documents: readonly Document[],
  locale: Locale,
): DocumentGroup[] {
  return documentTypeOrder
    .map((documentType) => ({
      documentType,
      documents: documents
        .filter((document) => document.documentType === documentType)
        .sort((left, right) =>
          left.title[locale]!.localeCompare(right.title[locale]!, locale),
        ),
    }))
    .filter((group) => group.documents.length > 0);
}
