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

const publishedHomepages = [["ca", "Mountain Runners del Berguedà"]];
const configuredLocales = ["ca", "es", "en"];

const unavailableDetailRoutes = [
  "ca/escoles/escola-btt/index.html",
  "ca/escoles/escola-skimo/index.html",
  "ca/escoles/escola-trail/index.html",
  "ca/esdeveniments/berga-trail/index.html",
  "ca/esdeveniments/escalada-queralt/index.html",
  "ca/esdeveniments/ultra-pirineu/index.html",
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
];

const expectedPublishedResource =
  "content-resources/assets/logo_mountain_runners.jpeg";

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

for (const locale of configuredLocales.filter((locale) => locale !== "ca")) {
  try {
    await readFile(new URL(`../dist/${locale}/index.html`, import.meta.url));
  } catch {
    continue;
  }
  throw new Error(
    `Incomplete homepage variant reached the build output: /${locale}/`,
  );
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
  ["ca/"].map((path) => new URL(path, publicSiteOrigin).toString()),
);
if (
  sitemapUrls.size !== expectedSitemapUrls.size ||
  [...expectedSitemapUrls].some((url) => !sitemapUrls.has(url))
) {
  throw new Error("Sitemap does not exactly match published canonical routes.");
}
if ([...sitemapUrls].some((url) => new URL(url).pathname.startsWith("/es/"))) {
  throw new Error("Sitemap includes an incomplete localized variant.");
}

const robots = await readFile(join(distPath, "robots.txt"), "utf8");
const sitemapDirective = `Sitemap: ${new URL("/sitemap.xml", publicSiteOrigin)}`;
if (!robots.split("\n").includes(sitemapDirective)) {
  throw new Error("Robots output does not declare the canonical sitemap URL.");
}
await readFile(join(distPath, expectedPublishedResource));

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
