import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const { PUBLIC_SITE_ORIGIN } = loadEnv(
  process.env.NODE_ENV ?? "development",
  fileURLToPath(new URL("../", import.meta.url)),
  "PUBLIC_SITE_ORIGIN",
);
const publicSiteOrigin = new URL(PUBLIC_SITE_ORIGIN);

const configuredLocales = ["ca", "es", "en"];
const publishedHomepages = configuredLocales.map((locale) => [
  locale,
  "Mountain Runners del Berguedà",
]);

const unavailableDetailRoutes = [
  "ca/esdeveniments/jornada-muntanya/index.html",
  "es/escuelas/escola-trail/index.html",
  "en/schools/escola-trail/index.html",
  "es/eventos/jornada-muntanya/index.html",
  "en/events/jornada-muntanya/index.html",
];

const forbiddenOutputMarkers = [
  "DRAFT_ONLY_CONTENT_MARKER",
  "DRAFT_ONLY_ASSET_MARKER",
  "private-draft.pdf",
  "internal-draft",
  // The club guide is a synthetic fixture: its document stays published but
  // temporarily unavailable, so its PDF must never reach the public output.
  "club-guide.pdf",
];

const expectedPublishedResource =
  "content-resources/assets/logo_mountain_runners.png";
const expectedStatutesResource =
  "content-resources/content-assets/documents/estatuts-mrb.pdf";

const distDirectory = new URL("../dist/", import.meta.url);
const root = await readFile(new URL("index.html", distDirectory), "utf8");

if (!root.includes('http-equiv="refresh"') || !root.includes('href="/ca/"')) {
  throw new Error("The root output must redirect to /ca/.");
}

for (const [locale, message] of publishedHomepages) {
  const page = await readFile(
    new URL(`../dist/${locale}/index.html`, import.meta.url),
    "utf8",
  );

  if (!page.includes(`<html lang="${locale}">`) || !page.includes(message)) {
    throw new Error(
      `The /${locale}/ output does not use its configured locale.`,
    );
  }
}

const catalanHome = await readFile(
  new URL("../dist/ca/index.html", import.meta.url),
  "utf8",
);
const catalanHomeCanonical = new URL("/ca/", publicSiteOrigin).toString();
if (
  !catalanHome.includes(`<link rel="canonical" href="${catalanHomeCanonical}"`)
) {
  throw new Error("The Catalan home output has an invalid canonical URL.");
}

async function listHtmlFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listHtmlFiles(path)));
    } else if (entry.name.endsWith(".html")) {
      files.push(path);
    }
  }

  return files;
}

const distPath = fileURLToPath(distDirectory);
const htmlFiles = await listHtmlFiles(distPath);
const outputRoutes = htmlFiles.map((path) => relative(distPath, path));
const unexpectedRoutes = outputRoutes.filter(
  (path) =>
    path !== "index.html" &&
    path !== "404.html" &&
    !configuredLocales.some((locale) => path.startsWith(`${locale}/`)),
);

if (unexpectedRoutes.length > 0) {
  throw new Error(
    `Public HTML routes must use a locale prefix: ${unexpectedRoutes.join(", ")}`,
  );
}

const notFound = await readFile(join(distPath, "404.html"), "utf8");
const notFoundCanonical = new URL("/404.html", publicSiteOrigin).toString();
if (
  !notFound.includes('<html lang="ca">') ||
  !notFound.includes('name="robots" content="noindex, nofollow"') ||
  !notFound.includes(`<link rel="canonical" href="${notFoundCanonical}"`) ||
  !notFound.includes(`property="og:url" content="${notFoundCanonical}"`)
) {
  throw new Error(
    "The technical 404 output must be Catalan, noindex, and canonical.",
  );
}
if (
  outputRoutes.some((path) => /^(ca|es|en)\/404(?:\/index)?\.html$/u.test(path))
) {
  throw new Error("Localized 404 variants reached the build output.");
}

for (const route of unavailableDetailRoutes) {
  if (outputRoutes.includes(route)) {
    throw new Error(
      `Unavailable detail route reached the build output: ${route}`,
    );
  }
}

