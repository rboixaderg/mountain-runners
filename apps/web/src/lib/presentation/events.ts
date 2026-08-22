import { getLatestEdition, getNextEdition } from "../content/events";
import type { Event, EventEdition } from "../content/models";
import type { Locale } from "../content/primitives";
import { formatEditionDate } from "./dates";

const madridTimeZone = "Europe/Madrid";

const noonUtcDate = (value: string): Date => new Date(`${value}T12:00:00Z`);

export type CalendarDayEventSummary = {
  dateLabel: string;
  href: string;
  id: string;
  isMultiDay: boolean;
  location: string;
  position: "single" | "start" | "middle" | "end";
  title: string;
};

export type CalendarMonthDay = {
  date: string | null;
  dayNumber: number | null;
  events: readonly CalendarDayEventSummary[];
  isCurrentMonth: boolean;
  isMultiDay: boolean;
  isRangeEnd: boolean;
  isRangeMiddle: boolean;
  isRangeStart: boolean;
  isToday: boolean;
};

export type CalendarMonthGrid = {
  month: number;
  monthLabel: string;
  weekdayLabels: readonly string[];
  weeks: readonly (readonly CalendarMonthDay[])[];
  year: number;
};

export type EventHistoryRow = {
  href: string;
  id: string;
  location: string;
  title: string;
  year: string;
};

function parseIsoDateParts(date: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(date: string, amount: number): string {
  const nextDate = noonUtcDate(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + amount);
  return formatIsoDate(nextDate);
}

export function getEditionInclusiveDates(
  edition: Pick<EventEdition, "startDate" | "endDate">,
): string[] {
  const endDate = edition.endDate ?? edition.startDate;
  const dates: string[] = [];
  let currentDate = edition.startDate;

  while (currentDate <= endDate) {
    dates.push(currentDate);
    if (currentDate === endDate) break;
    currentDate = addCalendarDays(currentDate, 1);
  }

  return dates;
}

function dateOverlapsMonth(date: string, year: number, month: number): boolean {
  const parts = parseIsoDateParts(date);
  return parts.year === year && parts.month === month;
}

function editionOverlapsMonth(
  edition: Pick<EventEdition, "startDate" | "endDate">,
  year: number,
  month: number,
): boolean {
  return getEditionInclusiveDates(edition).some((date) =>
    dateOverlapsMonth(date, year, month),
  );
}

function formatCalendarEditionDateLabel(
  edition: Pick<EventEdition, "startDate" | "endDate">,
  locale: Locale,
): string {
  const { startLabel, endLabel } = formatEditionDate(edition, locale);
  if (endLabel === undefined || endLabel === startLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

function getRangePosition(
  date: string,
  edition: Pick<EventEdition, "startDate" | "endDate">,
): CalendarDayEventSummary["position"] {
  const endDate = edition.endDate ?? edition.startDate;
  if (edition.startDate === endDate) return "single";
  if (date === edition.startDate) return "start";
  if (date === endDate) return "end";
  return "middle";
}

export function collectCalendarDayEvents(
  events: readonly Event[],
  year: number,
  month: number,
  locale: Locale,
  resolveEventHref: (event: Event) => string,
): Map<string, CalendarDayEventSummary[]> {
  const dayEvents = new Map<string, CalendarDayEventSummary[]>();

  for (const event of events) {
    for (const edition of event.editions) {
      if (!editionOverlapsMonth(edition, year, month)) continue;

      const title = event.title[locale];
      const location = edition.location[locale];
      if (title === undefined || location === undefined) continue;

      const isMultiDay =
        edition.endDate !== undefined && edition.endDate !== edition.startDate;
      const summary: CalendarDayEventSummary = {
        title,
        location,
        href: resolveEventHref(event),
        id: event.id,
        dateLabel: formatCalendarEditionDateLabel(edition, locale),
        isMultiDay,
        position: "single",
      };

      for (const date of getEditionInclusiveDates(edition)) {
        if (!dateOverlapsMonth(date, year, month)) continue;

        const entries = dayEvents.get(date) ?? [];
        if (
          entries.some(
            (entry) =>
              entry.href === summary.href &&
              entry.dateLabel === summary.dateLabel,
          )
        ) {
          continue;
        }

        entries.push({
          ...summary,
          position: getRangePosition(date, edition),
        });
        dayEvents.set(date, entries);
      }
    }
  }

  return dayEvents;
}

export function getCalendarFocusMonth(
  events: readonly Event[],
  today: string,
): { year: number; month: number } {
  let nearestUpcomingDate: string | undefined;

  for (const event of events) {
    const nextEdition = getNextEdition(event, today);
    if (nextEdition === undefined) continue;
    if (
      nearestUpcomingDate === undefined ||
      nextEdition.startDate < nearestUpcomingDate
    ) {
      nearestUpcomingDate = nextEdition.startDate;
    }
  }

  if (nearestUpcomingDate !== undefined) {
    const parts = parseIsoDateParts(nearestUpcomingDate);
    return { year: parts.year, month: parts.month };
  }

  const todayParts = parseIsoDateParts(today);
  return { year: todayParts.year, month: todayParts.month };
}

function getWeekdayLabels(locale: Locale): string[] {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: madridTimeZone,
  });
  const monday = noonUtcDate("2024-01-01");

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return formatter.format(date);
  });
}

