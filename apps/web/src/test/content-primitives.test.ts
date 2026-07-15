import { describe, expect, it } from "vitest";
import {
  createSlugSchema,
  findDuplicateLocalizedSlugs,
  hasCompleteTranslation,
  localeSchema,
  nonEmptyStringSchema,
  slugSchema,
  translatableSchema,
} from "../lib/content/primitives";
import {
  httpsUrlSchema,
  mailtoUrlSchema,
  normalizeHttpsUrl,
  telUrlSchema,
} from "../lib/content/urls";

describe("locale and translation primitives", () => {
  const translatedTextSchema = translatableSchema(nonEmptyStringSchema);

  it("requires Catalan and rejects unknown locale keys", () => {
    expect(translatedTextSchema.parse({ ca: "Text" })).toEqual({ ca: "Text" });
    expect(() => translatedTextSchema.parse({ es: "Texto" })).toThrow();
    expect(() =>
      translatedTextSchema.parse({ ca: "Text", fr: "Texte" }),
    ).toThrow();
    expect(() => translatedTextSchema.parse({ ca: "  " })).toThrow();
    expect(localeSchema.safeParse("fr").success).toBe(false);
  });

  it("checks the requested translation without falling back", () => {
    const value = { ca: "Text", es: "" };

    expect(hasCompleteTranslation(value, "ca", Boolean)).toBe(true);
    expect(hasCompleteTranslation(value, "es", Boolean)).toBe(false);
    expect(hasCompleteTranslation(value, "en", Boolean)).toBe(false);
  });

  it("rejects optional translations that are present but empty", () => {
    expect(
      translatedTextSchema.safeParse({ ca: "Text", es: "  " }).success,
    ).toBe(false);
  });

  it("supports nested completeness predicates", () => {
    const value = { ca: { blocks: ["Introduccio"] }, en: { blocks: [] } };
    const hasBlocks = (translation: { blocks: string[] }) =>
      translation.blocks.length > 0;

    expect(hasCompleteTranslation(value, "ca", hasBlocks)).toBe(true);
    expect(hasCompleteTranslation(value, "en", hasBlocks)).toBe(false);
  });
});

describe("slug primitives", () => {
  it.each(["trail", "escola-trail", "event-2026"])(
    "accepts the safe slug %s",
    (slug) => expect(slugSchema.parse(slug)).toBe(slug),
  );

  it.each([
    "Trail",
    "escola_trail",
    "../trail",
    "trail/berga",
    "trail%2fberga",
    "trail.",
    "trail--berga",
    "cursa-cadí",
    "api",
    "ca",
  ])("rejects the unsafe or reserved slug %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });

  it("adds route-specific reserved segments without disabling global ones", () => {
    const schema = createSlugSchema(new Set(["custom"]));

    expect(schema.safeParse("custom").success).toBe(false);
    expect(schema.safeParse("api").success).toBe(false);
    expect(schema.parse("trail")).toBe("trail");
  });

  it("reports duplicate slugs independently by locale", () => {
    expect(
      findDuplicateLocalizedSlugs([
        { ca: "trail", es: "sendero" },
        { ca: "btt", es: "sendero" },
        { ca: "trail", en: "trail" },
      ]),
    ).toEqual({ ca: ["trail"], es: ["sendero"] });
  });
});

describe("URL primitives", () => {
  it("accepts and normalizes credential-free HTTPS URLs", () => {
    expect(normalizeHttpsUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(httpsUrlSchema.parse("https://EXAMPLE.com/a/../path")).toBe(
      "https://example.com/path",
    );
  });

  it.each([
    "http://example.com",
    "//example.com/path",
    "https://user:password@example.com",
    "javascript:alert(1)",
    "javascript&#x3a;alert(1)",
    "javascript%3Aalert(1)",
    "https://example.com/%0aheader",
    "https://example.com/%2525250aheader",
    " https://example.com",
  ])("rejects unsafe web URL %s", (url) => {
    expect(httpsUrlSchema.safeParse(url).success).toBe(false);
  });

  it("only enables contact protocols through explicit schemas", () => {
    expect(mailtoUrlSchema.safeParse("mailto:club@example.com").success).toBe(
      true,
    );
    expect(telUrlSchema.safeParse("tel:+34 600 000 000").success).toBe(true);
    expect(httpsUrlSchema.safeParse("mailto:club@example.com").success).toBe(
      false,
    );
    expect(
      mailtoUrlSchema.safeParse("mailto:club@example.com?body=x").success,
    ).toBe(false);
    expect(
      mailtoUrlSchema.safeParse("mailto:club%0d%0a@example.com").success,
    ).toBe(false);
    expect(
      mailtoUrlSchema.safeParse("mailto:club%250d@example.com").success,
    ).toBe(false);
  });

  it.each([
    "tel:club",
    "tel:+34 600 000 000?extension=1",
    "tel:+34%0a600000000",
    "https://example.com",
    " tel:+34600000000",
  ])("rejects invalid telephone URL %s", (url) => {
    expect(telUrlSchema.safeParse(url).success).toBe(false);
  });
});
