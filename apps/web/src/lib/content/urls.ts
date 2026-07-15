import { z } from "zod";

function hasControlOrWhitespace(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f;
  });
}

function decodeObfuscatedUrl(value: string): string | undefined {
  try {
    let decoded = value;

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const withEntities = decoded.replace(
        /&#(?:x([\da-f]+)|(\d+));?/giu,
        (_, hexadecimal: string | undefined, decimal: string | undefined) =>
          String.fromCodePoint(
            Number.parseInt(
              hexadecimal ?? decimal ?? "0",
              hexadecimal ? 16 : 10,
            ),
          ),
      );

      const withPercentEncoding = decodeURIComponent(withEntities);
      if (withPercentEncoding === decoded) return decoded;
      decoded = withPercentEncoding;
    }

    return decoded;
  } catch {
    return undefined;
  }
}

export function normalizeHttpsUrl(value: string): string | undefined {
  const decoded = decodeObfuscatedUrl(value);
  if (
    decoded === undefined ||
    value.length === 0 ||
    value !== value.trim() ||
    hasControlOrWhitespace(value) ||
    hasControlOrWhitespace(decoded)
  ) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hostname.length === 0
    ) {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}

export const httpsUrlSchema = z.string().transform((value, context) => {
  const normalizedUrl = normalizeHttpsUrl(value);
  if (normalizedUrl === undefined) {
    context.addIssue({
      code: "custom",
      message:
        "Expected an absolute HTTPS URL without credentials or whitespace",
    });
    return z.NEVER;
  }

  return normalizedUrl;
});

export const mailtoUrlSchema = z.string().refine(
  (value) => {
    const decoded = decodeObfuscatedUrl(value);
    if (
      decoded === undefined ||
      decoded !== value ||
      value !== value.trim() ||
      hasControlOrWhitespace(value) ||
      /[%?#]/u.test(value)
    ) {
      return false;
    }

    return /^mailto:[a-z0-9.!#$&'*+/=^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/iu.test(
      value,
    );
  },
  { error: "Expected a simple mailto URL" },
);

export const telUrlSchema = z
  .string()
  .refine(
    (value) =>
      value === value.trim() &&
      /^tel:\+?[0-9](?:[0-9(). -]*[0-9])?$/u.test(value) &&
      !hasControlOrWhitespace(value.replaceAll(" ", "")),
    { error: "Expected a telephone URL" },
  );
