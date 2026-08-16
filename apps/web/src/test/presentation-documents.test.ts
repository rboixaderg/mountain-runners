import { describe, expect, it } from "vitest";
import type { Document } from "../lib/content/models";
import { formatCalendarDate } from "../lib/presentation/dates";
import {
  documentTypeMessageKeys,
  getDocumentAvailabilityMessageKey,
  getDocumentGroups,
  resourceLocaleMessageKeys,
} from "../lib/presentation/documents";
import { getExternalActionStatusMessageKey } from "../lib/presentation/status";

function makeDocument(
  id: string,
  documentType: Document["documentType"],
  title: string,
): Document {
  return {
    id,
    published: true,
    title: { ca: title },
    description: { ca: title },
    resource: {
      kind: "local",
      path: `src/content-assets/documents/${id}.pdf`,
    },
    documentType,
    availability: "available",
  };
}

describe("getDocumentAvailabilityMessageKey", () => {
  it("maps unavailable document states to their message keys", () => {
    expect(
      getDocumentAvailabilityMessageKey("temporarily-unavailable", "ca"),
    ).toBe("document_temporarily_unavailable");
    expect(getDocumentAvailabilityMessageKey("archived", "ca")).toBe(
      "document_archived",
    );
  });

  it("returns no key for an available document", () => {
    expect(
      getDocumentAvailabilityMessageKey("available", "ca"),
    ).toBeUndefined();
  });
});

describe("document directory message keys", () => {
  it("maps every document type to its directory label key", () => {
    expect(documentTypeMessageKeys).toEqual({
      regulation: "document_type_regulation",
      form: "document_type_form",
      minutes: "document_type_minutes",
      guide: "document_type_guide",
      other: "document_type_other",
    });
  });

  it("maps resource locales to language message keys", () => {
    expect(resourceLocaleMessageKeys).toEqual({
      ca: "language_ca",
      es: "language_es",
      en: "language_en",
    });
  });
});

describe("getDocumentGroups", () => {
  it("groups documents by type in the editorial order", () => {
    const documents = [
      makeDocument("club-guide", "guide", "Guia del club"),
      makeDocument("estatuts", "regulation", "Estatuts"),
      makeDocument("assembly-minutes", "minutes", "Acta"),
    ];

    expect(
      getDocumentGroups(documents, "ca").map(
        ({ documentType }) => documentType,
      ),
    ).toEqual(["regulation", "minutes", "guide"]);
  });

  it("orders entries by translated title within a group", () => {
    const documents = [
      makeDocument("berga-guide", "guide", "Berga"),
      makeDocument("barcelona-guide", "guide", "Barcelona"),
    ];

    const guideGroup = getDocumentGroups(documents, "ca")[0]!;
    expect(guideGroup.documents.map(({ id }) => id)).toEqual([
      "barcelona-guide",
      "berga-guide",
    ]);
  });

  it("skips document types without entries", () => {
    const documents = [makeDocument("estatuts", "regulation", "Estatuts")];

    expect(getDocumentGroups(documents, "ca")).toHaveLength(1);
  });
});

describe("formatCalendarDate", () => {
  it("formats a calendar date for the Catalan locale", () => {
    expect(formatCalendarDate("2026-07-15", "ca")).toBe(
      "15 de juliol del 2026",
    );
  });

  it("formats a calendar date for the Spanish locale", () => {
    expect(formatCalendarDate("2026-07-15", "es")).toBe("15 de julio de 2026");
  });
});

describe("getExternalActionStatusMessageKey", () => {
  it("returns no key for an available action or a missing one", () => {
    expect(
      getExternalActionStatusMessageKey("available", "ca"),
    ).toBeUndefined();
    expect(getExternalActionStatusMessageKey(undefined, "ca")).toBeUndefined();
  });

  it("maps every unavailable status to its message key", () => {
    expect(getExternalActionStatusMessageKey("coming-soon", "ca")).toBe(
      "external_action_coming_soon",
    );
    expect(
      getExternalActionStatusMessageKey("temporarily-unavailable", "ca"),
    ).toBe("external_action_temporarily_unavailable");
    expect(getExternalActionStatusMessageKey("unavailable", "ca")).toBe(
      "external_action_unavailable",
    );
  });
});
