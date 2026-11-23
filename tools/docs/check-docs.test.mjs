import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readSkillFiles } from "../agent-skills/manifest.mjs";
import { checkDocumentation, listRepositoryFiles } from "./check-docs.mjs";

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

function runCli(directory, inventory) {
  const env = { ...process.env };
  delete env.MOUNTAIN_AGENT_DOCUMENTATION_FILES;
  if (inventory !== undefined)
    env.MOUNTAIN_AGENT_DOCUMENTATION_FILES = inventory;
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./check-docs.mjs", import.meta.url))],
    {
      cwd: directory,
      env,
      encoding: "utf8",
    },
  );
}

function captureInventory(directory) {
  const inventory = join(directory, "inventory");
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: directory, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const deleted = new Set(
    execFileSync("git", ["ls-files", "--deleted", "-z"], {
      cwd: directory,
      encoding: "utf8",
    }).split("\0"),
  );
  writeFileSync(
    inventory,
    `${files.map((file) => `${deleted.has(file) ? "D" : "P"}${file}`).join("\0")}\0`,
  );
  return inventory;
}

test("uses the captured Git inventory without a gitdir and reports real findings", (t) => {
  const directory = createRepository(t, {
    ".gitignore": "ignored*.md\n",
    "docs/README.md":
      "# Map\n\n- [Guide](guide.md)\n- [Space](space%20name.md)\n- [Newline](line%0Aname.md)\n- [Tracked](ignored-tracked.md)\n",
    "docs/guide.md": "# Guide\n\n[Missing](missing.md)\n",
    "docs/space name.md": "# T8.6 Space\n",
    "docs/line\nname.md": "# T8.7 Newline\n",
    "docs/ignored-tracked.md": "# T8.4 Tracked\n",
    "docs/ignored-untracked.md": "# T8.5 Ignored\n",
  });
  execFileSync("git", ["add", "-f", "docs/ignored-tracked.md"], {
    cwd: directory,
  });
  const inventory = captureInventory(directory);

  const normal = runCli(directory);
  assert.equal(normal.status, 1);
  assert.match(normal.stdout, /docs\/guide\.md:3:.*does not resolve/u);
  assert.match(normal.stdout, /docs\/ignored-tracked\.md:1:.*task identifier/u);
  assert.match(normal.stdout, /docs\/space name\.md:1:.*task identifier/u);
  assert.match(normal.stdout, /docs\/line\nname\.md:1:.*task identifier/u);
  assert.doesNotMatch(normal.stdout, /ignored-untracked/u);

  rmSync(join(directory, ".git"), { recursive: true });
  writeFileSync(
    join(directory, ".git"),
    "gitdir: /nonexistent/check-docs-gitdir\n",
  );
  assert.notEqual(runCli(directory).status, 0);
  const sandbox = runCli(directory, inventory);
  assert.equal(sandbox.status, 1);
  assert.equal(sandbox.stdout, normal.stdout);
  assert.equal(sandbox.stderr, normal.stderr);
  writeFiles(directory, {
    "docs/guide.md": "# Guide\n",
    "docs/ignored-tracked.md": "# Tracked\n",
    "docs/space name.md": "# Space\n",
    "docs/line\nname.md": "# Newline\n",
  });
  const clean = runCli(directory, inventory);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stdout, "");
});

for (const mode of ["Git", "inventory"])
  test(`skips indexed deleted and renamed files in ${mode} and reports links to their old paths`, (t) => {
    const directory = createRepository(t, {
      "docs/README.md":
        "# Map\n\n[New](new.md)\n[Old](old.md#old)\n[Deleted](old-dir/deleted.md)\n[Directory](old-dir/)\n",
      "docs/old.md": "# Old\n",
      "docs/old-dir/deleted.md": "# Deleted\n",
    });
    execFileSync("git", ["add", "docs"], { cwd: directory });
    renameSync(join(directory, "docs/old.md"), join(directory, "docs/new.md"));
    rmSync(join(directory, "docs/old-dir"), { recursive: true });
    const inventory = captureInventory(directory);
    const records = readFileSync(inventory, "utf8").split("\0");
    assert.ok(records.includes("Ddocs/old.md"));
    assert.ok(records.includes("Ddocs/old-dir/deleted.md"));
    assert.ok(records.includes("Pdocs/new.md"));

    const inventoryPath = mode === "Git" ? undefined : inventory;
    const result = runCli(directory, inventoryPath);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /link target "old\.md" does not resolve/u);
    assert.match(
      result.stdout,
      /link target "old-dir\/deleted\.md" does not resolve/u,
    );
    assert.match(result.stdout, /link target "old-dir\/" does not resolve/u);
    assert.doesNotMatch(result.stderr, /ENOENT/u);
    writeFileSync(
      join(directory, "docs/README.md"),
      "# Map\n\n[New](new.md)\n",
    );
    const clean = runCli(directory, inventoryPath);
    assert.equal(clean.status, 0, clean.stderr);
  });

