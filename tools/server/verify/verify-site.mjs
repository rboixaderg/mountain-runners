#!/usr/bin/env node
// Site verification for the validation host and, at the cut, for production
// (phase 5, task 5.3).
//
// Checks the live host contract approved in T5.1: TLS, 200 on the public
// routes with trailing slash, global 404, security headers (nosniff,
// Referrer-Policy, Permissions-Policy, CSP), the approved cache policies and,
// for the validation host, X-Robots-Tag: noindex, nofollow, noarchive.
//
// Usage:
//   node tools/server/verify/verify-site.mjs --base-url https://host --expect-noindex

const expectNoIndex = process.argv.includes("--expect-noindex");

function requireFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || process.argv[index + 1] === undefined) {
    throw new Error(`${name} is required.`);
  }
  return process.argv[index + 1];
}

const baseUrl = requireFlag("--base-url");
const routes = ["/", "/ca/", "/es/", "/en/"];

const headersPatterns = {
  "X-Content-Type-Options": /nosniff/u,
  "Referrer-Policy": /strict-origin-when-cross-origin/u,
  "Permissions-Policy": /camera=\(\), microphone=\(\)/u,
  "Content-Security-Policy": /default-src 'self'/u,
};

const findings = [];

async function check() {
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
  }

  const missing = await fetchText(`${baseUrl}/ruta-inexistent-per-al-test-404`);
  if (missing.status !== 404) {
    findings.push(`Missing route returned ${missing.status}, expected 404.`);
  }

  const robots = await fetchText(`${baseUrl}/robots.txt`);
  if (robots.status !== 200) {
    findings.push(`robots.txt returned ${robots.status}, expected 200.`);
  }
  const sitemap = await fetchText(`${baseUrl}/sitemap.xml`);
  if (sitemap.status !== 200) {
    findings.push(`sitemap.xml returned ${sitemap.status}, expected 200.`);
  }

  if (expectNoIndex) {
    const noIndexHeaders = rootResponse.headers;
    if (
      !/noindex, nofollow, noarchive/u.test(
        noIndexHeaders.get("x-robots-tag") ?? "",
      )
    ) {
      findings.push("X-Robots-Tag noindex, nofollow, noarchive is missing.");
    }
  }

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

function assertHeaders(label, headers) {
  for (const [name, pattern] of Object.entries(headersPatterns)) {
    const value = headers.get(name.toLowerCase()) ?? "";
    if (!pattern.test(value)) {
      findings.push(`${label} is missing ${name}: ${value || "absent"}.`);
    }
  }
  const cacheControl = headers.get("cache-control") ?? "";
  if (!/no-cache, must-revalidate/u.test(cacheControl)) {
    findings.push(`${label} cache policy is not no-cache: ${cacheControl}.`);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    return {
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    };
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
