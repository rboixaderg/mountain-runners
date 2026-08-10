import type { Event, EventEdition } from "./models";
import type { Locale } from "./primitives";

export type StructuredData = Record<string, unknown>;

const jsonLdScriptType = "application/ld+json";

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

export function renderJsonLdScript(value: unknown): string {
  return `<script type="${jsonLdScriptType}">${serializeJsonLd(value)}</script>`;
}

export function getOrganizationJsonLd(params: {
  name: string;
  siteUrl: URL;
}): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: params.name,
    url: params.siteUrl.toString(),
  };
}

export function getWebSiteJsonLd(params: {
  name: string;
  siteUrl: URL;
}): StructuredData {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: params.name,
    url: params.siteUrl.toString(),
  };
}

/**
 * Structured data for the homepage. Emits nothing when the reviewed site
 * entity is missing for the current locale: structured data must never be
 * generated from placeholder or unreviewed data.
 */
export function getSiteJsonLd(params: {
  name: string | undefined;
  siteUrl: URL;
}): StructuredData[] {
  if (params.name === undefined) {
    return [];
  }
  return [
    getOrganizationJsonLd({ name: params.name, siteUrl: params.siteUrl }),
    getWebSiteJsonLd({ name: params.name, siteUrl: params.siteUrl }),
  ];
}

export function getEventJsonLd(params: {
  event: Event;
  edition: EventEdition;
  canonicalUrl: URL;
  locale: Locale;
  today: string;
}): StructuredData | undefined {
  const { event, edition, canonicalUrl, locale, today } = params;
  // An edition is described as long as it has not fully ended. Editions that
  // already ended are deliberately omitted: they are historical and would
  // otherwise appear as upcoming in rich results.
  //
  // An edition already under way without a declared end date (endDate is
  // undefined, so its start date falls before today) is also omitted: the
  // start date alone would misrepresent it as upcoming and schema.org offers
  // no reliable "in progress" status. The visible page still renders it as
  // "en curs"; structured data simply stays silent about it.
  const editionEnd = edition.endDate ?? edition.startDate;
  if (editionEnd < today) {
    return undefined;
  }

  const data: StructuredData = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title[locale],
    url: canonicalUrl.toString(),
    startDate: edition.startDate,
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "Place",
      name: edition.location[locale],
    },
  };
  if (edition.endDate !== undefined) {
    data.endDate = edition.endDate;
  }
  return data;
}
