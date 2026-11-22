import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const ALLOWED_FRONTMATTER_KEYS = Object.freeze([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
]);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function hashDirectory(directory, skillDirectory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`${entryPath} must not be a symbolic link`);
    }
    if (entry.isDirectory()) {
      hashDirectory(entryPath, skillDirectory, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`${entryPath} must be a regular file`);
    }
    if (lstatSync(entryPath).mode & 0o111) {
      throw new Error(`${entryPath} must not be executable`);
    }
    const relativePath = relative(skillDirectory, entryPath)
      .split(sep)
      .join("/");
    files.set(relativePath, sha256(readFileSync(entryPath)));
  }
  return files;
}

export function readSkillFiles(skillDirectory) {
  return hashDirectory(skillDirectory, skillDirectory, new Map());
}

export function compareSkill(skillDirectory, entry) {
  const licenseFile = entry.sourceLicensePath.split("/").at(-1);
  const files = readSkillFiles(skillDirectory);
  const report = {
    added: [],
    missing: [],
    modified: [],
    licenseMatches: false,
  };

  for (const [path, expectedHash] of Object.entries(entry.files)) {
    const actualHash = files.get(path);
    if (actualHash === undefined) {
      report.missing.push(path);
    } else if (actualHash !== expectedHash) {
      report.modified.push(path);
    }
  }

  for (const path of files.keys()) {
    if (path !== licenseFile && !Object.hasOwn(entry.files, path)) {
      report.added.push(path);
    }
  }

  report.added.sort();
  report.missing.sort();
  report.modified.sort();
  report.licenseMatches = files.get(licenseFile) === entry.licenseSha256;
  return report;
}

export function isClean(report) {
  return (
    report.added.length === 0 &&
    report.missing.length === 0 &&
    report.modified.length === 0 &&
    report.licenseMatches
  );
}

export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/u);
  if (lines[0] !== "---") {
    throw new Error("SKILL.md must start with a frontmatter block");
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new Error("SKILL.md frontmatter block is not closed");
  }

  const keys = [];
  let name;
  let version;
  let inMetadata = false;
  for (const line of lines.slice(1, end)) {
    const topLevel = /^([A-Za-z0-9_-]+):(.*)$/u.exec(line);
    if (topLevel) {
      const [, key, value] = topLevel;
      keys.push(key);
      inMetadata = key === "metadata";
      if (key === "name") {
        name = value.trim().replace(/^["']|["']$/gu, "");
      }
      continue;
    }
    const nested = /^\s+version:(.*)$/u.exec(line);
    if (inMetadata && nested) {
      version = nested[1].trim().replace(/^["']|["']$/gu, "");
    }
  }

  return { keys, name, version };
}

export function checkSkillFrontmatter(
  skillDirectory,
  expectedName,
  { requiresVersion = false } = {},
) {
  const { keys, name, version } = parseFrontmatter(
    readFileSync(join(skillDirectory, "SKILL.md"), "utf8"),
  );
  const problems = keys
    .filter((key) => !ALLOWED_FRONTMATTER_KEYS.includes(key))
    .map(
      (key) =>
        `SKILL.md frontmatter key "${key}" is not one of ${ALLOWED_FRONTMATTER_KEYS.join(", ")}`,
    );

  if (name !== expectedName) {
    problems.push(
      `SKILL.md name "${name}" must equal the directory name "${expectedName}"`,
    );
  }
  if (requiresVersion && !version) {
    problems.push(`SKILL.md frontmatter needs metadata.version`);
  }
  return problems;
}
