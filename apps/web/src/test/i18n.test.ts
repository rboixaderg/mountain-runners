import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultLocale, locales } from "../../i18n.config.mjs";

const appDirectory = fileURLToPath(new URL("../..", import.meta.url));

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

describe("internationalization configuration", () => {
  it("uses the expected prefixed locales and default locale", () => {
    expect(defaultLocale).toBe("ca");
    expect(locales).toEqual(["ca", "es", "en"]);
    expect(locales.map((locale) => `/${locale}/`)).toEqual([
      "/ca/",
      "/es/",
      "/en/",
    ]);
  });

  it("keeps Paraglide aligned with Astro locales", () => {
    const settings = JSON.parse(
      readFileSync(`${appDirectory}/project.inlang/settings.json`, "utf8"),
    ) as { baseLocale: string; locales: string[] };

    expect(settings.baseLocale).toBe(defaultLocale);
    expect(settings.locales).toEqual(locales);
  });

  it("requires the same non-empty messages in every catalog", () => {
    const catalogs = locales.map((locale) =>
      readJson(`../../messages/${locale}.json`),
    );
    const keys = Object.keys(catalogs[0]).sort();

    for (const catalog of catalogs) {
      expect(Object.keys(catalog).sort()).toEqual(keys);
      expect(
        Object.values(catalog).every(
          (value) => typeof value === "string" && value.length > 0,
        ),
      ).toBe(true);
    }
  });
});
