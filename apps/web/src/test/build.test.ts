import { afterEach, describe, expect, it, vi } from "vitest";

describe("preview build mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, "false", "TRUE", "true"])(
    "enables preview only for the exact true string: %s",
    async (previewValue) => {
      vi.stubEnv("PUBLIC_PREVIEW", previewValue);
      vi.resetModules();
      const { isPreviewBuild } = await import("../lib/build");

      expect(isPreviewBuild).toBe(previewValue === "true");
    },
  );
});