for (const name of ["temporary.md", "temporary.txt"])
  test(`fails when an inventoried ${name} is temporarily absent`, (t) => {
    const directory = createRepository(t, {
      ...baseFiles(),
      [`tools/${name}`]: "# Temporary\n",
    });
    const inventory = captureInventory(directory);
    const file = join(directory, "tools", name);
    const saved = `${file}.saved`;
    renameSync(file, saved);
    try {
      const result = runCli(directory, inventory);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ENOENT/u);
      assert.ok(result.stderr.includes(name));
    } finally {
      renameSync(saved, file);
    }
    const restored = runCli(directory, inventory);
    assert.equal(restored.status, 0, restored.stderr);
  });

for (const stage of ["before", "after"])
  test(`fails when an inventoried file disappears ${stage} its initial check`, (t) => {
    const name = stage === "before" ? "temporary.md" : "temporary.txt";
    const directory = createRepository(t, {
      ...baseFiles(),
      [`tools/${name}`]: "# Temporary\n",
    });
    const inventory = captureInventory(directory);
    const file = join(realpathSync(directory), "tools", name);
    const saved = `${file}.saved`;
    const hook = join(directory, "remove-during-check.cjs");
    writeFileSync(
      hook,
      `
    const fs = require('node:fs');
    const original = fs.lstatSync;
    let removed = false;
    fs.lstatSync = function(path, ...args) {
      if (!removed && path === ${JSON.stringify(file)}) {
        const stats = ${JSON.stringify(stage)} === 'after' ? original.call(this, path, ...args) : undefined;
        fs.renameSync(path, ${JSON.stringify(saved)});
        removed = true;
        if (stats) return stats;
      }
      return original.call(this, path, ...args);
    };
    require('node:module').syncBuiltinESMExports();
  `,
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--require",
          hook,
          fileURLToPath(new URL("./check-docs.mjs", import.meta.url)),
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            MOUNTAIN_AGENT_DOCUMENTATION_FILES: inventory,
          },
          encoding: "utf8",
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ENOENT/u);
      assert.ok(result.stderr.includes(name));
    } finally {
      renameSync(saved, file);
    }
    assert.equal(runCli(directory, inventory).status, 0);
  });

test("does not hide read errors for existing documents", (t) => {
  const directory = createRepository(t, baseFiles());
  execFileSync("git", ["add", "docs"], { cwd: directory });
  const inventory = captureInventory(directory);
  const file = join(directory, "docs/guide.md");
  chmodSync(file, 0);
  try {
    try {
      readFileSync(file);
      t.skip("process can read files without permission bits");
      return;
    } catch (error) {
      assert.equal(error.code, "EACCES");
    }
    for (const inventoryPath of [undefined, inventory]) {
      const result = runCli(directory, inventoryPath);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EACCES/u);
    }
  } finally {
    chmodSync(file, 0o600);
  }
});

test("does not treat a broken tracked symlink as a deleted file", (t) => {
  const directory = createRepository(t, baseFiles());
  const file = join(directory, "docs/guide.md");
  rmSync(file);
  symlinkSync("missing.md", file);
  execFileSync("git", ["add", "docs"], { cwd: directory });
  const inventory = captureInventory(directory);
  for (const inventoryPath of [undefined, inventory]) {
    const result = runCli(directory, inventoryPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/u);
  }
});

test("does not hide a tracked document behind a broken directory symlink", (t) => {
  const directory = createRepository(t, {
    "docs/README.md": "# Map\n\n[Child](sub/child.md)\n",
    "docs/sub/child.md": "# Child\n",
  });
  execFileSync("git", ["add", "docs"], { cwd: directory });
  rmSync(join(directory, "docs/sub"), { recursive: true });
  symlinkSync("missing", join(directory, "docs/sub"));
  const inventory = captureInventory(directory);
  for (const inventoryPath of [undefined, inventory]) {
    const result = runCli(directory, inventoryPath);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      inventoryPath ? /Deleted inventory path/u : /ENOENT/u,
    );
  }
});

