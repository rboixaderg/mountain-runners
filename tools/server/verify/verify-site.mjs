#!/usr/bin/env node
// Site verification for the validation host and, at the cut, for production
// (phase 5, tasks 5.3 and 5.5).
//
// Checks the live host contract approved in T5.1: HTTP→HTTPS, TLS, trailing
// slash, global 404, security headers (nosniff, Referrer-Policy,
// Permissions-Policy, CSP), the approved cache policies and, for the
// validation host, X-Robots-Tag: noindex, nofollow, noarchive and the
// absence of HSTS.
//
// Usage:
//   node tools/server/verify/verify-site.mjs --base-url https://host --expect-noindex
//   node tools/server/verify/verify-site.mjs --base-url https://mountainrunners.cat --expect-indexable

import { contentSecurityPolicy } from "../caddy/content-security-policy.mjs";
import {
  hstsPresentFinding,
  indexableFinding,
  wwwRedirectFinding,
} from "./site-contract.mjs";

const expectNoIndex = process.argv.includes("--expect-noindex");
const expectIndexable = process.argv.includes("--expect-indexable");
const expectHsts = process.argv.includes("--expect-hsts");

if (expectNoIndex && expectIndexable) {
  throw new Error(
    "Pass either --expect-noindex (validation host) or --expect-indexable (apex), not both.",
  );
}

function requireFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || process.argv[index + 1] === undefined) {
    throw new Error(`${name} is required.`);
  }
  return process.argv[index + 1];
}

const baseUrl = requireFlag("--base-url");
const routes = ["/", "/ca/", "/es/", "/en/"];
const noCachePolicy = /no-cache, must-revalidate/u;

const headersPatterns = {
  "X-Content-Type-Options": /nosniff/u,
  "Referrer-Policy": /strict-origin-when-cross-origin/u,
  "Permissions-Policy": /camera=\(\), microphone=\(\)/u,
  "Content-Security-Policy": contentSecurityPolicy,
};

const findings = [];

async function check() {
  const parsedBase = new URL(baseUrl);
  if (parsedBase.protocol !== "https:") {
    findings.push(`--base-url must be https; got ${parsedBase.protocol}.`);
    report();
    return;
  }

  await checkHttpRedirect(parsedBase);

  const rootResponse = await fetchText(`${baseUrl}/ca/`);
  const assetUrls = [
    ...rootResponse.text.matchAll(/"(\/_astro\/[^"]+)"/gu),
  ].map((match) => match[1]);

  for (const route of routes) {
    const response = await fetchText(`${baseUrl}${route}`);
    if (response.status !== 200) {
      findings.push(`${route} returned ${response.status}, expected 200.`);
    }
    assertHeaders(`${route} (HTML)`, response.headers);
    assertNoCache(`${route} (HTML)`, response.headers);
    if (expectNoIndex) {
      assertNoIndex(route, response.headers);
      assertHstsAbsent(route, response.headers);
    }
    if (expectIndexable) {
      pushFinding(indexableFinding(route, response.headers));
    }
    if (expectHsts) {
      pushFinding(hstsPresentFinding(route, response.headers));
    }
  }

  if (expectIndexable) {
    await checkWwwRedirect(parsedBase);
  }

  await checkTrailingSlash(`${baseUrl}/ca`);

  const missing = await fetchText(`${baseUrl}/ruta-inexistent-per-al-test-404`);
  if (missing.status !== 404) {
    findings.push(`Missing route returned ${missing.status}, expected 404.`);
  }
  assertNoCache("404", missing.headers);
  if (expectNoIndex) {
    assertNoIndex("404", missing.headers);
  }
  if (expectIndexable) {
    pushFinding(indexableFinding("404", missing.headers));
  }

  const robots = await fetchText(`${baseUrl}/robots.txt`);
  if (robots.status !== 200) {
    findings.push(`robots.txt returned ${robots.status}, expected 200.`);
  }
  assertNoCache("robots.txt", robots.headers);
  const sitemap = await fetchText(`${baseUrl}/sitemap.xml`);
  if (sitemap.status !== 200) {
    findings.push(`sitemap.xml returned ${sitemap.status}, expected 200.`);
  }
  assertNoCache("sitemap.xml", sitemap.headers);

  for (const assetUrl of assetUrls.slice(0, 3)) {
    const response = await fetchText(`${baseUrl}${assetUrl}`);
    if (response.status !== 200) {
      findings.push(`${assetUrl} returned ${response.status}, expected 200.`);
      continue;
    }
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (
      !/max-age=31536000/u.test(cacheControl) ||
      !/immutable/u.test(cacheControl)
    ) {
      findings.push(
        `${assetUrl} cache policy is not immutable: ${cacheControl}.`,
      );
    }
  }

  report();
}

