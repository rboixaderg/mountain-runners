import { describe, expect, it } from "vitest";
import { parsePreviewFlag, requireArtifactMode } from "../../build-mode.mjs";

describe("explicit artifact modes", () => {
  it.each([undefined, "", "false"])("defaults %s to public", (value) => {
    expect(parsePreviewFlag(value)).toBe(false);
  });
  it("only accepts the explicit true flag", () => {
    expect(parsePreviewFlag("true")).toBe(true);
    for (const value of ["1", "TRUE", "yes", " true"]) {
      expect(() => parsePreviewFlag(value)).toThrow("PUBLIC_PREVIEW");
    }
  });
  it("pins the official mode and rejects contradictory environment values", () => {
    const production = { PUBLIC_SITE_ORIGIN: "https://mountainrunners.cat" };
    expect(requireArtifactMode(false, production)).toBe("false");
    expect(requireArtifactMode(true, {})).toBe("true");
    expect(() =>
      requireArtifactMode(false, { ...production, PUBLIC_PREVIEW: "true" }),
    ).toThrow("conflicts");
    expect(() =>
      requireArtifactMode(true, { PUBLIC_PREVIEW: "false" }),
    ).toThrow("conflicts");
    expect(() =>
      requireArtifactMode(false, {
        PUBLIC_SITE_ORIGIN: "https://pr-1.preview.mountainrunners.cat",
      }),
    ).toThrow("Production artifacts");
  });
});
