import { afterEach, describe, expect, it, vi } from "vitest";
import {
  plausibleAnalytics,
  plausibleScriptSrc,
} from "../lib/analytics/plausible";

describe("plausible analytics constants", () => {
  it("points the public script at the self-hosted origin", () => {
    expect(plausibleAnalytics.origin).toBe("https://analytics.rogerbg.cat");
    expect(plausibleScriptSrc).toBe(
      "https://analytics.rogerbg.cat/js/pa-gRKxE0JnFqvhkV5c5BUwD.js",
    );
  });
});

describe("analytics availability", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables analytics when the build is not a preview", async () => {
    vi.stubEnv("PUBLIC_PREVIEW", undefined);
    vi.resetModules();
    const { analyticsEnabled, isPreviewBuild } =
      await import("../lib/analytics/plausible");

    expect(isPreviewBuild).toBe(false);
    expect(analyticsEnabled).toBe(true);
  });

  it("disables analytics when the build is a preview", async () => {
    vi.stubEnv("PUBLIC_PREVIEW", "true");
    vi.resetModules();
    const { analyticsEnabled, isPreviewBuild } =
      await import("../lib/analytics/plausible");

    expect(isPreviewBuild).toBe(true);
    expect(analyticsEnabled).toBe(false);
  });
});
