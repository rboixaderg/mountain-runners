import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const sourceDirectory = join(repositoryRoot, ".agents", "skills");
const claudeCodeDirectory = join(repositoryRoot, ".claude", "skills");

function skillNames(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(directory, name, "SKILL.md")))
    .sort();
}

test("Claude Code exposes exactly the portable skills", () => {
  assert.deepEqual(
    readdirSync(claudeCodeDirectory).sort(),
    skillNames(sourceDirectory),
    "every directory in .agents/skills/ needs a matching entry in .claude/skills/",
  );
});

test("each Claude Code skill entry links to the single source", () => {
  for (const name of skillNames(sourceDirectory)) {
    const entryPath = join(claudeCodeDirectory, name);
    assert.ok(
      lstatSync(entryPath).isSymbolicLink(),
      `.claude/skills/${name} must be a symbolic link, not a copy`,
    );
    assert.equal(readlinkSync(entryPath), `../../.agents/skills/${name}`);
    assert.ok(
      existsSync(join(entryPath, "SKILL.md")),
      `.claude/skills/${name} must resolve to a directory that contains SKILL.md`,
    );
  }
});
