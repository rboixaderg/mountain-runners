import type { Event } from "./models";

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
      edition.startDate >= today &&
      (nextEdition === undefined || edition.startDate < nextEdition.startDate)
        ? edition
        : nextEdition,
    undefined,
  );
}

export function getHomepageEvents(
  events: readonly Event[],
  today: string,
): Event[] {
  return events
    .filter((event) => event.active)
    .map((event) => ({
      event,
      nextEdition: getNextEdition(event, today),
    }))
    .sort((left, right) => {
      if (left.nextEdition && right.nextEdition) {
        return (
          left.nextEdition.startDate.localeCompare(
            right.nextEdition.startDate,
          ) || left.event.id.localeCompare(right.event.id)
        );
      }
      if (left.nextEdition) return -1;
      if (right.nextEdition) return 1;
      return left.event.id.localeCompare(right.event.id);
    })
    .map(({ event }) => event);
}
