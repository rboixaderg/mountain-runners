import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkSkillFrontmatter,
  compareSkill,
  isClean,
  parseFrontmatter,
  readSkillFiles,
} from "./manifest.mjs";

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const skillsDirectory = join(repositoryRoot, ".agents", "skills");
const manifest = JSON.parse(
  readFileSync(join(skillsDirectory, "skills-manifest.json"), "utf8"),
);
const skillNames = readdirSync(skillsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const ownSkillNames = skillNames.filter(
  (name) => !Object.hasOwn(manifest.skills, name),
);

const sampleSkill = [
  "---",
  "name: sample",
  "description: Sample skill.",
  "---",
  "",
  "# Sample",
  "",
].join("\n");

function createSkillFixture(t, files) {
  const directory = mkdtempSync(join(tmpdir(), "skills-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(directory, path);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return directory;
}

function pinnedEntry(directory) {
  const files = readSkillFiles(directory);
  return {
    sourceLicensePath: "LICENSE",
    licenseSha256: files.get("LICENSE"),
    files: Object.fromEntries(
      [...files].filter(([path]) => path !== "LICENSE"),
    ),
  };
}

test("external skills match the manifest file by file", () => {
  for (const [name, entry] of Object.entries(manifest.skills)) {
    const report = compareSkill(join(skillsDirectory, name), entry);
    assert.ok(
      isClean(report),
      `external skill ${name} does not match skills-manifest.json: ${JSON.stringify(report)}`,
    );
  }
});

test("skill frontmatter keeps only the allowed fields and its name", () => {
  for (const name of skillNames) {
    const problems = checkSkillFrontmatter(join(skillsDirectory, name), name);
    assert.deepEqual(problems, [], `${name}: ${problems.join("; ")}`);
  }
});

test("own skills carry metadata.version", () => {
  for (const name of ownSkillNames) {
    const problems = checkSkillFrontmatter(join(skillsDirectory, name), name, {
      requiresVersion: true,
    });
    assert.deepEqual(problems, [], `${name}: ${problems.join("; ")}`);
  }
});

test("a pinned skill directory matches its manifest entry", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": sampleSkill,
    LICENSE: "MIT\n",
    "references/guide.md": "Guide.\n",
  });
  const report = compareSkill(directory, pinnedEntry(directory));

  assert.deepEqual(report, {
    added: [],
    missing: [],
    modified: [],
    licenseMatches: true,
  });
  assert.equal(isClean(report), true);
  assert.deepEqual(checkSkillFrontmatter(directory, "sample"), []);
});

test("an added file is reported", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": sampleSkill,
    LICENSE: "MIT\n",
  });
  const entry = pinnedEntry(directory);
  writeFileSync(join(directory, "EXTRA.md"), "Extra.\n");

  const report = compareSkill(directory, entry);

  assert.deepEqual(report.added, ["EXTRA.md"]);
  assert.equal(isClean(report), false);
});

test("a missing file is reported", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": sampleSkill,
    LICENSE: "MIT\n",
    "references/guide.md": "Guide.\n",
  });
  const entry = pinnedEntry(directory);
  rmSync(join(directory, "references", "guide.md"));

  const report = compareSkill(directory, entry);

  assert.deepEqual(report.missing, ["references/guide.md"]);
  assert.equal(isClean(report), false);
});

test("a modified file is reported", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": sampleSkill,
    LICENSE: "MIT\n",
  });
  const entry = pinnedEntry(directory);
  writeFileSync(join(directory, "SKILL.md"), `${sampleSkill}\nMore.\n`);

  const report = compareSkill(directory, entry);

  assert.deepEqual(report.modified, ["SKILL.md"]);
  assert.equal(isClean(report), false);
});

test("a changed license is reported", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": sampleSkill,
    LICENSE: "MIT\n",
  });
  const entry = pinnedEntry(directory);
  writeFileSync(join(directory, "LICENSE"), "Apache-2.0\n");

  const report = compareSkill(directory, entry);

  assert.deepEqual(report.added, []);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.modified, []);
  assert.equal(report.licenseMatches, false);
  assert.equal(isClean(report), false);
});

