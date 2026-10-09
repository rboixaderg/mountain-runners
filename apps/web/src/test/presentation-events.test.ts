import { describe, expect, it } from "vitest";
import type { Event } from "../lib/content/models";
import {
  buildCalendarMonthGrid,
  collectCalendarDayEvents,
  getCalendarFocusMonth,
  getCalendarMonthRange,
  getEditionInclusiveDates,
  getEventHistoryRows,
} from "../lib/presentation/events";

const resolveEventHref = (event: Event) => `/ca/esdeveniments/${event.id}/`;

const multiDayEvent = {
  id: "ultra",
  title: { ca: "Ultra Pirineu" },
  editions: [
    {
      id: "edition-2026",
      startDate: "2026-10-02",
      endDate: "2026-10-04",
      location: { ca: "Bagà" },
    },
  ],
} as Event;

const singleDayEvent = {
  id: "trail",
  title: { ca: "Berga Trail" },
  editions: [
    {
      id: "edition-2026",
      startDate: "2026-10-12",
      location: { ca: "Berga" },
    },
  ],
} as Event;

describe("getEditionInclusiveDates", () => {
  it("returns every day in a multi-day edition", () => {
    expect(
      getEditionInclusiveDates({
        startDate: "2026-10-02",
        endDate: "2026-10-04",
      }),
    ).toEqual(["2026-10-02", "2026-10-03", "2026-10-04"]);
  });

  it("returns a single day when no end date is provided", () => {
    expect(getEditionInclusiveDates({ startDate: "2026-10-12" })).toEqual([
      "2026-10-12",
    ]);
  });
});

describe("collectCalendarDayEvents", () => {
  it("marks every day in a multi-day span with minimal event data", () => {
    const dayEvents = collectCalendarDayEvents(
      [multiDayEvent],
      2026,
      10,
      "ca",
      resolveEventHref,
    );

    const octoberSecond = dayEvents.get("2026-10-02")?.[0];
    expect(octoberSecond).toMatchObject({
      title: "Ultra Pirineu",
      location: "Bagà",
      href: "/ca/esdeveniments/ultra/",
      isMultiDay: true,
      position: "start",
    });
    expect(octoberSecond?.dateLabel).toContain("2026");
    expect(dayEvents.get("2026-10-03")?.[0]?.position).toBe("middle");
    expect(dayEvents.get("2026-10-04")?.[0]?.position).toBe("end");
  });
});

describe("buildCalendarMonthGrid", () => {
  it("groups overlapping events by day and highlights multi-day spans", () => {
    const overlappingEvent = {
      ...singleDayEvent,
      id: "overlap",
      title: { ca: "Trail compartit" },
      editions: [{ ...singleDayEvent.editions[0]!, startDate: "2026-10-03" }],
    };
    const grid = buildCalendarMonthGrid(
      [multiDayEvent, singleDayEvent, overlappingEvent],
      2026,
      10,
      "ca",
      "2026-08-09",
      resolveEventHref,
    );

    const octoberDays = grid.weeks
      .flat()
      .filter((day) => day.date !== null && day.events.length > 0);

    expect(octoberDays.map((day) => day.date)).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-12",
    ]);
    expect(octoberDays[0]?.events[0]?.href).toBe("/ca/esdeveniments/ultra/");
    expect(octoberDays[0]?.isRangeStart).toBe(true);
    expect(octoberDays[1]?.isRangeMiddle).toBe(true);
    expect(octoberDays[1]?.events.map((event) => event.title)).toEqual([
      "Ultra Pirineu",
      "Trail compartit",
    ]);
    expect(octoberDays[2]?.isRangeEnd).toBe(true);
    expect(octoberDays[3]?.isMultiDay).toBe(false);
  });
});

describe("getCalendarFocusMonth", () => {
  it("uses the month of the nearest upcoming edition", () => {
    expect(
      getCalendarFocusMonth([multiDayEvent, singleDayEvent], "2026-08-09"),
    ).toEqual({ year: 2026, month: 10 });
  });

  it("falls back to the current month when no upcoming edition exists", () => {
    expect(getCalendarFocusMonth([singleDayEvent], "2026-11-01")).toEqual({
      year: 2026,
      month: 11,
    });
  });
});

