import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contentSecurityPolicy } from "../caddy/content-security-policy.mjs";

const origin = "https://mountain.example";
const verifySitePath = fileURLToPath(
  new URL("./verify-site.mjs", import.meta.url),
);
const redirectTargets = {
  "/": "/ca/",
  "/ca": "/ca/",
  "/index.php/actualitat": "/ca/",
  "/el-club/": "/ca/qui-som/",
  "/escola-btt/": "/ca/escoles/escola-btt/",
  "/esdeveniments/mes/2022-02/": "/ca/esdeveniments/",
  "/blog": "/ca/blog/",
  "/wp-login.php": "/ca/",
  "/wp-json/oembed/1.0/embed": "/ca/",
  "/2025/05/17/ice-cream-and-gelato-ingredients": "/ca/",
  "/quienes-somos/": "/es/quienes-somos/",
  "/escuelas/escuela-trail/": "/es/escuelas/escuela-trail/",
  "/schools/mtb-school/": "/en/schools/mtb-school/",
  "/noticies/": "/ca/noticies/",
  "/escoles/escola-btt/": "/ca/escoles/escola-btt/",
  "/escoles/escola-btt": "/ca/escoles/escola-btt/",
  "/esdeveniments/berga-trail/": "/ca/esdeveniments/berga-trail/",
  "/esdeveniments/berga-trail": "/ca/esdeveniments/berga-trail/",
  "/blog/com-fer-te-soci/": "/ca/blog/com-fer-te-soci/",
  "/blog/com-fer-te-soci": "/ca/blog/com-fer-te-soci/",
  "/qui-som": "/ca/qui-som/",
  "/quienes-somos": "/es/quienes-somos/",
  "/about": "/en/about/",
  "/schools/mtb-school": "/en/schools/mtb-school/",
};

// Replace only the HTTP boundary inside the child process. The real CLI,
// flag parsing, request loop and contract checks execute without live traffic.
function installSiteFixture({ redirectTargets, mode, missingLegacy, policy }) {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (!["mountain.example", "www.mountain.example"].includes(url.hostname)) {
      throw new Error(`Unexpected host: ${url.hostname}`);
    }
    const headers = {
      "cache-control": "no-cache, must-revalidate",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=()",
      "content-security-policy": policy,
    };
    if (mode === "--expect-noindex") {
      headers["x-robots-tag"] = "noindex, nofollow, noarchive";
    }
    if (url.protocol === "http:" || url.hostname.startsWith("www.")) {
      return new Response(null, {
        status: 308,
        headers: { location: "https://mountain.example/ca/" },
      });
    }
    if (missingLegacy && url.pathname === "/el-club/") {
      return new Response("Not found", { status: 404, headers });
    }
    if (redirectTargets[url.pathname]) {
      return new Response(null, {
        status: 301,
        headers: { location: redirectTargets[url.pathname] },
      });
    }
    if (url.pathname === "/ruta-inexistent-per-al-test-404") {
      return new Response("Not found", { status: 404, headers });
    }
    if (
      ["/ca/", "/es/", "/en/", "/robots.txt", "/sitemap.xml"].includes(
        url.pathname,
      )
    ) {
      return new Response("Site fixture", { headers });
    }
    throw new Error(`Unexpected path: ${url.pathname}`);
  };
}

function runVerification(mode, missingLegacy) {
  const fixture = JSON.stringify({
    redirectTargets,
    mode,
    missingLegacy,
    policy: contentSecurityPolicy,
  });
  const preload = `(${installSiteFixture.toString()})(${fixture});`;
  return spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`,
      verifySitePath,
      "--base-url",
      origin,
      mode,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
}

for (const mode of ["--expect-indexable", "--expect-noindex"]) {
  test(`verify-site accepts the full site contract with ${mode}`, () => {
    const result = runVerification(mode, false);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verification OK/u);
  });

  test(`verify-site rejects a missing legacy redirect without an opt-in flag with ${mode}`, () => {
    const result = runVerification(mode, true);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Legacy .*\/el-club\/ returned 404/u);
    assert.doesNotMatch(result.stdout, /Verification OK/u);
  });
}
