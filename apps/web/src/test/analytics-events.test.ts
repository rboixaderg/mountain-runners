import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyticsActions,
  analyticsAreas,
  analyticsEventNames,
  analyticsPageTypes,
  buildAnalyticsEventProps,
  buildDwellEventProps,
  dwellTimeThresholdsSeconds,
  sanitizeAnalyticsProp,
  sanitizeAnalyticsRoute,
  sanitizeAnalyticsTarget,
} from "../lib/analytics/catalog";
import { getAnalyticsPageType } from "../lib/analytics/page-type";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const plausibleEventsScript = readFileSync(
  join(testDirectory, "../../public/js/plausible-events.js"),
  "utf8",
);

describe("analytics catalog", () => {
  it("sanitizes targets and props without accepting free-form identifiers", () => {
    expect(sanitizeAnalyticsTarget("Berga Trail 2026")).toBe(
      "berga_trail_2026",
    );
    expect(sanitizeAnalyticsTarget("")).toBe("unknown");
    expect(sanitizeAnalyticsTarget("a@b.c")).toBe("a_b_c");
    expect(sanitizeAnalyticsProp("ca")).toBe("ca");
    expect(sanitizeAnalyticsProp("")).toBe("unknown");
  });

  it("drops query strings and fragments from routes", () => {
    expect(sanitizeAnalyticsRoute("/ca/socis/?utm=test#section")).toBe(
      "/ca/socis/",
    );
  });

  it("builds stable UI action and dwell props", () => {
    expect(
      buildAnalyticsEventProps({
        action: analyticsActions.memberSignup,
        area: analyticsAreas.headerNav,
        locale: "ca",
        pageType: analyticsPageTypes.home,
        route: "/ca/",
        target: "signup",
      }),
    ).toEqual({
      action: "member_signup",
      area: "header_nav",
      locale: "ca",
      page_type: "home",
      route: "/ca/",
      target: "signup",
    });

    expect(
      buildDwellEventProps({
        locale: "ca",
        pageType: analyticsPageTypes.eventsHub,
        route: "/ca/esdeveniments/",
        thresholdSeconds: 30,
      }),
    ).toEqual({
      locale: "ca",
      page_type: "events_hub",
      route: "/ca/esdeveniments/",
      threshold: "30",
    });
  });

  it("covers every catalog area and action with stable snake_case values", () => {
    for (const value of Object.values(analyticsAreas)) {
      expect(value).toMatch(/^[a-z0-9_]+$/u);
    }

    for (const value of Object.values(analyticsActions)) {
      expect(value).toMatch(/^[a-z0-9_]+$/u);
    }
  });
});

describe("analytics page type", () => {
  it("derives page types from localized public routes", () => {
    expect(getAnalyticsPageType("/ca/")).toBe(analyticsPageTypes.home);
    expect(getAnalyticsPageType("/ca/qui-som/")).toBe(analyticsPageTypes.about);
    expect(getAnalyticsPageType("/ca/socis/")).toBe(analyticsPageTypes.members);
    expect(getAnalyticsPageType("/ca/documents/")).toBe(
      analyticsPageTypes.documents,
    );
    expect(getAnalyticsPageType("/ca/privacitat/")).toBe(
      analyticsPageTypes.legal,
    );
    expect(getAnalyticsPageType("/ca/esdeveniments/")).toBe(
      analyticsPageTypes.eventsHub,
    );
    expect(getAnalyticsPageType("/ca/esdeveniments/ultra-pirineu/")).toBe(
      analyticsPageTypes.eventDetail,
    );
    expect(getAnalyticsPageType("/ca/escoles/trail/")).toBe(
      analyticsPageTypes.schoolDetail,
    );
    expect(getAnalyticsPageType("/en/events/")).toBe(
      analyticsPageTypes.eventsHub,
    );
  });
});

describe("plausible-events client script", () => {
  it("mirrors the TypeScript event names and dwell thresholds", () => {
    expect(plausibleEventsScript).toContain(
      `"${analyticsEventNames.uiAction}"`,
    );
    expect(plausibleEventsScript).toContain(
      `"${analyticsEventNames.pageDwell}"`,
    );

    for (const threshold of dwellTimeThresholdsSeconds) {
      expect(plausibleEventsScript).toContain(String(threshold));
    }
  });

  it("reads page context from self-hosted meta tags", () => {
    expect(plausibleEventsScript).toContain("mr-analytics-locale");
    expect(plausibleEventsScript).toContain("mr-analytics-page-type");
  });
});
