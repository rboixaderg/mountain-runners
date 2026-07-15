import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pages = [
  ["ca", "Base web en construcció"],
  ["es", "Base web en construcción"],
  ["en", "Website foundation under construction"],
];

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
const unexpectedRoutes = htmlFiles
  .map((path) => relative(distPath, path))
  .filter(
    (path) =>
      path !== "index.html" &&
      !pages.some(([locale]) => path.startsWith(`${locale}/`)),
  );

if (unexpectedRoutes.length > 0) {
  throw new Error(
    `Public HTML routes must use a locale prefix: ${unexpectedRoutes.join(", ")}`,
  );
}
