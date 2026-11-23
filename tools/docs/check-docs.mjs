#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkSkillFrontmatter,
  compareSkill,
} from "../agent-skills/manifest.mjs";

const SKILLS_DIRECTORY = ".agents/skills";
const SKILLS_MANIFEST = `${SKILLS_DIRECTORY}/skills-manifest.json`;
const DOCS_MAP_ROOT = "docs/README.md";
const LIVING_DOC_ROOTS = ["docs/", "tools/", "packages/"];
const LIVING_DOC_EXCLUSIONS = ["docs/decisions/", "docs/specs/"];
const TASK_IDENTIFIER = /\bT\d+\.\d+\b/u;

/**
 * The external skills are byte-identical copies of upstream repositories. Their
 * content is pinned in skills-manifest.json (rule 4), so a broken link inside
 * one of them cannot be fixed here and is not reported as a finding.
 */
function excludedSkillPrefixes(root) {
  const manifestPath = join(root, SKILLS_MANIFEST);
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return Object.keys(manifest.skills).map(
    (name) => `${SKILLS_DIRECTORY}/${name}/`,
  );
}

function readInventory(inventoryPath) {
  let output;
  try {
    output = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(readFileSync(inventoryPath));
  } catch (error) {
    throw new Error("Cannot read documentation files inventory", {
      cause: error,
    });
  }
  if (!output.endsWith("\0"))
    throw new Error("Invalid documentation files inventory");
  const entries = new Map();
  for (const record of output.slice(0, -1).split("\0")) {
    const status = record[0];
    const file = record.slice(1);
    if (
      (status !== "P" && status !== "D") ||
      posix.isAbsolute(file) ||
      file
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") ||
      (entries.has(file) && entries.get(file) !== status)
    ) {
      throw new Error("Invalid documentation files inventory");
    }
    entries.set(file, status);
  }
  return {
    present: [...entries]
      .filter(([, status]) => status === "P")
      .map(([file]) => file)
      .sort(),
    deleted: [...entries]
      .filter(([, status]) => status === "D")
      .map(([file]) => file)
      .sort(),
  };
}

