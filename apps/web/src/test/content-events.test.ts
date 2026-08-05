import { describe, expect, it } from "vitest";
import {
  assertEventDateConsistency,
  getEventHubGroups,
  getHomepageEvents,
  getLatestEdition,
  getMadridDate,
  getMostRelevantEdition,
  getNextEdition,
  getPreviousEditions,
  getRegistrationUrl,
} from "../lib/content/events";
import type { Event } from "../lib/content/models";

function createEvent(
  id: string,
  active: boolean,
  dates: string[],
  endDates?: (string | undefined)[],
): Event {
  return {
    id,
    published: true,
    slug: { ca: id },
    active,
    title: { ca: id },
    description: { ca: id },
    clubRelationship: "organizes",
    cover: {
      resource: { kind: "external", url: "https://example.org/image.webp" },
      alt: { ca: id },
    },
    gallery: [],
    videoUrls: [],
    organizerIds: ["mountain-runners"],
    collaboratorIds: [],
    editions: dates.map((startDate, index) => ({
      id: `${id}-${index}`,
      startDate,
      ...(endDates?.[index] === undefined ? {} : { endDate: endDates[index] }),
      location: { ca: "Berga" },
      modalities: [{ ca: "Trail" }],
      registrationStatus: "closed",
      documentIds: [],
    })),
  };
}

describe("homepage events", () => {
  it("prioritizes active events with the nearest upcoming edition", () => {
    const events = getHomepageEvents(
      [
        createEvent("without-date", true, ["2025-01-01"]),
        createEvent("later", true, ["2027-06-01"]),
        createEvent("soon", true, ["2027-06-01", "2027-05-01"]),
        createEvent("historical", false, ["2027-04-01"]),
      ],
      "2027-04-01",
    );

    expect(events.map(({ id }) => id)).toEqual([
      "soon",
      "later",
      "without-date",
    ]);
  });

  it("orders two active events without an upcoming edition by id", () => {
    const events = getHomepageEvents(
      [
        createEvent("zeta", true, ["2025-02-01"]),
        createEvent("alfa", true, ["2025-01-01"]),
      ],
      "2027-01-01",
    );

    expect(events.map(({ id }) => id)).toEqual(["alfa", "zeta"]);
  });

  it("orders two upcoming events on the same date by id", () => {
    const events = getHomepageEvents(
      [
        createEvent("zebra", true, ["2027-05-01"]),
        createEvent("alpha", true, ["2027-05-01"]),
      ],
      "2027-01-01",
    );

    expect(events.map(({ id }) => id)).toEqual(["alpha", "zebra"]);
  });

  it("returns the nearest upcoming edition when dates are unordered", () => {
    expect(
      getNextEdition(
        createEvent("multiple-dates", true, ["2027-06-01", "2027-05-01"]),
        "2027-04-01",
      )?.startDate,
    ).toBe("2027-05-01");
  });

  it("includes an edition that is already in progress", () => {
    const event = createEvent(
      "in-progress",
      true,
      ["2027-04-01"],
      ["2027-04-03"],
    );

    expect(getNextEdition(event, "2027-04-02")?.id).toBe("in-progress-0");
    expect(
      getHomepageEvents(
        [createEvent("future", true, ["2027-04-04"]), event],
        "2027-04-02",
      ).map(({ id }) => id),
    ).toEqual(["in-progress", "future"]);
  });

  it("treats an edition starting today as in progress when it has no end date", () => {
    const event = createEvent("starting-today", true, ["2027-04-01"]);

    expect(getNextEdition(event, "2027-04-01")?.id).toBe("starting-today-0");
  });

  it("distinguishes upcoming editions from active events without a date", () => {
    expect(
      getNextEdition(createEvent("future", true, ["2027-04-04"]), "2027-04-02")
        ?.id,
    ).toBe("future-0");
    expect(
      getNextEdition(
        createEvent("without-date", true, ["2027-04-01"]),
        "2027-04-02",
      ),
    ).toBeUndefined();
  });

  it("uses the Europe/Madrid calendar date", () => {
    expect(getMadridDate(new Date("2027-04-01T22:30:00Z"))).toBe("2027-04-02");
  });
});

