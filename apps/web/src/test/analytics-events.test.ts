import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyticsActions,
  analyticsAreas,
  analyticsEventNames,
  analyticsPageTypes,
  engagedTimeThresholdsSeconds,
  sanitizeAnalyticsTarget,
  scrollDepthThresholds,
} from "../lib/analytics/catalog";
import { getAnalyticsPageType } from "../lib/analytics/page-type";
import { plausibleAnalytics } from "../lib/analytics/plausible";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const plausibleEventsScript = readFileSync(
  join(testDirectory, "../../public/js/plausible-events.js"),
  "utf8",
);

describe("analytics catalog", () => {
  it("sanitizes targets without accepting free-form identifiers", () => {
    expect(sanitizeAnalyticsTarget("Berga Trail 2026")).toBe(
      "berga_trail_2026",
    );
    expect(sanitizeAnalyticsTarget("")).toBe("unknown");
    expect(sanitizeAnalyticsTarget("a@b.c")).toBe("a_b_c");
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
  it.each([
    ["/ca/noticies/", "news_hub"],
    ["/es/noticias/", "news_hub"],
    ["/en/news/", "news_hub"],
    ["/ca/noticies/exemple/", "news_detail"],
    ["/es/noticias/ejemplo/", "news_detail"],
    ["/en/news/example/", "news_detail"],
    ["/ca/blog/", "blog_hub"],
    ["/es/blog/", "blog_hub"],
    ["/en/blog/", "blog_hub"],
    ["/ca/blog/exemple/", "blog_detail"],
    ["/es/blog/ejemplo/", "blog_detail"],
    ["/en/blog/example/", "blog_detail"],
  ])("labels editorial route %s as %s", (route, pageType) => {
    expect(getAnalyticsPageType(route)).toBe(pageType);
  });
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
  it("mirrors the TypeScript event names and thresholds", () => {
    expect(plausibleEventsScript).toContain(
      `"${analyticsEventNames.uiAction}"`,
    );
    expect(plausibleEventsScript).toContain(
      `"${analyticsEventNames.engagedTime}"`,
    );
    expect(plausibleEventsScript).toContain(
      `"${analyticsEventNames.scrollDepth}"`,
    );

    for (const threshold of [
      ...engagedTimeThresholdsSeconds,
      ...scrollDepthThresholds,
    ]) {
      expect(plausibleEventsScript).toContain(String(threshold));
    }
  });

  it("mirrors the beacon endpoint and domain of the analytics instance", () => {
    expect(plausibleEventsScript).toContain(plausibleAnalytics.endpoint);
    expect(plausibleEventsScript).toContain(`"${plausibleAnalytics.domain}"`);
  });

  it("reads page context from self-hosted meta tags", () => {
    expect(plausibleEventsScript).toContain("mr-analytics-locale");
    expect(plausibleEventsScript).toContain("mr-analytics-page-type");
  });
});
