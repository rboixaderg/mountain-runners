import { readFile } from "node:fs/promises";

const pages = [
  ["ca", "Base web en construcció"],
  ["es", "Base web en construcción"],
  ["en", "Website foundation under construction"],
];

const root = await readFile(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);

if (!root.includes('href="/ca/"')) {
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