describe("events hub groups", () => {
  it("classifies upcoming, active-without-date, and past events", () => {
    const groups = getEventHubGroups(
      [
        createEvent("past", false, ["2025-01-01"]),
        createEvent("active-without-date", true, ["2025-01-01"]),
        createEvent("upcoming", true, ["2027-05-01"]),
      ],
      "2026-04-01",
    );

    expect(groups.upcoming.map(({ id }) => id)).toEqual(["upcoming"]);
    expect(groups["active-without-date"].map(({ id }) => id)).toEqual([
      "active-without-date",
    ]);
    expect(groups.past.map(({ id }) => id)).toEqual(["past"]);
  });

  it("orders upcoming editions from nearest to farthest", () => {
    const groups = getEventHubGroups(
      [
        createEvent("later", true, ["2027-06-01"]),
        createEvent("soon", true, ["2027-05-01"]),
      ],
      "2026-04-01",
    );

    expect(groups.upcoming.map(({ id }) => id)).toEqual(["soon", "later"]);
  });

  it("orders upcoming ties by stable identifier", () => {
    const groups = getEventHubGroups(
      [
        createEvent("zebra", true, ["2027-05-01"]),
        createEvent("alpha", true, ["2027-05-01"]),
      ],
      "2026-04-01",
    );

    expect(groups.upcoming.map(({ id }) => id)).toEqual(["alpha", "zebra"]);
  });

  it("orders active events without a date by identifier", () => {
    const groups = getEventHubGroups(
      [
        createEvent("zeta", true, ["2025-02-01"]),
        createEvent("alfa", true, ["2025-01-01"]),
      ],
      "2026-04-01",
    );

    expect(groups["active-without-date"].map(({ id }) => id)).toEqual([
      "alfa",
      "zeta",
    ]);
  });

  it("orders past events by most recent edition descending", () => {
    const groups = getEventHubGroups(
      [
        createEvent("older", false, ["2020-01-01"]),
        createEvent("recent", false, ["2024-01-01", "2025-01-01"]),
        createEvent("mid", false, ["2022-06-01", "2022-05-01"]),
      ],
      "2026-04-01",
    );

    expect(groups.past.map(({ id }) => id)).toEqual(["recent", "mid", "older"]);
  });

  it("orders past ties by stable identifier", () => {
    const groups = getEventHubGroups(
      [
        createEvent("zebra", false, ["2024-01-01"]),
        createEvent("alpha", false, ["2024-01-01"]),
      ],
      "2026-04-01",
    );

    expect(groups.past.map(({ id }) => id)).toEqual(["alpha", "zebra"]);
  });

  it("orders past events by the latest edition end date", () => {
    const groups = getEventHubGroups(
      [
        createEvent("short", false, ["2025-01-01"], ["2025-01-03"]),
        createEvent("longer", false, ["2025-01-02"]),
      ],
      "2026-04-01",
    );

    expect(groups.past.map(({ id }) => id)).toEqual(["short", "longer"]);
  });

  it("places past events without editions after dated events", () => {
    const groups = getEventHubGroups(
      [
        createEvent("without-editions", false, []),
        createEvent("dated", false, ["2025-01-01"]),
      ],
      "2026-04-01",
    );

    expect(groups.past.map(({ id }) => id)).toEqual([
      "dated",
      "without-editions",
    ]);
  });
});

describe("relevant edition", () => {
  it("resolves the next edition when it exists", () => {
    const event = createEvent("both", true, ["2025-01-01", "2027-05-01"]);

    expect(getMostRelevantEdition(event, "2026-04-01")?.id).toBe("both-1");
    expect(getNextEdition(event, "2026-04-01")?.id).toBe("both-1");
  });

  it("falls back to the latest edition without an upcoming date", () => {
    const event = createEvent("past-only", true, ["2025-01-01", "2025-06-01"]);

    expect(getNextEdition(event, "2026-04-01")).toBeUndefined();
    expect(getMostRelevantEdition(event, "2026-04-01")?.id).toBe("past-only-1");
    expect(getLatestEdition(event)?.id).toBe("past-only-1");
  });

  it("supports an active event without any edition", () => {
    const event = createEvent("without-editions", true, []);

    expect(getMostRelevantEdition(event, "2026-04-01")).toBeUndefined();
    expect(
      getEventHubGroups([event], "2026-04-01")["active-without-date"],
    ).toEqual([event]);
  });

  it("uses the end date to resolve the latest edition", () => {
    const event = createEvent(
      "multi",
      true,
      ["2025-01-01", "2025-06-01"],
      ["2025-12-31"],
    );

    expect(getLatestEdition(event)?.id).toBe("multi-0");
  });

  it("lists only ended editions as previous editions", () => {
    const event = createEvent("editions", true, [
      "2025-06-01",
      "2026-05-01",
      "2026-10-01",
      "2027-01-01",
    ]);

    expect(
      getPreviousEditions(event, "2026-06-01").map(({ id }) => id),
    ).toEqual(["editions-1", "editions-0"]);
  });
});

describe("editorial date consistency", () => {
  it("rejects a published inactive event with a future edition", () => {
    expect(() =>
      assertEventDateConsistency(
        [createEvent("inactive-future", false, ["2027-05-01"])],
        "2026-04-01",
      ),
    ).toThrow("Inactive published event inactive-future");
  });

  it("rejects a published inactive event with an edition in progress", () => {
    expect(() =>
      assertEventDateConsistency(
        [
          createEvent(
            "inactive-current",
            false,
            ["2026-04-01"],
            ["2026-04-03"],
          ),
        ],
        "2026-04-02",
      ),
    ).toThrow("Inactive published event inactive-current");
  });

  it("accepts an inactive event whose editions are all past", () => {
    expect(() =>
      assertEventDateConsistency(
        [createEvent("inactive-past", false, ["2025-01-01"])],
        "2026-04-01",
      ),
    ).not.toThrow();
  });

  it("ignores unpublished events and active published events", () => {
    const unpublished = createEvent("draft", false, ["2027-05-01"]);
    unpublished.published = false;

    expect(() =>
      assertEventDateConsistency(
        [unpublished, createEvent("active-future", true, ["2027-05-01"])],
        "2026-04-01",
      ),
    ).not.toThrow();
  });

  it("uses an edition URL and falls back to the event URL", () => {
    const event = createEvent("registration", true, ["2027-05-01"]);
    event.registrationUrl = { ca: "https://example.org/event" };
    event.editions[0]!.registrationStatus = "open";

    expect(getRegistrationUrl(event, event.editions[0], "ca")).toBe(
      "https://example.org/event",
    );
    event.editions[0]!.registrationUrl = {
      ca: "https://example.org/edition",
    };
    expect(getRegistrationUrl(event, event.editions[0], "ca")).toBe(
      "https://example.org/edition",
    );
  });
});
