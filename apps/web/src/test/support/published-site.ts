// Expectations for the published site, derived from the content the build
// actually publishes instead of hand-written literals.
//
// E2E must assert against the built artifact, but its assertions should state
// the editorial contract, not freeze today's roster. These helpers read the
// same catalog the Astro build reads, so adding an event or a collaborator
// keeps the tests meaningful instead of failing them.

import {
  getEventHubGroups,
  getHomepageEvents,
  getNextEdition,
} from "../../lib/content/events";
import type { EventHubGroup } from "../../lib/content/events";
import { getMembersDirectoryEntities } from "../../lib/content/members";
import { getOrderedSchoolVariants } from "../../lib/content/schools";
import {
  externalActionIds,
  type Entity,
  type Event,
  type EventEdition,
  type School,
} from "../../lib/content/models";
import type { Locale } from "../../lib/content/primitives";
import type {
  PublishedVariant,
  PublicationCatalog,
} from "../../lib/content/publication";
import {
  getFixedPagePath,
  getSitemapUrls,
  getVariantPath,
} from "../../lib/content/routes";
import {
  buildCalendarMonthGrid,
  getCalendarFocusMonth,
} from "../../lib/presentation/events";
import { buildToday, loadPublicationCatalog } from "./publication-catalog";

export type PublishedSchool = {
  href: string;
  registrationUrl: string | undefined;
  school: School;
};

export type PublishedSite = {
  calendarEventTitles: string[];
  catalog: PublicationCatalog;
  collaborators: Entity[];
  eventHubGroups: Record<
    EventHubGroup,
    { event: Event; href: string; nextEdition: EventEdition | undefined }[]
  >;
  federationUrl: string | undefined;
  homepageEvents: {
    edition: EventEdition | undefined;
    event: Event;
    href: string;
  }[];
  locale: Locale;
  memberSignupUrl: string | undefined;
  membersPath: string;
  schools: PublishedSchool[];
  orderedSchools: PublishedSchool[];
  sitemapPaths: string[];
  today: string;
};

function variantsOfKind<K extends PublishedVariant["kind"]>(
  catalog: PublicationCatalog,
  kind: K,
  locale: Locale,
): Extract<PublishedVariant, { kind: K }>[] {
  return catalog.variants.filter(
    (variant): variant is Extract<PublishedVariant, { kind: K }> =>
      variant.kind === kind && variant.locale === locale,
  );
}

// Every route the build publishes, in every locale: the catalog already knows
// which variants and fixed pages are public, so a new event or school is
// covered the day it ships.
export function readPublishedPaths(catalog: PublicationCatalog): string[] {
  return [
    ...new Set(
      getSitemapUrls(catalog, new URL(publicSiteOrigin())).map(
        (url) => new URL(url).pathname,
      ),
    ),
  ].sort();
}

// The canonical origin the build used, so canonical and `og:url` assertions
// compare against the same value the pages carry.
export function publicSiteOrigin(): string {
  return process.env.PUBLIC_SITE_ORIGIN ?? "https://mountainrunners.cat";
}

export async function loadPublishedSite(
  locale: Locale = "ca",
): Promise<PublishedSite> {
  const catalog = await loadPublicationCatalog();
  const today = buildToday();

  const eventVariants = variantsOfKind(catalog, "event", locale);
  const schoolVariants = variantsOfKind(catalog, "school", locale);
  const events = eventVariants.map((variant) => variant.entry);
  const groups = getEventHubGroups(events, today);

  const hrefOf = (eventId: string) =>
    getVariantPath(
      eventVariants.find((candidate) => candidate.entry.id === eventId)!,
    );

  // The calendar only marks the events whose edition falls inside the month it
  // focuses, so its expectations are derived from that same grid.
  const focusMonth = getCalendarFocusMonth(events, today);
  const calendarGrid = buildCalendarMonthGrid(
    events,
    focusMonth.year,
    focusMonth.month,
    locale,
    today,
    (event) => hrefOf(event.id),
  );

  return {
    catalog,
    locale,
    today,
    collaborators: getMembersDirectoryEntities(catalog, locale),
    sitemapPaths: readPublishedPaths(catalog),
    homepageEvents: getHomepageEvents(events, today).map((event) => {
      const variant = eventVariants.find(
        (candidate) => candidate.entry.id === event.id,
      )!;
      return {
        event,
        edition: getNextEdition(event, today),
        href: getVariantPath(variant),
      };
    }),
    eventHubGroups: {
      upcoming: groups.upcoming.map((event) => ({
        event,
        href: hrefOf(event.id),
        nextEdition: getNextEdition(event, today),
      })),
      "active-without-date": groups["active-without-date"].map((event) => ({
        event,
        href: hrefOf(event.id),
        nextEdition: getNextEdition(event, today),
      })),
      past: groups.past.map((event) => ({
        event,
        href: hrefOf(event.id),
        nextEdition: getNextEdition(event, today),
      })),
    },
    // `orderedSchools` follows the hub editorial order; `schools` keeps the raw
    // published variant order for assertions that do not depend on it.
    schools: schoolVariants.map((variant) => ({
      school: variant.entry,
      href: getVariantPath(variant),
      registrationUrl: variant.entry.registrationUrl?.[locale],
    })),
    orderedSchools: getOrderedSchoolVariants(schoolVariants).map((variant) => ({
      school: variant.entry,
      href: getVariantPath(variant),
      registrationUrl: variant.entry.registrationUrl?.[locale],
    })),
    membersPath: getFixedPagePath("members", locale),
    memberSignupUrl: catalog.externalActions.get(externalActionIds.memberSignup)
      ?.url?.[locale],
    federationUrl: catalog.externalActions.get(externalActionIds.federation)
      ?.url?.[locale],
    calendarEventTitles: [
      ...new Set(
        calendarGrid.weeks
          .flat()
          .flatMap((day) => day.events)
          .map((calendarEvent) => calendarEvent.title),
      ),
    ].sort(),
  };
}
