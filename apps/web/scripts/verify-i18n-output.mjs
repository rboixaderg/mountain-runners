import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pages = [
  ["ca", "Base web en construcció"],
  ["es", "Base web en construcción"],
  ["en", "Website foundation under construction"],
];

const expectedEditorialRoutes = [
  "ca/qui-som/index.html",
  "es/quienes-somos/index.html",
  "ca/schools/escola-trail/index.html",
  "ca/events/jornada-muntanya/index.html",
];

const unpublishedEditorialRoutes = [
  "en/qui-som/index.html",
  "es/schools/escola-trail/index.html",
  "en/schools/escola-trail/index.html",
  "es/events/jornada-muntanya/index.html",
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
  if (!output.includes('<link rel="canonical"')) {
    throw new Error(`Editorial route is missing canonical metadata: ${route}`);
  }
}

for (const route of unpublishedEditorialRoutes) {
  if (outputRoutes.includes(route)) {
    throw new Error(`Incomplete variant reached the build output: ${route}`);
  }
}

const catalanPage = await readFile(
  join(distPath, "ca/qui-som/index.html"),
  "utf8",
);
for (const tag of [
  '<link rel="canonical" href="/ca/qui-som/">',
  '<link rel="alternate" hreflang="ca" href="/ca/qui-som/">',
  '<link rel="alternate" hreflang="es" href="/es/quienes-somos/">',
]) {
  if (!catalanPage.includes(tag)) {
    throw new Error(`Catalan page is missing expected metadata: ${tag}`);
  }
}
if (catalanPage.includes('hreflang="en"')) {
  throw new Error("Incomplete English variant reached hreflang metadata.");
}
if (
  !catalanPage.includes("Guia del club") ||
  !catalanPage.includes(
    'href="/content-resources/content-assets/documents/club-guide.pdf"',
  )
) {
  throw new Error("Published document is not linked from its public page.");
}

const catalanEvent = await readFile(
  join(distPath, "ca/events/jornada-muntanya/index.html"),
  "utf8",
);
if (!catalanEvent.includes(">Actiu<") || catalanEvent.includes(">Active<")) {
  throw new Error("The Catalan event status must use its Paraglide message.");
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