export function listRepositoryFiles(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

function isPresentInWorktree(root, file) {
  try {
    lstatSync(join(root, file));
    return true;
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  }

  // Keep paths beneath symlinks: a broken link must still surface as a read error.
  let directory = posix.dirname(file);
  while (directory !== ".") {
    try {
      if (lstatSync(join(root, directory)).isSymbolicLink()) return true;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    directory = posix.dirname(directory);
  }
  return false;
}

function verifyInventoryFiles(root, inventory) {
  for (const file of inventory.present) {
    lstatSync(join(root, file));
    let directory = posix.dirname(file);
    while (directory !== ".") {
      if (lstatSync(join(root, directory)).isSymbolicLink()) {
        throw new Error(`Inventory path crosses a symlink: ${file}`);
      }
      directory = posix.dirname(directory);
    }
  }
  for (const file of inventory.deleted) {
    if (isPresentInWorktree(root, file)) {
      throw new Error(
        `Deleted inventory path is present or crosses a symlink: ${file}`,
      );
    }
  }
}

function buildDirectorySet(files) {
  const directories = new Set(["."]);
  for (const file of files) {
    let directory = posix.dirname(file);
    while (directory !== "." && !directories.has(directory)) {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  return directories;
}

function maskInlineCode(line) {
  const characters = line.split("");
  let index = 0;
  while (index < characters.length) {
    if (characters[index] !== "`") {
      index += 1;
      continue;
    }
    let runLength = 1;
    while (characters[index + runLength] === "`") runLength += 1;
    const marker = "`".repeat(runLength);
    const end = line.indexOf(marker, index + runLength);
    if (end === -1) {
      index += runLength;
      continue;
    }
    for (let cursor = index; cursor < end + runLength; cursor += 1) {
      characters[cursor] = " ";
    }
    index = end + runLength;
  }
  return characters.join("");
}

/**
 * Returns the text with fenced code blocks replaced by spaces, so headings and
 * links inside them are ignored while line and column positions stay intact.
 */
export function maskFencedBlocks(text) {
  const characters = text.split("");
  let offset = 0;
  let fence = null;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      for (
        let cursor = lineStart;
        cursor < lineStart + line.length;
        cursor += 1
      ) {
        characters[cursor] = " ";
      }
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (
        close &&
        close[1][0] === fence[0] &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      for (
        let cursor = lineStart;
        cursor < lineStart + line.length;
        cursor += 1
      ) {
        characters[cursor] = " ";
      }
      fence = fenceMatch[1];
    }
  }
  return characters.join("");
}

/**
 * Also masks inline code spans. Links inside inline code are not rendered as
 * links, so the link check ignores them.
 */
export function maskCode(text) {
  const masked = maskFencedBlocks(text).split("\n");
  return masked.map(maskInlineCode).join("\n");
}

function headingLines(maskedText) {
  const headings = [];
  const lines = maskedText.split("\n");
  for (const [index, line] of lines.entries()) {
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.push({ line: index + 1, text: match[2] });
  }
  return headings;
}

function slugify(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

export function headingAnchors(text) {
  const anchors = new Set();
  const counts = new Map();
  for (const { text: heading } of headingLines(maskFencedBlocks(text))) {
    const base = slugify(heading);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function normalizeDestination(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/u)[0] ?? "";
}

function extractLinks(maskedText) {
  const links = [];
  const lines = maskedText.split("\n");
  for (const [index, line] of lines.entries()) {
    const pattern = /!?\[[^\]]*\]\(([^)]*)\)/gu;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      links.push({
        line: index + 1,
        destination: normalizeDestination(match[1]),
      });
    }
  }
  return links;
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitDestination(destination) {
  const hashIndex = destination.indexOf("#");
  if (hashIndex === -1) return { path: destination, fragment: undefined };
  return {
    path: destination.slice(0, hashIndex),
    fragment: decode(destination.slice(hashIndex + 1)),
  };
}

function isLocalDestination(destination) {
  if (destination === "" || destination === "#") return false;
  if (destination.startsWith("//")) return false;
  if (destination.startsWith("/")) return false;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(destination);
}

function isExistingDirectory(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function resolveTarget(sourceFile, targetPath) {
  const decodedPath = decode(targetPath);
  const resolved = posix.normalize(
    posix.join(posix.dirname(sourceFile), decodedPath),
  );
  return resolved === "" ? "." : resolved.replace(/\/+$/u, "");
}

function isLivingDocument(file) {
  if (!file.endsWith(".md")) return false;
  if (!LIVING_DOC_ROOTS.some((root) => file.startsWith(root))) return false;
  return !LIVING_DOC_EXCLUSIONS.some((prefix) => file.startsWith(prefix));
}

function checkLinks({ root, files, fileSet, directorySet, findings }) {
  const excludedPrefixes = excludedSkillPrefixes(root);
  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) {
      anchorCache.set(
        file,
        headingAnchors(readFileSync(join(root, file), "utf8")),
      );
    }
    return anchorCache.get(file);
  };

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    if (excludedPrefixes.some((prefix) => file.startsWith(prefix))) continue;

    const masked = maskCode(readFileSync(join(root, file), "utf8"));
    for (const { line, destination } of extractLinks(masked)) {
      if (!isLocalDestination(destination)) continue;
      const { path: targetPath, fragment } = splitDestination(destination);

      if (targetPath === "") {
        if (fragment === undefined) continue;
        if (!anchorsOf(file).has(fragment)) {
          findings.push({
            path: file,
            line,
            message: `anchor "#${fragment}" does not match any heading in this file`,
          });
        }
        continue;
      }

      const target = resolveTarget(file, targetPath);
      const isFile = fileSet.has(target);
      const isDirectory =
        directorySet.has(target) || isExistingDirectory(join(root, target));
      if (!isFile && !isDirectory) {
        findings.push({
          path: file,
          line,
          message: `link target "${targetPath}" does not resolve to a tracked file or directory`,
        });
        continue;
      }
      if (fragment === undefined || fragment === "") continue;
      if (!isFile || !target.endsWith(".md")) continue;
      if (!anchorsOf(target).has(fragment)) {
        findings.push({
          path: file,
          line,
          message: `anchor "#${fragment}" does not match any heading in "${target}"`,
        });
      }
    }
  }
}

function checkDocumentationMap({
  root,
  files,
  fileSet,
  directorySet,
  findings,
}) {
  const documentationFiles = files.filter((file) => file.startsWith("docs/"));
  const reached = new Set();
  const queue = [];
  const reach = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    if (file.endsWith(".md") && fileSet.has(file)) queue.push(file);
  };

  if (fileSet.has(DOCS_MAP_ROOT)) {
    reach(DOCS_MAP_ROOT);
  }

  while (queue.length > 0) {
    const file = queue.shift();
    const masked = maskCode(readFileSync(join(root, file), "utf8"));
    for (const { destination } of extractLinks(masked)) {
      if (!isLocalDestination(destination)) continue;
      const { path: targetPath } = splitDestination(destination);
      if (targetPath === "") continue;

      const target = resolveTarget(file, targetPath);
      if (!fileSet.has(target) && !directorySet.has(target)) continue;
      reach(target);
      if (directorySet.has(target)) {
        const readme = posix.join(target, "README.md");
        if (fileSet.has(readme)) reach(readme);
      }
    }
  }

  for (const file of documentationFiles) {
    if (reached.has(file)) continue;
    findings.push({
      path: file,
      line: 1,
      message: `is not reachable from ${DOCS_MAP_ROOT} by following relative links`,
    });
  }
}

