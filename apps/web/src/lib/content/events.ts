import type { Event } from "./models";
import type { Locale } from "./primitives";

export function getMadridDate(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/Madrid",
      year: "numeric",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getNextEdition(event: Event, today: string) {
  return event.editions.reduce<(typeof event.editions)[number] | undefined>(
    (nextEdition, edition) =>
      (edition.endDate ?? edition.startDate) >= today &&
      (nextEdition === undefined || edition.startDate < nextEdition.startDate)
        ? edition
        : nextEdition,
    undefined,
  );
}

function getLatestEditionDate(event: Event): string {
  return event.editions.reduce(
    (latestDate, edition) =>
      (edition.endDate ?? edition.startDate) > latestDate
        ? (edition.endDate ?? edition.startDate)
        : latestDate,
    "",
  );
}

function sortById(events: readonly Event[]): Event[] {
  return [...events].sort((left, right) => left.id.localeCompare(right.id));
}

function sortUpcoming(events: readonly Event[], today: string): Event[] {
  return [...events]
    .map((event) => ({ event, nextEdition: getNextEdition(event, today) }))
    .sort(
      (left, right) =>
        left.nextEdition!.startDate.localeCompare(
          right.nextEdition!.startDate,
        ) || left.event.id.localeCompare(right.event.id),
    )
    .map(({ event }) => event);
}

function sortPast(events: readonly Event[]): Event[] {
  return [...events].sort(
    (left, right) =>
      getLatestEditionDate(right).localeCompare(getLatestEditionDate(left)) ||
      left.id.localeCompare(right.id),
  );
}

export type EventHubGroup = "upcoming" | "active-without-date" | "past";

export function getEventHubGroups(
  events: readonly Event[],
  today: string,
): Record<EventHubGroup, Event[]> {
  const upcoming: Event[] = [];
  const activeWithoutDate: Event[] = [];
  const past: Event[] = [];

  for (const event of events) {
    if (!event.active) {
      past.push(event);
    } else if (getNextEdition(event, today) !== undefined) {
      upcoming.push(event);
    } else {
      activeWithoutDate.push(event);
    }
  }

  return {
    upcoming: sortUpcoming(upcoming, today),
    "active-without-date": sortById(activeWithoutDate),
    past: sortPast(past),
  };
}

export function getHomepageEvents(
  events: readonly Event[],
  today: string,
): Event[] {
  const groups = getEventHubGroups(events, today);
  return [...groups.upcoming, ...groups["active-without-date"]];
}

export function getLatestEdition(event: Event) {
  return event.editions.reduce<(typeof event.editions)[number] | undefined>(
    (latestEdition, edition) =>
      latestEdition === undefined ||
      (edition.endDate ?? edition.startDate) >
        (latestEdition.endDate ?? latestEdition.startDate)
        ? edition
        : latestEdition,
    undefined,
  );
}

export function getMostRelevantEdition(event: Event, today: string) {
  return getNextEdition(event, today) ?? getLatestEdition(event);
}

export function getPreviousEditions(event: Event, today: string) {
  return event.editions
    .filter((edition) => (edition.endDate ?? edition.startDate) < today)
    .sort((left, right) =>
      (right.endDate ?? right.startDate).localeCompare(
        left.endDate ?? left.startDate,
      ),
    );
}

export function getRegistrationUrl(
  event: Event,
  edition: (typeof event.editions)[number] | undefined,
  locale: Locale,
): string | undefined {
  return edition?.registrationUrl?.[locale] ?? event.registrationUrl?.[locale];
}

export function assertEventDateConsistency(
  events: readonly Event[],
  today: string,
): void {
  for (const event of events) {
    if (event.published && !event.active) {
      const currentOrFutureEdition = getNextEdition(event, today);
      if (currentOrFutureEdition !== undefined) {
        throw new Error(
          `Inactive published event ${event.id} has a current or future edition: ${currentOrFutureEdition.id}`,
        );
      }
    }
  }
}
