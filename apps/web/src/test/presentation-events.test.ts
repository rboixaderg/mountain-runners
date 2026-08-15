import { describe, expect, it } from "vitest";
import type { Event } from "../lib/content/models";
import {
  buildCalendarMonthGrid,
  collectCalendarDayEvents,
  getCalendarFocusMonth,
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
  it("highlights single-day and multi-day events in the focused month", () => {
    const grid = buildCalendarMonthGrid(
      [multiDayEvent, singleDayEvent],
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
        location: "Berga",
        title: "Berga Trail",
        year: "2022",
      },
    ]);
  });
});
