import { describe, expect, it } from "vitest";
import {
  getEventActivityMessageKey,
  getEventHubStatusMessageKey,
  getHomepageEventStatusMessageKey,
  getRegistrationPresentation,
} from "../lib/presentation/status";

describe("getEventActivityMessageKey", () => {
  it("maps active and historical events to their message keys", () => {
    expect(getEventActivityMessageKey(true)).toBe("event_status_active");
    expect(getEventActivityMessageKey(false)).toBe("event_status_historical");
  });
});

describe("getEventHubStatusMessageKey", () => {
  const today = "2026-08-04";

  it("marks inactive events as historical in any group", () => {
    expect(
      getEventHubStatusMessageKey(
        { active: false },
        { startDate: "2026-10-02" },
        "upcoming",
        today,
      ),
    ).toBe("event_status_historical");
  });

  it("marks active events without a next date as having no upcoming date", () => {
    expect(
      getEventHubStatusMessageKey(
        { active: true },
        { startDate: "2025-06-01" },
        "active-without-date",
        today,
      ),
    ).toBe("event_status_no_upcoming_date");
    expect(
      getEventHubStatusMessageKey({ active: true }, undefined, "past", today),
    ).toBe("event_status_no_upcoming_date");
  });

  it("marks an edition that starts today as in progress", () => {
    expect(
      getEventHubStatusMessageKey(
        { active: true },
        { startDate: today },
        "upcoming",
        today,
      ),
    ).toBe("event_status_in_progress");
  });

  it("marks a future edition as upcoming", () => {
    expect(
      getEventHubStatusMessageKey(
        { active: true },
        { startDate: "2026-10-02" },
        "upcoming",
        today,
      ),
    ).toBe("event_status_upcoming_edition");
  });

  it("marks a past group edition as in progress like the current behavior", () => {
    expect(
      getEventHubStatusMessageKey(
        { active: true },
        { startDate: "2025-06-01" },
        "past",
        today,
      ),
    ).toBe("event_status_in_progress");
  });
});

describe("getHomepageEventStatusMessageKey", () => {
  const today = "2026-08-04";

  it("reports no upcoming date without a next edition", () => {
    expect(getHomepageEventStatusMessageKey(undefined, today)).toBe(
      "event_status_no_upcoming_date",
    );
  });

  it("reports an in-progress edition that starts today", () => {
    expect(getHomepageEventStatusMessageKey({ startDate: today }, today)).toBe(
      "event_status_in_progress",
    );
  });

  it("reports a future edition as upcoming", () => {
    expect(
      getHomepageEventStatusMessageKey({ startDate: "2026-10-02" }, today),
    ).toBe("event_status_upcoming_edition");
  });
});

describe("getRegistrationPresentation", () => {
  it("falls back to unavailable without a status and without a URL", () => {
    expect(getRegistrationPresentation(undefined, undefined)).toEqual({
      key: "event_registration_unavailable",
    });
  });

  it("maps each registration status to its message key", () => {
    expect(getRegistrationPresentation("open", undefined)).toEqual({
      key: "event_registration_open",
    });
    expect(getRegistrationPresentation("closed", undefined)).toEqual({
      key: "event_registration_closed",
    });
    expect(getRegistrationPresentation("coming-soon", undefined)).toEqual({
      key: "event_registration_coming_soon",
    });
    expect(
      getRegistrationPresentation("unavailable", "https://example.org"),
    ).toEqual({
      key: "event_registration_unavailable",
    });
  });

  it("includes the URL only for an open registration that has one", () => {
    expect(
      getRegistrationPresentation("open", "https://example.org/register"),
    ).toEqual({
      key: "event_registration_open",
      url: "https://example.org/register",
    });
  });
});
