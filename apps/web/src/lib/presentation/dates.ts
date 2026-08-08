import type { EventEdition } from "../content/models";
import type { Locale } from "../content/primitives";

const madridTimeZone = "Europe/Madrid";

// Dates are rendered as calendar dates at noon UTC so that the displayed day
// never shifts when converted to the Europe/Madrid time zone.
const noonUtcDate = (value: string): Date => new Date(`${value}T12:00:00Z`);

export function formatCalendarDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: madridTimeZone,
  }).format(noonUtcDate(date));
}

export function formatEditionDate(
  edition: Pick<EventEdition, "startDate" | "endDate">,
  locale: Locale,
): { startLabel: string; endLabel?: string } {
  return {
    startLabel: formatCalendarDate(edition.startDate, locale),
    endLabel:
      edition.endDate === undefined
        ? undefined
        : formatCalendarDate(edition.endDate, locale),
  };
}

export function getEditionDayMonth(
  edition: Pick<EventEdition, "startDate"> | undefined,
  locale: Locale,
): { day: string; month: string } | undefined {
  if (edition === undefined) return undefined;
  const parts = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: madridTimeZone,
  }).formatToParts(noonUtcDate(edition.startDate));
  return {
    day: parts.find(({ type }) => type === "day")?.value ?? "",
    month: parts.find(({ type }) => type === "month")?.value ?? "",
  };
}
