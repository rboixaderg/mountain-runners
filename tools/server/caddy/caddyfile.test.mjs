import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { contentSecurityPolicy } from "./content-security-policy.mjs";

const caddyDirectory = dirname(fileURLToPath(import.meta.url));
const caddyfile = readFileSync(join(caddyDirectory, "Caddyfile"), "utf8");
const redirectsFile = readFileSync(
  join(caddyDirectory, "Caddyfile.redirects"),
  "utf8",
);

test("Caddyfile CSP matches the shared policy string", () => {
  const headerLine = [...caddyfile.split("\n")].find((line) =>
    line.includes("header Content-Security-Policy"),
  );
  assert.equal(
    headerLine,
    `\theader Content-Security-Policy "${contentSecurityPolicy}"`,
  );
  assert.doesNotMatch(contentSecurityPolicy, /unsafe-eval/u);
});

test("Caddyfile redirects only the unprefixed root before serving files", () => {
  const rootMatcher = "\t@unprefixed_root path /";
  const rootRedirect = "\tredir @unprefixed_root /ca/ permanent";
  const rootMatcherIndex = caddyfile.indexOf(rootMatcher);
  const rootRedirectIndex = caddyfile.indexOf(rootRedirect);
  const fileServerIndex = caddyfile.indexOf("\tfile_server");

  assert.notEqual(rootMatcherIndex, -1);
  assert.equal(caddyfile.indexOf(rootMatcher, rootMatcherIndex + 1), -1);
  assert.equal(rootRedirectIndex, rootMatcherIndex + rootMatcher.length + 1);
  assert.ok(rootRedirectIndex < fileServerIndex);
});

const legacyRedirects = [
  [
    "\t@legacy_home path /index.php /index.php/* /contact /contact/ /contacteu /contacteu/ /pagina-exemple /pagina-exemple/",
    "\tredir @legacy_home /ca/ permanent",
  ],
  [
    "\t@legacy_about path /el-club /el-club/",
    "\tredir @legacy_about /ca/qui-som/ permanent",
  ],
  [
    "\t@legacy_members path /socis /socis/ /llicencia-federativa /llicencia-federativa/ /avantatge-per-a-socis-i-socies /avantatge-per-a-socis-i-socies/",
    "\tredir @legacy_members /ca/socis/ permanent",
  ],
  [
    "\t@legacy_schools_hub path /escoles /escoles/",
    "\tredir @legacy_schools_hub /ca/escoles/ permanent",
  ],
  [
    "\t@legacy_school_btt path /escola-btt /escola-btt/",
    "\tredir @legacy_school_btt /ca/escoles/escola-btt/ permanent",
  ],
  [
    "\t@legacy_school_trail path /escola-trail /escola-trail/",
    "\tredir @legacy_school_trail /ca/escoles/escola-trail/ permanent",
  ],
  [
    "\t@legacy_school_skimo path /escola-skimo /escola-skimo/",
    "\tredir @legacy_school_skimo /ca/escoles/escola-skimo/ permanent",
  ],
  [
    "\t@legacy_events_hub path /esdeveniments /esdeveniments/ /esdeveniments/mes/*",
    "\tredir @legacy_events_hub /ca/esdeveniments/ permanent",
  ],
  [
    "\t@legacy_event_berga path /berga-trail /berga-trail/",
    "\tredir @legacy_event_berga /ca/esdeveniments/berga-trail/ permanent",
  ],
  [
    "\t@legacy_event_ultra path /ultra-pirineu /ultra-pirineu/",
    "\tredir @legacy_event_ultra /ca/esdeveniments/ultra-pirineu/ permanent",
  ],
  [
    "\t@legacy_blog path /blog /blog/",
    "\tredir @legacy_blog /ca/blog/ permanent",
  ],
  [
    "\t@legacy_documents path /images/*",
    "\tredir @legacy_documents /ca/documents/ permanent",
  ],
  [
    "\t@legacy_spam path /2024/* /2025/* /category/*",
    "\tredir @legacy_spam /ca/ permanent",
  ],
  [
    "\t@legacy_technical path /wp-json/* /wp-login.php /administrator /administrator/ /webmail /webmail/ /.well-known/* /tel:*",
    "\tredir @legacy_technical /ca/ permanent",
  ],
];

function legacyRedirectsSnippet() {
  const start = redirectsFile.indexOf("(legacy_redirects) {");
  const end = redirectsFile.indexOf("\n}\n", start);
  assert.notEqual(start, -1, "the (legacy_redirects) snippet is missing");
  assert.notEqual(end, -1, "the (legacy_redirects) snippet is not closed");
  return redirectsFile.slice(start, end);
}