describe("getCalendarMonthRange", () => {
  it("navigates from twelve months before the focus month to the furthest upcoming edition", () => {
    const farFutureEvent = {
      id: "winter",
      title: { ca: "Winter stage" },
      editions: [
        {
          id: "edition-2027",
          startDate: "2027-02-11",
          location: { ca: "Berga" },
        },
      ],
    } as Event;

    expect(
      getCalendarMonthRange([multiDayEvent, farFutureEvent], "2026-08-09"),
    ).toEqual({
      focusIndex: 12,
      months: [
        { year: 2025, month: 10 },
        { year: 2025, month: 11 },
        { year: 2025, month: 12 },
        { year: 2026, month: 1 },
        { year: 2026, month: 2 },
        { year: 2026, month: 3 },
        { year: 2026, month: 4 },
        { year: 2026, month: 5 },
        { year: 2026, month: 6 },
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
        { year: 2026, month: 10 },
        { year: 2026, month: 11 },
        { year: 2026, month: 12 },
        { year: 2027, month: 1 },
        { year: 2027, month: 2 },
      ],
    });
  });

  it("uses the end date, not the start date, of the furthest edition", () => {
    const yearSpanningEvent = {
      id: "winter",
      title: { ca: "Winter stage" },
      editions: [
        {
          id: "edition-2027",
          startDate: "2026-11-30",
          endDate: "2026-12-02",
          location: { ca: "Berga" },
        },
      ],
    } as Event;

    const { months } = getCalendarMonthRange([yearSpanningEvent], "2026-08-09");

    expect(months.at(-1)).toEqual({ year: 2026, month: 12 });
  });

  it("keeps twelve months of history when all editions are in the past", () => {
    const pastEvent = {
      ...singleDayEvent,
      editions: [{ ...singleDayEvent.editions[0], startDate: "2026-05-12" }],
    } as Event;

    const { focusIndex, months } = getCalendarMonthRange(
      [pastEvent],
      "2026-08-09",
    );

    expect(focusIndex).toBe(12);
    expect(months).toHaveLength(13);
    expect(months[0]).toEqual({ year: 2025, month: 8 });
    expect(months.at(-1)).toEqual({ year: 2026, month: 8 });
  });

  it("keeps twelve months of history when there are no events", () => {
    const { focusIndex, months } = getCalendarMonthRange([], "2026-08-09");

    expect(focusIndex).toBe(12);
    expect(months).toHaveLength(13);
    expect(months[0]).toEqual({ year: 2025, month: 8 });
    expect(months.at(-1)).toEqual({ year: 2026, month: 8 });
  });

  it("bounds the forward window so a distant edition cannot grow the page", () => {
    const distantEvent = {
      id: "distant",
      title: { ca: "Distant stage" },
      editions: [
        {
          id: "edition-2040",
          startDate: "2040-06-01",
          location: { ca: "Berga" },
        },
      ],
    } as Event;

    const { focusIndex, months } = getCalendarMonthRange(
      [multiDayEvent, distantEvent],
      "2026-08-09",
    );

    expect(focusIndex).toBe(12);
    expect(months.at(-1)).toEqual({ year: 2028, month: 4 });
  });
});

describe("getEventHistoryRows", () => {
  it("builds one row per past event using its latest edition", () => {
    const rows = getEventHistoryRows(
      [
        {
          id: "berga-trail",
          title: { ca: "Berga Trail" },
          editions: [
            {
              id: "edition-2022",
              startDate: "2022-05-21",
              location: { ca: "Berga" },
            },
          ],
        } as Event,
      ],
      "ca",
      (event) => `/ca/esdeveniments/${event.id}/`,
    );

    expect(rows).toEqual([
      {
        href: "/ca/esdeveniments/berga-trail/",
        id: "berga-trail",
        location: "Berga",
        title: "Berga Trail",
        year: "2022",
      },
    ]);
  });
});