async function checkHttpRedirect(parsedBase) {
  const httpUrl = `http://${parsedBase.host}/ca/`;
  const response = await fetchRaw(httpUrl);
  const location = response.headers.get("location") ?? "";
  if (response.status !== 308 && response.status !== 301) {
    findings.push(
      `HTTP ${httpUrl} returned ${response.status}, expected 308 or 301 to HTTPS.`,
    );
    return;
  }
  if (!location.startsWith("https://")) {
    findings.push(
      `HTTP redirect location is not HTTPS: ${location || "absent"}.`,
    );
  }
}

async function checkTrailingSlash(urlWithoutSlash) {
  const response = await fetchRaw(urlWithoutSlash);
  const location = response.headers.get("location") ?? "";
  if (response.status !== 308 && response.status !== 301) {
    findings.push(
      `${urlWithoutSlash} returned ${response.status}, expected a trailing-slash redirect.`,
    );
    return;
  }
  if (!location.endsWith("/")) {
    findings.push(
      `Trailing-slash redirect location is unexpected: ${location || "absent"}.`,
    );
  }
}

function assertHeaders(label, headers) {
  for (const [name, pattern] of Object.entries(headersPatterns)) {
    const value = headers.get(name.toLowerCase()) ?? "";
    const matches =
      typeof pattern === "string" ? value === pattern : pattern.test(value);
    if (!matches) {
      findings.push(`${label} is missing ${name}: ${value || "absent"}.`);
    }
  }
}

function assertNoCache(label, headers) {
  const cacheControl = headers.get("cache-control") ?? "";
  if (!noCachePolicy.test(cacheControl)) {
    findings.push(`${label} cache policy is not no-cache: ${cacheControl}.`);
  }
}

function assertNoIndex(label, headers) {
  if (
    !/noindex, nofollow, noarchive/u.test(headers.get("x-robots-tag") ?? "")
  ) {
    findings.push(
      `${label} is missing X-Robots-Tag noindex, nofollow, noarchive.`,
    );
  }
}

function assertHstsAbsent(label, headers) {
  const hsts = headers.get("strict-transport-security");
  if (hsts !== null && hsts !== "") {
    findings.push(
      `${label} must not send HSTS before the production cut: ${hsts}.`,
    );
  }
}

function pushFinding(finding) {
  if (finding !== undefined) {
    findings.push(finding);
  }
}

async function checkWwwRedirect(parsedBase) {
  if (parsedBase.hostname.startsWith("www.")) {
    return;
  }
  const wwwUrl = `https://www.${parsedBase.hostname}/ca/`;
  const response = await fetchRaw(wwwUrl);
  pushFinding(
    wwwRedirectFinding({
      status: response.status,
      location: response.headers.get("location") ?? "",
      apexOrigin: parsedBase.origin,
      wwwUrl,
    }),
  );
}

async function fetchText(url) {
  const response = await fetchRaw(url, "follow");
  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  };
}

async function fetchRaw(url, redirect = "manual") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function report() {
  if (findings.length === 0) {
    console.log(`Verification OK: ${baseUrl}`);
    return;
  }
  console.error(`Verification FAILED for ${baseUrl}:`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
}

check().catch((error) => {
  console.error(`Verification error: ${error.message}`);
  process.exitCode = 1;
});