test("Caddyfile redirects legacy club URLs before serving files", () => {
  const snippet = legacyRedirectsSnippet();
  const redirectsImportIndex = caddyfile.indexOf("import Caddyfile.redirects");
  const importIndex = caddyfile.indexOf("\timport legacy_redirects");
  const fileServerIndex = caddyfile.indexOf("\tfile_server");

  assert.notEqual(redirectsImportIndex, -1);
  assert.notEqual(importIndex, -1);
  assert.ok(importIndex < fileServerIndex);

  for (const [matcher, redirect] of legacyRedirects) {
    assert.ok(
      snippet.includes(`${matcher}\n${redirect}`),
      `missing legacy redirect: ${redirect.trim()}`,
    );
  }

  assert.equal(
    snippet.match(/^\tredir /gmu)?.length,
    legacyRedirects.length,
    "every legacy matcher must own exactly one redirect",
  );
});

test("Caddyfile redirects spam and technical probes to the homepage", () => {
  const snippet = legacyRedirectsSnippet();

  assert.ok(
    snippet.includes("\t@legacy_spam path /2024/* /2025/* /category/*"),
  );
  assert.ok(
    snippet.includes(
      "\t@legacy_technical path /wp-json/* /wp-login.php /administrator /administrator/ /webmail /webmail/ /.well-known/* /tel:*",
    ),
  );
  assert.doesNotMatch(
    snippet,
    /^\tredir \*/mu,
    "no catch-all redirect is allowed",
  );
  assert.doesNotMatch(
    snippet,
    /^\t@[a-z_]+ path \/\*/mu,
    "the legacy map must stay a closed set of prefixes",
  );
});

const localeRedirects = [
  {
    locale: "ca",
    segments: [
      "qui-som",
      "escoles",
      "esdeveniments",
      "blog",
      "noticies",
      "documents",
      "avis-legal",
      "privacitat",
      "cookies",
    ],
  },
  {
    locale: "es",
    segments: [
      "quienes-somos",
      "escuelas",
      "eventos",
      "noticias",
      "socios",
      "documentos",
      "aviso-legal",
      "privacidad",
    ],
  },
  {
    locale: "en",
    segments: [
      "about",
      "schools",
      "events",
      "news",
      "members",
      "legal-notice",
      "privacy",
    ],
  },
];

function localeRedirectsSnippet() {
  const start = redirectsFile.indexOf("(locale_redirects) {");
  const end = redirectsFile.indexOf("\n}\n", start);
  assert.notEqual(start, -1, "the (locale_redirects) snippet is missing");
  assert.notEqual(end, -1, "the (locale_redirects) snippet is not closed");
  return redirectsFile.slice(start, end);
}

test("Caddyfile adds the locale prefix and canonical slash to hubs and details", () => {
  const snippet = localeRedirectsSnippet();
  const importIndex = caddyfile.indexOf("\timport locale_redirects");
  const fileServerIndex = caddyfile.indexOf("\tfile_server");

  assert.notEqual(importIndex, -1);
  assert.ok(importIndex < fileServerIndex);

  for (const { locale, segments } of localeRedirects) {
    const matcherPrefix = `\t@locale_${locale} path_regexp locale_${locale} `;
    const matcherLine = snippet
      .split("\n")
      .find((line) => line.startsWith(matcherPrefix));
    assert.ok(matcherLine, `missing locale matcher: ${locale}`);
    // These expressions use the same anchors, groups and quantifiers in
    // JavaScript and Caddy's RE2 engine. Live HTTP checks remain in verify-site.
    const expression = new RegExp(matcherLine.slice(matcherPrefix.length));
    assert.ok(
      snippet.includes(
        `\tredir @locale_${locale} /${locale}{re.locale_${locale}.1}/ permanent`,
      ),
    );

    for (const segment of segments) {
      for (const suffix of ["", "/detail", "/2026/detail"]) {
        const pathWithoutSlash = `/${segment}${suffix}`;
        for (const path of [pathWithoutSlash, `${pathWithoutSlash}/`]) {
          const match = expression.exec(path);
          assert.ok(match, `missing ${locale} redirect for ${path}`);
          assert.equal(
            `/${locale}${match[1]}/`,
            `/${locale}${pathWithoutSlash}/`,
            `the first redirect must include exactly one final slash: ${path}`,
          );
        }
      }
      assert.equal(expression.test(`/${segment}-extra/`), false);
    }

    for (const path of [
      "/",
      "/unknown-route/",
      "/ca/escoles/",
      "/es/",
      "/en/",
    ]) {
      assert.equal(
        expression.test(path),
        false,
        `unexpected redirect: ${path}`,
      );
    }
  }

  assert.equal(
    snippet.match(/^\tredir /gmu)?.length,
    localeRedirects.length,
    "every locale matcher must own exactly one redirect",
  );
});
