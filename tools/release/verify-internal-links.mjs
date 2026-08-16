#!/usr/bin/env node
// Verifies that every internal link and local file referenced by the built
// output resolves to an existing regular file inside the build root.
//
// Contract (T5.2): internal references — relative or root-relative hrefs,
// srcs, srcset candidates and CSS url() values — are blocking and must resolve
// inside the build. Absolute URLs (http, https, mailto, tel, data, ...) are
// treated as external and only validated structurally (parseable URL), never
// fetched; this includes absolute same-origin URLs, which the editorial
// content may use to point at resources served outside this build (e.g. the
// previous Anella Verda site) and which are reviewed remotely at the launch
// gate instead.
import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const htmlAttributePattern = /\b(href|src|srcset)\s*=\s*["']([^"']*)["']/giu;
const cssUrlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/giu;
const protocolPattern = /^[a-z][a-z0-9+.-]*:/iu;

function splitSrcset(srcset) {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/u)[0])
    .filter(Boolean);
}

function hasKnownProtocol(value) {
  return protocolPattern.test(value);
}

// Resolves an internal reference to a relative path inside the build root.
// Returns null when the reference is a pure anchor, a protocol-relative URL,
// an absolute URL or an empty value.
function resolveLocalTarget(reference, sourceFile, distRoot) {
  const pathname = reference.split(/[?#]/u, 1)[0];
  if (
    pathname === "" ||
    pathname.startsWith("//") ||
    hasKnownProtocol(pathname)
  ) {
    return null;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname).replaceAll("&amp;", "&");
  } catch {
    throw new Error(`Invalid percent-encoding in ${reference} (${sourceFile})`);
  }

  const target = decodedPath.startsWith("/")
    ? resolve(distRoot, `.${decodedPath}`)
    : resolve(dirname(sourceFile), decodedPath);
  const relativeToRoot = relative(distRoot, target);
  if (relativeToRoot.startsWith("..")) {
    throw new Error(
      `Internal reference escapes the build root: ${reference} (${sourceFile})`,
    );
  }
  return relativeToRoot;
}

async function isExistingFile(candidate) {
  try {
    return (await lstat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function targetExists(distRoot, relativePath) {
  const absolute = resolve(distRoot, relativePath);
  if (await isExistingFile(absolute)) {
    return true;
  }
  const indexed =
    relativePath.endsWith("/") || relativePath === ""
      ? `${relativePath}index.html`
      : `${relativePath}/index.html`;
  return isExistingFile(resolve(distRoot, indexed));
}

async function listSourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(path)));
    } else if (/\.(html|css)$/iu.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function collectHtmlReferences(content, pattern, sourceFile, references) {
  for (const match of content.matchAll(pattern)) {
    const attribute = match[1].toLowerCase();
    const values = attribute === "srcset" ? splitSrcset(match[2]) : [match[2]];
    for (const value of values) {
      references.push({ sourceFile, attribute, value });
    }
  }
}

function collectCssReferences(content, pattern, sourceFile, references) {
  for (const match of content.matchAll(pattern)) {
    references.push({ sourceFile, attribute: "url", value: match[2] });
  }
}

export async function verifyInternalLinks(distRoot) {
  const sourceFiles = await listSourceFiles(distRoot);
  const references = [];
  for (const sourceFile of sourceFiles) {
    const content = await readFile(sourceFile, "utf8");
    if (sourceFile.endsWith(".html")) {
      collectHtmlReferences(
        content,
        htmlAttributePattern,
        sourceFile,
        references,
      );
    }
    collectCssReferences(content, cssUrlPattern, sourceFile, references);
  }

  const failures = [];
  for (const { sourceFile, attribute, value } of references) {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    if (hasKnownProtocol(trimmed)) {
      try {
        new URL(trimmed);
      } catch {
        failures.push(
          `${sourceFile}: structurally invalid external ${attribute}: ${trimmed}`,
        );
      }
      continue;
    }

    const relativePath = resolveLocalTarget(trimmed, sourceFile, distRoot);
    if (
      relativePath !== null &&
      !(await targetExists(distRoot, relativePath))
    ) {
      failures.push(
        `${sourceFile}: internal ${attribute} target missing: ${trimmed}`,
      );
    }
  }

  if (failures.length > 0) {
    const shown = failures.slice(0, 20);
    const hidden = failures.length - shown.length;
    const suffix = hidden > 0 ? `\n… and ${hidden} more failures` : "";
    throw new Error(
      `Internal link verification failed:\n${shown.join("\n")}${suffix}`,
    );
  }
  return references.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distRoot = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(
        fileURLToPath(new URL("../..", import.meta.url)),
        "apps/web/dist",
      );
  const checked = await verifyInternalLinks(distRoot);
  console.log(`Internal link verification passed (${checked} references).`);
}
