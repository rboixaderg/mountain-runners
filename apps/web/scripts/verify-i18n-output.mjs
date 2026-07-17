import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pages = [
  ["ca", "Base web en construcció"],
  ["es", "Base web en construcción"],
  ["en", "Website foundation under construction"],
];

const expectedEditorialRoutes = [
  "ca/escoles/escola-trail/index.html",
  "ca/esdeveniments/jornada-muntanya/index.html",
];

const unpublishedEditorialRoutes = [
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
  "content-resources/content-assets/documents/club-guide.pdf";

const distDirectory = new URL("../dist/", import.meta.url);
const root = await readFile(new URL("index.html", distDirectory), "utf8");

if (!root.includes('http-equiv="refresh"') || !root.includes('href="/ca/"')) {
  throw new Error("The root output must redirect to /ca/.");
}

for (const [locale, message] of pages) {
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
    !pages.some(([locale]) => path.startsWith(`${locale}/`)),
);

if (unexpectedRoutes.length > 0) {
  throw new Error(
    `Public HTML routes must use a locale prefix: ${unexpectedRoutes.join(", ")}`,
  );
}

for (const route of expectedEditorialRoutes) {
  const output = await readFile(join(distPath, route), "utf8");
  const canonical = `https://mountainrunners.cat/${route.replace("index.html", "")}`;
  if (!output.includes(`<link rel="canonical" href="${canonical}"`)) {
    throw new Error(`Editorial route has an invalid canonical URL: ${route}`);
  }
}

for (const route of unpublishedEditorialRoutes) {
  if (outputRoutes.includes(route)) {
    throw new Error(`Incomplete variant reached the build output: ${route}`);
  }
}

const catalanEvent = await readFile(
  join(distPath, "ca/esdeveniments/jornada-muntanya/index.html"),
  "utf8",
);
if (!catalanEvent.includes(">Actiu<") || catalanEvent.includes(">Active<")) {
  throw new Error("The Catalan event status must use its Paraglide message.");
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
for (const route of [
  "https://mountainrunners.cat/ca/",
  "https://mountainrunners.cat/ca/escoles/escola-trail/",
  "https://mountainrunners.cat/ca/esdeveniments/jornada-muntanya/",
]) {
  if (!sitemap.includes(`<loc>${route}</loc>`)) {
    throw new Error(`Sitemap is missing published route: ${route}`);
  }
}
if (sitemap.includes("https://mountainrunners.cat/es/")) {
  throw new Error("Sitemap includes an incomplete localized variant.");
}

const robots = await readFile(join(distPath, "robots.txt"), "utf8");
if (!robots.includes("Sitemap: https://mountainrunners.cat/sitemap.xml")) {
  throw new Error("Robots output does not declare the canonical sitemap URL.");
}
if (
  catalanEvent.includes('hreflang="es"') ||
  catalanEvent.includes('hreflang="en"')
) {
  throw new Error("Incomplete event variants reached hreflang metadata.");
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