test("a disallowed frontmatter key is reported", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": [
      "---",
      "name: sample",
      "description: Sample skill.",
      "allowed-tools: Bash",
      "---",
      "",
    ].join("\n"),
  });

  const problems = checkSkillFrontmatter(directory, "sample");

  assert.equal(problems.length, 1);
  assert.match(problems[0], /allowed-tools/u);
});

test("a frontmatter name that differs from the directory is reported", (t) => {
  const directory = createSkillFixture(t, { "SKILL.md": sampleSkill });

  const problems = checkSkillFrontmatter(directory, "other-name");

  assert.equal(problems.length, 1);
  assert.match(problems[0], /other-name/u);
});

test("a symbolic link inside a skill directory is refused", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": sampleSkill,
    LICENSE: "MIT\n",
  });
  symlinkSync(join(directory, "SKILL.md"), join(directory, "LINK.md"));

  assert.throws(
    () => readSkillFiles(directory),
    /must not be a symbolic link/u,
  );
});

test("an executable file inside a skill directory is refused", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": sampleSkill,
    LICENSE: "MIT\n",
  });
  chmodSync(join(directory, "SKILL.md"), 0o755);

  assert.throws(() => readSkillFiles(directory), /must not be executable/u);
});

test("an own skill without metadata.version is reported", (t) => {
  const withoutVersion = createSkillFixture(t, { "SKILL.md": sampleSkill });
  const withVersion = createSkillFixture(t, {
    "SKILL.md": [
      "---",
      "name: sample",
      "description: Sample skill.",
      "metadata:",
      '  version: "1.0.0"',
      "---",
      "",
    ].join("\n"),
  });

  assert.deepEqual(
    checkSkillFrontmatter(withoutVersion, "sample", { requiresVersion: true }),
    ["SKILL.md frontmatter needs metadata.version"],
  );
  assert.deepEqual(
    checkSkillFrontmatter(withVersion, "sample", { requiresVersion: true }),
    [],
  );
});

test("a frontmatter line that is not a plain key is refused", (t) => {
  const forms = [
    '"allowed-tools": Bash',
    "allowed-tools : Bash",
    "? allowed-tools",
    "{name: sample}",
  ];
  for (const form of forms) {
    const directory = createSkillFixture(t, {
      "SKILL.md": ["---", "name: sample", form, "---", ""].join("\n"),
    });

    assert.throws(
      () => parseFrontmatter(readFileSync(join(directory, "SKILL.md"), "utf8")),
      /is not a plain "key: value" line/u,
      form,
    );
  }
});

test("a duplicated frontmatter key is refused", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": [
      "---",
      "name: sample",
      "description: First.",
      "description: Second.",
      "---",
      "",
    ].join("\n"),
  });

  assert.throws(
    () => parseFrontmatter(readFileSync(join(directory, "SKILL.md"), "utf8")),
    /frontmatter key "description" appears more than once/u,
  );
});

test("every external skill declares its upstream repository id", () => {
  for (const [name, entry] of Object.entries(manifest.skills)) {
    assert.match(String(entry.repositoryId), /^[0-9]+$/u, name);
  }
});

test("a scalar frontmatter key cannot continue on an indented line", (t) => {
  for (const form of [
    "name: sample\n  more: value",
    "license: MIT\n  more: value",
  ]) {
    const directory = createSkillFixture(t, {
      "SKILL.md": ["---", form, "description: Sample.", "---", ""].join("\n"),
    });

    assert.throws(
      () => parseFrontmatter(readFileSync(join(directory, "SKILL.md"), "utf8")),
      /cannot continue/u,
      form,
    );
  }
});

test("metadata still holds nested values", (t) => {
  const directory = createSkillFixture(t, {
    "SKILL.md": [
      "---",
      "name: sample",
      "description: Sample.",
      "metadata:",
      '  version: "1.2.3"',
      "---",
      "",
    ].join("\n"),
  });

  assert.equal(
    parseFrontmatter(readFileSync(join(directory, "SKILL.md"), "utf8")).version,
    "1.2.3",
  );
});