function getMonthLabel(year: number, month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: madridTimeZone,
    year: "numeric",
  }).format(noonUtcDate(`${year}-${String(month).padStart(2, "0")}-01`));
}

function buildMonthDays(year: number, month: number): string[] {
  const firstDay = noonUtcDate(`${year}-${String(month).padStart(2, "0")}-01`);
  const weekdayIndex = (firstDay.getUTCDay() + 6) % 7;
  const gridStart = addCalendarDays(formatIsoDate(firstDay), -weekdayIndex);

  const days: string[] = [];
  let currentDate = gridStart;

  for (let index = 0; index < 42; index += 1) {
    days.push(currentDate);
    currentDate = addCalendarDays(currentDate, 1);
  }

  return days;
}

function mergeDayPresentation(
  dayEvents: readonly CalendarDayEventSummary[],
): Pick<
  CalendarMonthDay,
  "events" | "isMultiDay" | "isRangeEnd" | "isRangeMiddle" | "isRangeStart"
> {
  if (dayEvents.length === 0) {
    return {
      events: dayEvents,
      isMultiDay: false,
      isRangeEnd: false,
      isRangeMiddle: false,
      isRangeStart: false,
    };
  }

  const hasMultiDay = dayEvents.some(({ isMultiDay }) => isMultiDay);
  const positions = new Set(dayEvents.map(({ position }) => position));

  return {
    events: dayEvents,
    isMultiDay: hasMultiDay,
    isRangeStart: positions.has("start") || positions.has("single"),
    isRangeEnd: positions.has("end") || positions.has("single"),
    isRangeMiddle: positions.has("middle"),
  };
}

export function buildCalendarMonthGrid(
  events: readonly Event[],
  year: number,
  month: number,
  locale: Locale,
  today: string,
  resolveEventHref: (event: Event) => string,
): CalendarMonthGrid {
  const dayEvents = collectCalendarDayEvents(
    events,
    year,
    month,
    locale,
    resolveEventHref,
  );
  const monthDays = buildMonthDays(year, month);
  const weeks: CalendarMonthDay[][] = [];

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const week: CalendarMonthDay[] = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = monthDays[weekIndex * 7 + dayIndex]!;
      const parts = parseIsoDateParts(date);
      const isCurrentMonth = parts.month === month;
      const eventsForDay = dayEvents.get(date) ?? [];
      const presentation = mergeDayPresentation(eventsForDay);

      week.push({
        date: isCurrentMonth ? date : null,
        dayNumber: isCurrentMonth ? parts.day : null,
        isCurrentMonth,
        isToday: date === today,
        ...presentation,
      });
    }

    weeks.push(week);
  }

  return {
    year,
    month,
    monthLabel: getMonthLabel(year, month, locale),
    weekdayLabels: getWeekdayLabels(locale),
    weeks,
  };
}

export function getEventHistoryRows(
  events: readonly Event[],
  locale: Locale,
  resolveHref: (event: Event) => string,
): EventHistoryRow[] {
  return events.flatMap((event) => {
    const edition = getLatestEdition(event);
    if (edition === undefined) return [];

    const title = event.title[locale];
    const location = edition.location[locale];
    if (title === undefined || location === undefined) return [];

    return [
      {
        href: resolveHref(event),
        id: event.id,
        location,
        title,
        year: parseIsoDateParts(edition.startDate).year.toString(),
      },
    ];
  });
}
