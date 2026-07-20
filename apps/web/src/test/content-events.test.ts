import { describe, expect, it } from "vitest";
import {
  getHomepageEvents,
  getMadridDate,
  getNextEdition,
} from "../lib/content/events";
import type { Event } from "../lib/content/models";

function createEvent(id: string, active: boolean, dates: string[]): Event {
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

  it("returns the nearest upcoming edition when dates are unordered", () => {
    expect(
      getNextEdition(
        createEvent("multiple-dates", true, ["2027-06-01", "2027-05-01"]),
        "2027-04-01",
      )?.startDate,
    ).toBe("2027-05-01");
  });

  it("uses the Europe/Madrid calendar date", () => {
    expect(getMadridDate(new Date("2027-04-01T22:30:00Z"))).toBe("2027-04-02");
  });
});
