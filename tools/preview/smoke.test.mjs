import assert from "node:assert/strict";
import test from "node:test";
import { verifyPreviewSite } from "./smoke.mjs";

const origin = "https://pr-99.preview.mountainrunners.cat";
function request(url) {
  const parsed = new URL(url);
  if (parsed.pathname === "/robots.txt") {
    return { status: 200, text: async () => "User-agent: *\nDisallow: /\n" };
  }
  if (parsed.pathname === "/not-a-preview-page") {
    return {
      status: 404,
      headers: new Headers({ "x-robots-tag": "noindex, nofollow, noarchive" }),
    };
  }
  return {
    status: 200,
    headers: new Headers({
      "x-robots-tag": "noindex, nofollow, noarchive",
      "cache-control": "no-store",
    }),
    text: async () => `<link rel="canonical" href="${url}">PREVIEW`,
  };
}

test("checks all locales, canonical, robots and noindex through HTTPS", async () => {
  await verifyPreviewSite(origin, { request });
});

test("rejects missing robots or indexable HTML", async () => {
  await assert.rejects(
    verifyPreviewSite(origin, {
      request: (url) =>
        url.endsWith("/robots.txt")
          ? { status: 200, text: async () => "Allow: /" }
          : request(url),
    }),
    /disallow crawling/,
  );
  await assert.rejects(
    verifyPreviewSite(origin, {
      request: (url) =>
        url.endsWith("/es/")
          ? { ...request(url), headers: new Headers() }
          : request(url),
    }),
    /header checks/,
  );
});