for (const legacyRoute of [
  "ca/schools/escola-trail/index.html",
  "ca/events/jornada-muntanya/index.html",
]) {
  if (outputRoutes.includes(legacyRoute)) {
    throw new Error(
      `Legacy non-localized route reached the build output: ${legacyRoute}`,
    );
  }
}

const sitemap = await readFile(join(distPath, "sitemap.xml"), "utf8");
const sitemapUrls = new Set(
  [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(([, url]) => url),
);
const expectedSitemapUrls = new Set(
  [
    "ca/",
    "es/",
    "en/",
    "ca/escoles/",
    "ca/escoles/escola-btt/",
    "ca/escoles/escola-skimo/",
    "ca/escoles/escola-trail/",
    "ca/esdeveniments/",
    "ca/esdeveniments/anella-verda/",
    "ca/esdeveniments/berga-trail/",
    "ca/esdeveniments/cros-de-queralt/",
    "ca/esdeveniments/escalada-castell-areny/",
    "ca/esdeveniments/escalada-queralt/",
    "ca/esdeveniments/les-classiques-de-berga/",
    "ca/esdeveniments/llobregat-x-la-diabetis/",
    "ca/esdeveniments/minivolta-a-la-maria/",
    "ca/esdeveniments/quina-berguedana/",
    "ca/esdeveniments/ultra-pirineu/",
    "ca/qui-som/",
    "ca/socis/",
    "ca/documents/",
    "ca/avis-legal/",
    "ca/privacitat/",
    "ca/cookies/",
    "es/escuelas/",
    "es/escuelas/escuela-btt/",
    "es/escuelas/escuela-esqui-montana/",
    "es/escuelas/escuela-trail/",
    "es/eventos/",
    "es/eventos/anella-verde/",
    "es/eventos/berga-trail/",
    "es/eventos/cros-de-queralt/",
    "es/eventos/escalada-castell-areny/",
    "es/eventos/escalada-queralt/",
    "es/eventos/les-classiques-de-berga/",
    "es/eventos/llobregat-x-la-diabetis/",
    "es/eventos/minivolta-a-la-maria/",
    "es/eventos/quina-berguedana/",
    "es/eventos/ultra-pirineu/",
    "es/quienes-somos/",
    "es/socios/",
    "es/documentos/",
    "es/aviso-legal/",
    "es/privacidad/",
    "es/cookies/",
    "en/schools/",
    "en/schools/mtb-school/",
    "en/schools/ski-mountaineering-school/",
    "en/schools/trail-school/",
    "en/events/",
    "en/events/green-ring/",
    "en/events/berga-trail/",
    "en/events/cros-de-queralt/",
    "en/events/escalada-castell-areny/",
    "en/events/escalada-queralt/",
    "en/events/les-classiques-de-berga/",
    "en/events/llobregat-x-la-diabetis/",
    "en/events/minivolta-a-la-maria/",
    "en/events/quina-berguedana/",
    "en/events/ultra-pirineu/",
    "en/about/",
    "en/members/",
    "en/documents/",
    "en/legal-notice/",
    "en/privacy/",
    "en/cookies/",
  ].map((path) => new URL(path, publicSiteOrigin).toString()),
);
if (
  sitemapUrls.size !== expectedSitemapUrls.size ||
  [...expectedSitemapUrls].some((url) => !sitemapUrls.has(url))
) {
  throw new Error("Sitemap does not exactly match published canonical routes.");
}
const robots = await readFile(join(distPath, "robots.txt"), "utf8");
const sitemapDirective = `Sitemap: ${new URL("/sitemap.xml", publicSiteOrigin)}`;
if (!robots.split("\n").includes(sitemapDirective)) {
  throw new Error("Robots output does not declare the canonical sitemap URL.");
}
await readFile(join(distPath, expectedPublishedResource));
await readFile(join(distPath, expectedStatutesResource));
await readFile(
  join(
    distPath,
    "content-resources/assets/collaborators/visites-al-bergueda.jpg",
  ),
);

async function listFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

for (const file of await listFiles(distPath)) {
  const content = await readFile(file);
  const searchable = `${relative(distPath, file)}\n${content.toString("utf8")}`;
  for (const marker of forbiddenOutputMarkers) {
    if (searchable.includes(marker)) {
      throw new Error(
        `Unpublished content reached the build output: ${marker}`,
      );
    }
  }
}
