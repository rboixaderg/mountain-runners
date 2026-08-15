import { describe, expect, it } from "vitest";
import type { Event, EventEdition } from "../lib/content/models";
import {
  getEventJsonLd,
  getOrganizationJsonLd,
  getSiteJsonLd,
  getWebSiteJsonLd,
  renderJsonLdScript,
  type StructuredData,
  serializeJsonLd,
} from "../lib/content/seo";

function unescapeJsonLd(serialized: string): string {
  return serialized.replace(/\\u003c/gu, "<").replace(/\\u003e/gu, ">");
}

const event: Event = {
  id: "ultra-pirineu",
  published: true,
  slug: { ca: "ultra-pirineu" },
  active: true,
  title: { ca: "Ultra Pirineu" },
  summary: { ca: "Cursa de muntanya." },
  description: { ca: "Cursa de muntanya." },
  clubRelationship: "collaborates",
  cover: {
    resource: { kind: "local", path: "src/assets/logo_mountain_runners.png" },
    alt: { ca: "Logotip de Mountain Runners del Berguedà" },
  },
  gallery: [],
  videoUrls: [],
  organizerIds: ["mountain-runners"],
  collaboratorIds: [],
  editions: [],
};

function edition(overrides: Partial<EventEdition> = {}): EventEdition {
  return {
    id: "edition-2026",
    startDate: "2026-10-02",
    endDate: "2026-10-04",
    location: { ca: "Bagà" },
    modalities: [{ ca: "KV vertical" }],
    registrationStatus: "closed",
    documentIds: [],
    ...overrides,
  };
}

describe("JSON-LD serialization", () => {
  it("escapes script-closing sequences and angle brackets in final HTML", () => {
    const value = {
      name: "</script><script>alert(1)</script>",
    };
    const html = renderJsonLdScript(value);
    const scriptContent = html.slice(
      '<script type="application/ld+json">'.length,
      -"</script>".length,
    );

    expect(html).toContain('<script type="application/ld+json">');
    expect(scriptContent).not.toContain("</script>");
    expect(scriptContent).not.toContain("<script>");
    expect(scriptContent).toContain("\\u003c/script\\u003e");
  });

  it("escapes ampersands, encoded variants and unusual unicode", () => {
    const value = {
      text: 'a & b < c > d "e" \u2028\u2029',
    };
    const serialized = serializeJsonLd(value);

    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(serialized).toContain("\\u0026");
    expect(serialized).toContain("\\u003c");
    expect(serialized).toContain("\\u003e");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
  });

  it("round-trips the escaped JSON-LD back to the original value", () => {
    const value = {
      name: "Mountain Runners del Berguedà",
      note: "</script> & <tag> \u2028 line",
    };
    const scriptContent = renderJsonLdScript(value).slice(
      '<script type="application/ld+json">'.length,
      -"</script>".length,
    );
    const parsed = JSON.parse(unescapeJsonLd(scriptContent)) as {
      name: string;
      note: string;
    };

    expect(parsed.name).toBe(value.name);
    expect(parsed.note).toBe(value.note);
  });
});

describe("organization and website structured data", () => {
  it("exposes only reviewed public organization data", () => {
    const data = getOrganizationJsonLd({
      name: "Mountain Runners del Berguedà",
      siteUrl: new URL("https://mountainrunners.cat"),
    });

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Mountain Runners del Berguedà",
      url: "https://mountainrunners.cat/",
    });
  });

  it("exposes the canonical website identity", () => {
    const data = getWebSiteJsonLd({
      name: "Mountain Runners del Berguedà",
      siteUrl: new URL("https://mountainrunners.cat"),
    });

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Mountain Runners del Berguedà",
      url: "https://mountainrunners.cat/",
    });
  });
});

describe("homepage structured data", () => {
  it("emits Organization and WebSite from the reviewed entity name", () => {
    const data = getSiteJsonLd({
      name: "Mountain Runners del Berguedà",
      siteUrl: new URL("https://mountainrunners.cat"),
    });

    expect(data).toEqual([
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Mountain Runners del Berguedà",
        url: "https://mountainrunners.cat/",
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Mountain Runners del Berguedà",
        url: "https://mountainrunners.cat/",
      },
    ]);
  });

  it("emits nothing when the reviewed entity is missing for the locale", () => {
    expect(
      getSiteJsonLd({
        name: undefined,
        siteUrl: new URL("https://mountainrunners.cat"),
      }),
    ).toEqual([]);
  });
});

describe("event structured data", () => {
  it("generates Event data that matches visible content for a future edition", () => {
    const data = getEventJsonLd({
      event,
      edition: edition(),
      canonicalUrl: new URL(
        "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      ),
      locale: "ca",
      today: "2026-08-04",
    });

    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Ultra Pirineu",
      url: "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      startDate: "2026-10-02",
      endDate: "2026-10-04",
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: "Bagà" },
    });
    expect(data).not.toHaveProperty("offers");
    expect(data).not.toHaveProperty("performer");
  });

  it("omits the end date when the edition does not announce one", () => {
    const data = getEventJsonLd({
      event,
      edition: edition({ endDate: undefined }),
      canonicalUrl: new URL(
        "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      ),
      locale: "ca",
      today: "2026-08-04",
    }) as StructuredData;

    expect(data.endDate).toBeUndefined();
    expect(data.startDate).toBe("2026-10-02");
  });

  it("omits Event data for editions that already ended", () => {
    const data = getEventJsonLd({
      event,
      edition: edition({ startDate: "2025-10-02", endDate: "2025-10-04" }),
      canonicalUrl: new URL(
        "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      ),
      locale: "ca",
      today: "2026-08-04",
    });

    expect(data).toBeUndefined();
  });

  it("keeps Event data when the edition ends exactly today", () => {
    const data = getEventJsonLd({
      event,
      edition: edition({ startDate: "2026-08-02", endDate: "2026-08-04" }),
      canonicalUrl: new URL(
        "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      ),
      locale: "ca",
      today: "2026-08-04",
    });

    expect(data).toBeDefined();
  });

  it("omits an edition under way without a declared end date", () => {
    const data = getEventJsonLd({
      event,
      edition: edition({ startDate: "2026-08-01", endDate: undefined }),
      canonicalUrl: new URL(
        "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      ),
      locale: "ca",
      today: "2026-08-04",
    });

    // The page renders the edition as "en curs", but the single start date
    // would misrepresent it as upcoming and schema.org has no reliable
    // "in progress" status, so structured data stays silent.
    expect(data).toBeUndefined();
  });

  it("keeps Event data for an edition in progress today", () => {
    const data = getEventJsonLd({
      event,
      edition: edition({ startDate: "2026-08-02", endDate: "2026-08-06" }),
      canonicalUrl: new URL(
        "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      ),
      locale: "ca",
      today: "2026-08-04",
    });

    expect(data).toBeDefined();
  });

  it("keeps a single-day future edition with an explicit end date", () => {
    const data = getEventJsonLd({
      event,
      edition: edition({ startDate: "2026-10-02", endDate: "2026-10-02" }),
      canonicalUrl: new URL(
        "https://mountainrunners.cat/ca/esdeveniments/ultra-pirineu/",
      ),
      locale: "ca",
      today: "2026-08-04",
    }) as StructuredData;

    expect(data.startDate).toBe("2026-10-02");
    expect(data.endDate).toBe("2026-10-02");
  });
});
