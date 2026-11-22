import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { readSkillFiles } from "../agent-skills/manifest.mjs";
import { checkDocumentation } from "./check-docs.mjs";

const OWN_SKILL = [
  "---",
  "name: own",
  "description: Own skill.",
  "metadata:",
  '  version: "1.0.0"',
  "---",
  "",
  "# Own",
  "",
].join("\n");

function baseFiles() {
  return {
    "docs/README.md": "# Map\n\n- [Guide](guide.md)\n",
    "docs/guide.md": "# Guide\n",
    ".agents/skills/skills-manifest.json": `${JSON.stringify({ skills: {} })}\n`,
    ".agents/skills/own/SKILL.md": OWN_SKILL,
  };
}

function writeFiles(directory, files) {
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(directory, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

function createRepository(t, files) {
  const directory = mkdtempSync(join(tmpdir(), "check-docs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: directory });
  writeFiles(directory, files);
  return directory;
}

function pinnedEntry(directory, name) {
  const files = readSkillFiles(join(directory, ".agents/skills", name));
  return {
    sourceLicensePath: "LICENSE",
    licenseSha256: files.get("LICENSE"),
    files: Object.fromEntries(
      [...files].filter(([path]) => path !== "LICENSE"),
    ),
  };
}

function pinSkills(directory, names) {
  const skills = {};
  for (const name of names) {
    skills[name] = pinnedEntry(directory, name);
  }
  writeFileSync(
    join(directory, ".agents/skills/skills-manifest.json"),
    `${JSON.stringify({ skills })}\n`,
  );
}

function externalSkill(name, skillContent, extraFiles = {}) {
  return {
    [`.agents/skills/${name}/SKILL.md`]: skillContent,
    [`.agents/skills/${name}/LICENSE`]: "MIT\n",
    ...extraFiles,
  };
}

function externalSkillContent(name) {
  return [
    "---",
    `name: ${name}`,
    "description: External skill.",
    "---",
    "",
    `# ${name}`,
    "",
  ].join("\n");
}

function hasFinding(findings, path, pattern) {
  return findings.some(
    (finding) => finding.path === path && pattern.test(finding.message),
  );
}

test("accepts a documentation tree that satisfies every rule", (t) => {
  const directory = createRepository(t, baseFiles());

  assert.deepEqual(checkDocumentation(directory), []);
});

test("reports a relative link that does not resolve", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    "docs/guide.md": "# Guide\n\n[Missing](missing.md)\n",
  });

  const findings = checkDocumentation(directory);

  assert.ok(hasFinding(findings, "docs/guide.md", /does not resolve/u));
});

test("reports an anchor that does not match any heading", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    "docs/README.md": "# Map\n\n- [Guide](guide.md#missing)\n",
  });

  const findings = checkDocumentation(directory);

  assert.ok(hasFinding(findings, "docs/README.md", /anchor "#missing"/u));
});

test("accepts the anchors of duplicated headings", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    "docs/README.md":
      "# Map\n\n- [First](guide.md#repeat)\n- [Second](guide.md#repeat-1)\n",
    "docs/guide.md": "# Guide\n\n## Repeat\n\n## Repeat\n",
  });

  assert.deepEqual(checkDocumentation(directory), []);
});

test("ignores a link inside a fenced code block", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    "docs/guide.md": [
      "# Guide",
      "",
      "```md",
      "[Missing](missing.md)",
      "```",
      "",
      "Inline `[Missing](missing.md)` is not a link.",
      "",
    ].join("\n"),
  });

  assert.deepEqual(checkDocumentation(directory), []);
});

test("reports a documentation file that the map does not reach", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    "docs/orphan.md": "# Orphan\n",
  });

  const findings = checkDocumentation(directory);

  assert.ok(hasFinding(findings, "docs/orphan.md", /not reachable/u));
});

test("reports a task identifier in a living-document heading", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    "docs/README.md":
      "# Map\n\n- [Guide](guide.md)\n- [Live](live.md)\n- [Record](specs/record.md)\n",
    "docs/live.md": "## T8.4 Release\n",
    "docs/specs/record.md": "## T8.4 Release\n",
  });

  const findings = checkDocumentation(directory);

  assert.ok(hasFinding(findings, "docs/live.md", /task identifier/u));
  assert.equal(
    findings.some((finding) => finding.path === "docs/specs/record.md"),
    false,
  );
});

test("reports an external skill file that the manifest does not pin", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    ...externalSkill("external", externalSkillContent("external")),
  });
  pinSkills(directory, ["external"]);
  writeFileSync(
    join(directory, ".agents/skills/external/EXTRA.md"),
    "Extra.\n",
  );

  const findings = checkDocumentation(directory);

  assert.ok(
    hasFinding(
      findings,
      ".agents/skills/external/EXTRA.md",
      /not pinned in skills-manifest.json/u,
    ),
  );
});

test("reports a disallowed external skill frontmatter key", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    ...externalSkill(
      "external",
      [
        "---",
        "name: external",
        "description: External skill.",
        "allowed-tools: Bash",
        "---",
        "",
        "# external",
        "",
      ].join("\n"),
    ),
  });
  pinSkills(directory, ["external"]);

  const findings = checkDocumentation(directory);

  assert.ok(
    hasFinding(findings, ".agents/skills/external/SKILL.md", /allowed-tools/u),
  );
});

test("ignores a broken link inside an excluded external skill", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    ...externalSkill(
      "external",
      `${externalSkillContent("external")}[Missing](missing.md)\n`,
    ),
  });
  pinSkills(directory, ["external"]);

  assert.deepEqual(checkDocumentation(directory), []);
});

test("reports an own skill without metadata.version", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    ".agents/skills/own/SKILL.md": [
      "---",
      "name: own",
      "description: Own skill.",
      "---",
      "",
      "# Own",
      "",
    ].join("\n"),
  });

  const findings = checkDocumentation(directory);

  assert.ok(
    hasFinding(
      findings,
      ".agents/skills/own/SKILL.md",
      /needs metadata\.version/u,
    ),
  );
});
