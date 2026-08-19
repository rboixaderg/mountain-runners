import { describe, expect, it } from "vitest";
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
