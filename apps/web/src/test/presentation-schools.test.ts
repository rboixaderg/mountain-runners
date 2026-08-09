import { describe, expect, it } from "vitest";
import type { PublicationCatalog } from "../lib/content/publication";
import {
  extractLocationParts,
  extractScheduleParts,
  formatPriceAmount,
  getSchoolNavigationItems,
  hasPreviewPriceContent,
  hasPreviewPracticalCardContent,
  hasSchoolSectionContent,
  isCompactSchedulePreview,
  orderPreviewEssentialSections,
  parsePreviewPriceSection,
  parsePriceSectionBody,
  parseSchoolPracticalSection,
  schoolPracticalSectionMessageKeys,
  schoolPracticalSectionOrder,
} from "../lib/presentation/schools";

describe("school practical presentation contract", () => {
  it("keeps practical fields in the editorial reading order", () => {
    expect(schoolPracticalSectionOrder).toEqual([
      "since",
      "purpose",
      "audience",
      "schedule",
      "location",
      "requirements",
      "prices",
    ]);
  });

  it("maps every practical field to a translated label", () => {
    expect(
      schoolPracticalSectionOrder.every((sectionKey) =>
        schoolPracticalSectionMessageKeys[sectionKey].startsWith("school_"),
      ),
    ).toBe(true);
  });

  it("splits labeled schedule content into label, lead and body", () => {
    expect(
      parseSchoolPracticalSection(
        "**Berga:** dilluns, dimecres i/o divendres de 17.30 h a 19.00 h.\n\nDurant el curs escolar.",
      ),
    ).toEqual({
      label: "Berga",
      lead: "dilluns, dimecres i/o divendres de 17.30 h a 19.00 h.",
      body: "Durant el curs escolar.",
    });
  });

  it("splits price content into intro lead and list body", () => {
    expect(
      parseSchoolPracticalSection(
        "No varia en funció de l'edat, sinó dels dies que voleu venir:\n\n- 1 dia: 30 € al mes",
      ),
    ).toEqual({
      label: null,
      lead: "No varia en funció de l'edat, sinó dels dies que voleu venir:",
      body: "- 1 dia: 30 € al mes",
    });
  });

  it("extracts schedule days and time for highlight rendering", () => {
    expect(
      extractScheduleParts(
        "dilluns, dimecres i/o divendres de 17.30 h a 19.00 h.",
      ),
    ).toEqual({
      days: "dilluns, dimecres i/o divendres",
      time: "17.30 h a 19.00 h",
    });
  });

  it("extracts location primary and secondary lines", () => {
    expect(
      extractLocationParts(
        "Sortida des de la Font Negra de Berga, amb itineraris diferents a cada sessió.",
      ),
    ).toEqual({
      primary: "Sortida des de la Font Negra de Berga",
      secondary: "amb itineraris diferents a cada sessió.",
    });
  });

  it("parses price list items and footnote", () => {
    expect(
      parsePriceSectionBody(
        "- 1 dia: 30 € al mes\n- 2 dies: 40 € al mes\n\nEls preus poden quedar subjectes a modificació.",
      ),
    ).toEqual({
      items: [
        { label: "1 dia", amount: "30 € al mes" },
        { label: "2 dies", amount: "40 € al mes" },
      ],
      footnote: "Els preus poden quedar subjectes a modificació.",
    });
  });

  it("splits preview prices into monthly tiers and registration fees", () => {
    expect(
      parsePreviewPriceSection(
        "- 1 dia: 30 € al mes\n- 2 dies: 40 € al mes\n- 3 dies: 45 € al mes\n- Matrícula primer any: 50 €; matrícula de continuïtat: 25 €\n\nEls preus poden quedar subjectes a modificació.",
      ),
    ).toEqual({
      monthlyTiers: [
        { label: "1 dia", amount: "30 € al mes" },
        { label: "2 dies", amount: "40 € al mes" },
        { label: "3 dies", amount: "45 € al mes" },
      ],
      registrationFees: [
        { label: "Matrícula primer any", amount: "50 €" },
        { label: "matrícula de continuïtat", amount: "25 €" },
      ],
      footnote: "Els preus poden quedar subjectes a modificació.",
    });
  });

  it("formats price amounts into value and unit", () => {
    expect(formatPriceAmount("30 € al mes")).toEqual({
      value: "30 €",
      unit: "al mes",
    });
  });

  it("treats whitespace-only section content as empty", () => {
    expect(hasSchoolSectionContent("   ")).toBe(false);
    expect(hasSchoolSectionContent("Horari")).toBe(true);
  });

  it("detects when preview prices have no renderable content", () => {
    expect(hasPreviewPriceContent("   ")).toBe(false);
    expect(hasPreviewPriceContent("- 1 dia: 30 € al mes")).toBe(true);
  });

  it("detects compact and detailed preview schedule formats", () => {
    const trailSchedule =
      "**Berga:** dilluns, dimecres i/o divendres de 17.30 h a 19.00 h.\n\nDurant el curs escolar.";
    const skimoSchedule =
      "**Caps de setmana**\n\n- Temporada de tardor: dissabte cada 15 dies de 9.00 h a 13.00 h";

    expect(
      isCompactSchedulePreview(parseSchoolPracticalSection(trailSchedule)),
    ).toBe(true);
    expect(
      isCompactSchedulePreview(parseSchoolPracticalSection(skimoSchedule)),
    ).toBe(false);
    expect(hasPreviewPracticalCardContent("schedule", trailSchedule)).toBe(
      true,
    );
    expect(hasPreviewPracticalCardContent("schedule", skimoSchedule)).toBe(
      true,
    );
    expect(hasPreviewPracticalCardContent("schedule", "   ")).toBe(false);
  });

  it("detects preview context cards with lead or body content", () => {
    expect(
      hasPreviewPracticalCardContent(
        "requirements",
        "- Ser soci o sòcia dels Mountain Runners.",
      ),
    ).toBe(true);
    expect(hasPreviewPracticalCardContent("since", "   ")).toBe(false);
  });

  it("moves detailed schedule cards after compact essentials", () => {
    const skimoSchedule =
      "**Caps de setmana**\n\n- Temporada de tardor: dissabte cada 15 dies de 9.00 h a 13.00 h";
    const trailSchedule =
      "**Berga:** dilluns, dimecres i/o divendres de 17.30 h a 19.00 h.";

    const sectionContentByKey = (sectionKey: string) => {
      if (sectionKey === "schedule") {
        return skimoSchedule;
      }

      if (sectionKey === "location") {
        return "Berga, Masella";
      }

      if (sectionKey === "audience") {
        return "Joves de 12 a 18 anys";
      }

      return undefined;
    };

    expect(
      orderPreviewEssentialSections(
        ["schedule", "location", "audience"],
        sectionContentByKey,
      ),
    ).toEqual(["location", "audience", "schedule"]);

    const compactSectionContentByKey = (sectionKey: string) => {
      if (sectionKey === "schedule") {
        return trailSchedule;
      }

      if (sectionKey === "location") {
        return "Font Negra de Berga";
      }

      if (sectionKey === "audience") {
        return "Infants i joves de 3 a 18 anys";
      }

      return undefined;
    };

    expect(
      orderPreviewEssentialSections(
        ["schedule", "location", "audience"],
        compactSectionContentByKey,
      ),
    ).toEqual(["schedule", "location", "audience"]);
  });
});

describe("getSchoolNavigationItems", () => {
  it("returns published schools for the locale in hub order", () => {
    const catalog = {
      variants: [
        {
          kind: "school",
          locale: "ca",
          slug: "escola-btt",
          entry: {
            id: "btt-school",
            hubOrder: 3,
            name: { ca: "Escola BTT" },
          },
        },
        {
          kind: "school",
          locale: "ca",
          slug: "escola-trail",
          entry: {
            id: "trail-school",
            hubOrder: 1,
            name: { ca: "Escola de Trail" },
          },
        },
      ],
    } as PublicationCatalog;

    expect(getSchoolNavigationItems(catalog, "ca")).toEqual([
      {
        href: "/ca/escoles/escola-trail/",
        label: "Escola de Trail",
      },
      {
        href: "/ca/escoles/escola-btt/",
        label: "Escola BTT",
      },
    ]);
  });
});
