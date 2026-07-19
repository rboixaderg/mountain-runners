import type { Event } from "./models";

export function getHomepageEvents(
  events: readonly Event[],
  today: string,
): Event[] {
  return events
    .filter((event) => event.active)
    .map((event) => ({
      event,
      nextEdition: event.editions.find((edition) => edition.startDate >= today),
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