function checkTaskIdentifiers({ root, files, findings }) {
  for (const file of files) {
    if (!isLivingDocument(file)) continue;
    const masked = maskFencedBlocks(readFileSync(join(root, file), "utf8"));
    for (const { line, text } of headingLines(masked)) {
      if (TASK_IDENTIFIER.test(text)) {
        findings.push({
          path: file,
          line,
          message: `heading "${text}" contains a task identifier`,
        });
      }
    }
  }
}

function readManifest(root) {
  const manifestPath = join(root, SKILLS_MANIFEST);
  if (!existsSync(manifestPath)) return { skills: {} };
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function checkExternalSkills({ root, findings }) {
  const manifest = readManifest(root);
  for (const [name, entry] of Object.entries(manifest.skills)) {
    const skillDirectory = join(root, SKILLS_DIRECTORY, name);
    const skillFile = `${SKILLS_DIRECTORY}/${name}/SKILL.md`;
    if (!existsSync(skillDirectory)) {
      findings.push({
        path: skillFile,
        line: 1,
        message: "external skill directory is missing",
      });
      continue;
    }

    let report;
    try {
      report = compareSkill(skillDirectory, entry);
    } catch (error) {
      findings.push({ path: skillFile, line: 1, message: error.message });
      continue;
    }
    for (const path of report.added) {
      findings.push({
        path: `${SKILLS_DIRECTORY}/${name}/${path}`,
        line: 1,
        message: "external skill file is not pinned in skills-manifest.json",
      });
    }
    for (const path of report.missing) {
      findings.push({
        path: `${SKILLS_DIRECTORY}/${name}/${path}`,
        line: 1,
        message: "pinned external skill file is missing",
      });
    }
    for (const path of report.modified) {
      findings.push({
        path: `${SKILLS_DIRECTORY}/${name}/${path}`,
        line: 1,
        message: "external skill file differs from skills-manifest.json",
      });
    }
    if (!report.licenseMatches) {
      const licenseFile = entry.sourceLicensePath.split("/").at(-1);
      findings.push({
        path: `${SKILLS_DIRECTORY}/${name}/${licenseFile}`,
        line: 1,
        message:
          "external skill license hash differs from skills-manifest.json",
      });
    }

    try {
      for (const problem of checkSkillFrontmatter(skillDirectory, name)) {
        findings.push({ path: skillFile, line: 1, message: problem });
      }
    } catch (error) {
      findings.push({ path: skillFile, line: 1, message: error.message });
    }
  }
}

function checkOwnSkills({ root, findings }) {
  const skillsDirectory = join(root, SKILLS_DIRECTORY);
  if (!existsSync(skillsDirectory)) return;
  const manifest = readManifest(root);
  for (const entry of readdirSync(skillsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || Object.hasOwn(manifest.skills, entry.name)) {
      continue;
    }
    const skillFile = `${SKILLS_DIRECTORY}/${entry.name}/SKILL.md`;
    try {
      for (const problem of checkSkillFrontmatter(
        join(skillsDirectory, entry.name),
        entry.name,
        { requiresVersion: true },
      )) {
        findings.push({ path: skillFile, line: 1, message: problem });
      }
    } catch (error) {
      findings.push({ path: skillFile, line: 1, message: error.message });
    }
  }
}

export function checkDocumentation(root, inventoryPath) {
  const inventory =
    inventoryPath === undefined ? undefined : readInventory(inventoryPath);
  const files = inventory
    ? inventory.present
    : listRepositoryFiles(root).filter((file) =>
        isPresentInWorktree(root, file),
      );
  if (inventory) verifyInventoryFiles(root, inventory);
  const fileSet = new Set(files);
  const directorySet = buildDirectorySet(files);
  const context = { root, files, fileSet, directorySet, findings: [] };

  checkLinks(context);
  checkDocumentationMap(context);
  checkTaskIdentifiers(context);
  checkExternalSkills(context);
  checkOwnSkills(context);

  if (inventory) verifyInventoryFiles(root, inventory);

  return context.findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line,
  );
}

function main() {
  const findings = checkDocumentation(
    process.cwd(),
    process.env.MOUNTAIN_AGENT_DOCUMENTATION_FILES,
  );
  for (const finding of findings) {
    console.log(`${finding.path}:${finding.line}: ${finding.message}`);
  }
  if (findings.length > 0) {
    console.error(`\n${findings.length} documentation finding(s).`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
