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

    for (let iteration = 0; iteration < 10; iteration += 1) {
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

    return undefined;
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

export const instagramProfileUrlSchema = httpsUrlSchema.refine(
  (value) => {
    const url = new URL(value);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    return (
      ["instagram.com", "www.instagram.com"].includes(url.hostname) &&
      pathSegments.length === 1 &&
      /^[a-z0-9._]+$/iu.test(pathSegments[0]!) &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  },
  { error: "Expected an Instagram profile URL" },
);

export const stravaClubUrlSchema = httpsUrlSchema.refine(
  (value) => {
    const url = new URL(value);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    return (
      ["strava.com", "www.strava.com"].includes(url.hostname) &&
      pathSegments.length === 2 &&
      pathSegments[0] === "clubs" &&
      /^\d+$/u.test(pathSegments[1]!) &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  },
  { error: "Expected a Strava club URL" },
);

export const youtubeVideoUrlSchema = httpsUrlSchema.refine(
  (value) => {
    const url = new URL(value);
    const videoIdPattern = /^[A-Za-z0-9_-]{11}$/u;

    if (["youtube.com", "www.youtube.com"].includes(url.hostname)) {
      return (
        url.pathname === "/watch" &&
        videoIdPattern.test(url.searchParams.get("v") ?? "") &&
        [...url.searchParams.keys()].every((key) => key === "v") &&
        url.hash.length === 0
      );
    }

    if (url.hostname === "youtu.be") {
      return (
        videoIdPattern.test(url.pathname.replace(/^\//u, "")) &&
        url.search.length === 0 &&
        url.hash.length === 0
      );
    }

    return false;
  },
  { error: "Expected a supported YouTube video URL" },
);

export const emailAddressSchema = z.string().refine(
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

    return /^[a-z0-9.!#$&'*+/=^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/iu.test(value);
  },
  { error: "Expected a simple email address" },
);

export const phoneNumberSchema = z
  .string()
  .refine(
    (value) =>
      value === value.trim() &&
      /^\+?[0-9](?:[0-9(). -]*[0-9])?$/u.test(value) &&
      !hasControlOrWhitespace(value.replaceAll(" ", "")),
    { error: "Expected a telephone number" },
  );
