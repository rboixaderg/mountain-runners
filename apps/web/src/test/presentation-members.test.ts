import { describe, expect, it } from "vitest";
import { formatSessionPrice } from "../lib/presentation/members";

describe("formatSessionPrice", () => {
  it.each([
    ["ca", "10\u00a0€"],
    ["es", "10\u00a0€"],
    ["en", "€10"],
  ] as const)(
    "formats a whole-euro fee for %s without decimal padding",
    (locale, expected) => {
      expect(formatSessionPrice(10, locale)).toBe(expected);
    },
  );
});