for (const [target, withChild] of [
  ["missing", false],
  ["../target", false],
  ["../target", true],
])
  test(`rejects a deleted path under a directory symlink to ${target} (child: ${withChild})`, (t) => {
    const directory = createRepository(t, {
      "docs/README.md": "# Map\n\n[Sub](sub)\n",
      "docs/sub/child.md": "# Child\n",
    });
    execFileSync("git", ["add", "docs"], { cwd: directory });
    rmSync(join(directory, "docs/sub"), { recursive: true });
    mkdirSync(join(directory, "target"));
    if (withChild)
      writeFileSync(join(directory, "target/child.md"), "# Child\n");
    symlinkSync(target, join(directory, "docs/sub"));

    const inventory = captureInventory(directory);
    const records = readFileSync(inventory, "utf8").split("\0");
    assert.ok(records.includes(`${withChild ? "P" : "D"}docs/sub/child.md`));
    assert.ok(records.includes("Pdocs/sub"));

    const result = runCli(directory, inventory);
    assert.notEqual(
      result.status,
      0,
      "CLI accepted a deleted path under a symlink",
    );
    assert.match(result.stderr, /inventory path.*docs\/sub\/child\.md/iu);
  });

test("rejects a deleted inventory path restored after capture", (t) => {
  const directory = createRepository(t, {
    "docs/README.md": "# Map\n",
    "tools/deleted.md": "# Deleted\n",
  });
  execFileSync("git", ["add", "docs", "tools"], { cwd: directory });
  rmSync(join(directory, "tools/deleted.md"));
  const inventory = captureInventory(directory);
  assert.ok(
    readFileSync(inventory, "utf8").split("\0").includes("Dtools/deleted.md"),
  );
  assert.equal(runCli(directory, inventory).status, 0);
  writeFileSync(join(directory, "tools/deleted.md"), "# Restored\n");
  const result = runCli(directory, inventory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Deleted inventory path.*tools\/deleted\.md/u);
});

test("rejects a deleted inventory path restored during the check", (t) => {
  const directory = createRepository(t, {
    "docs/README.md": "# Map\n",
    "tools/deleted.md": "# Deleted\n",
  });
  execFileSync("git", ["add", "docs", "tools"], { cwd: directory });
  const file = join(realpathSync(directory), "tools/deleted.md");
  rmSync(file);
  const inventory = captureInventory(directory);
  const hook = join(directory, "restore-during-check.cjs");
  writeFileSync(
    hook,
    `
    const fs = require('node:fs');
    const original = fs.lstatSync;
    let restored = false;
    fs.lstatSync = function(path, ...args) {
      try {
        return original.call(this, path, ...args);
      } catch (error) {
        if (!restored && path === ${JSON.stringify(file)} && error.code === 'ENOENT') {
          fs.writeFileSync(path, '# Restored\\n');
          restored = true;
        }
        throw error;
      }
    };
    require('node:module').syncBuiltinESMExports();
  `,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--require",
      hook,
      fileURLToPath(new URL("./check-docs.mjs", import.meta.url)),
    ],
    {
      cwd: directory,
      env: { ...process.env, MOUNTAIN_AGENT_DOCUMENTATION_FILES: inventory },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Deleted inventory path.*tools\/deleted\.md/u);
  assert.equal(readFileSync(file, "utf8"), "# Restored\n");
});

test("the local API uses fixture Git even when the gate inventory is in the environment", (t) => {
  const directory = createRepository(t, {
    ...baseFiles(),
    "docs/guide.md": "# Guide\n\n[Missing](missing.md)\n",
  });
  const previous = process.env.MOUNTAIN_AGENT_DOCUMENTATION_FILES;
  process.env.MOUNTAIN_AGENT_DOCUMENTATION_FILES = join(
    directory,
    "missing-inventory",
  );
  try {
    assert.ok(listRepositoryFiles(directory).includes("docs/guide.md"));
    assert.ok(
      hasFinding(
        checkDocumentation(directory),
        "docs/guide.md",
        /does not resolve/u,
      ),
    );
  } finally {
    if (previous === undefined)
      delete process.env.MOUNTAIN_AGENT_DOCUMENTATION_FILES;
    else process.env.MOUNTAIN_AGENT_DOCUMENTATION_FILES = previous;
  }
});

test("rejects missing, malformed and unsafe explicit inventories without Git fallback", (t) => {
  const directory = createRepository(t, baseFiles());
  const inventory = join(directory, "inventory");
  for (const [label, content] of [
    ["empty", ""],
    ["truncated", "Pdocs/README.md"],
    ["empty entry", "Pdocs/README.md\0\0"],
    ["unknown prefix", "Xdocs/README.md\0"],
    ["missing path", "P\0"],
    ["conflicting records", "Pdocs/README.md\0Ddocs/README.md\0"],
    ["absolute", "P/etc/passwd\0"],
    ["traversal", "Pdocs/../README.md\0"],
    ["deleted parent traversal", "D../README.md\0"],
    ["invalid UTF-8", Buffer.from([0xff, 0])],
  ]) {
    writeFileSync(inventory, content);
    const result = runCli(directory, inventory);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, /inventory|documentation files/iu, label);
  }
  rmSync(inventory);
  assert.notEqual(runCli(directory, inventory).status, 0, "missing");
  assert.notEqual(runCli(directory, "").status, 0, "empty environment value");
});

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
