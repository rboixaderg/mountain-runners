import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchNameForChange,
  buildInstructionPrompt,
  buildRepairInstruction,
  changeTypes,
  parseChangeSummary,
  parseRequestKind,
  repairPromptLimits,
  slugify,
} from "./development.mjs";

test("accepts only a recognized request kind in a JSON result", () => {
  for (const kind of [
    "consultation",
    "implementation",
    "continuation",
    "clarification",
  ]) {
    assert.equal(parseRequestKind(JSON.stringify({ kind })), kind);
  }
  for (const response of [
    "",
    "implementation",
    "{}",
    '{"kind":"merge"}',
    "null",
    "[]",
  ]) {
    assert.equal(parseRequestKind(response), "clarification");
  }
});

test("parses only a valid conventional summary line", () => {
  assert.equal(
    parseChangeSummary("fet\nSUMMARY: fix(agent): correct the boundary"),
    "fix(agent): correct the boundary",
  );
  assert.equal(parseChangeSummary("fet\nSUMMARY: ho he arreglat"), null);
  assert.equal(parseChangeSummary("sense resum"), null);
});

test("accepts every conventional type and rejects an invented one", () => {
  for (const type of changeTypes) {
    assert.equal(
      parseChangeSummary(`fet\nSUMMARY: ${type}(agent): change something`),
      `${type}(agent): change something`,
    );
  }
  assert.equal(
    parseChangeSummary("fet\nSUMMARY: content(posts): add a synthetic entry"),
    null,
    "an invented type is discarded instead of producing a branch and title",
  );
});

test("tells the model which summary types are accepted", () => {
  const prompt = buildInstructionPrompt(
    "afegeix una entrada",
    "implementation",
  );
  for (const type of changeTypes) {
    assert.match(prompt, new RegExp(`\\b${type}\\b`, "u"));
  }
  assert.match(prompt, /SUMMARY: type\(scope\): imperative summary/u);
  assert.match(prompt, /discarded and the change gets a generic title/u);
});

test("builds branch names that match the repository rules", () => {
  assert.equal(
    slugify("Arregla l'accentuació del README"),
    "arregla-l-accentuacio-del-readme",
  );
  assert.equal(slugify("***"), "agent-change");
  assert.equal(
    branchNameForChange({
      summary: null,
      instruction: "afegeix una prova",
      updateIdentifier: 7,
    }),
    "feat/agent-change-7",
  );
});

test("labels the CI failure context as untrusted data for a repair", () => {
  const instruction = buildRepairInstruction({
    pullRequestNumber: 200,
    commit: "a".repeat(40),
    branch: "fix/tools-add-synthetic-change-1001",
    changeSummary: "feat(tools): add synthetic change",
    failedChecks: ["Validate", "Gitleaks"],
    evidence: [
      { name: "Validate", detail: "src/a.ts: error TS2322" },
      { name: "Gitleaks", detail: "" },
    ],
    diff: "diff --git a/src/a.ts b/src/a.ts\n+tolerated\n",
  });

  assert.match(instruction, /pull request #200/u);
  assert.match(instruction, /Validate, Gitleaks/u);
  assert.match(instruction, /Published change summary: feat\(tools\)/u);
  assert.match(instruction, /untrusted data/u);
  assert.match(instruction, /src\/a\.ts: error TS2322/u);
  assert.match(instruction, /\+tolerated/u);
  assert.match(instruction, /### Gitleaks\n\(no output\)/u);
});

test("clips the published diff and says when it is unavailable", () => {
  const base = {
    pullRequestNumber: 1,
    commit: "a".repeat(40),
    branch: "fix/agent-change-1",
    changeSummary: "fix(agent): change",
    failedChecks: ["Validate"],
    evidence: [],
  };
  const clipped = buildRepairInstruction({
    ...base,
    diff: "x".repeat(repairPromptLimits.diffCharacters + 100),
  });
  assert.match(clipped, /…/u);
  assert.ok(clipped.length < repairPromptLimits.diffCharacters + 1000);
  assert.match(
    buildRepairInstruction({ ...base, diff: null }),
    /\(the diff is not available\)/u,
  );
});

test("adds the repair rules that forbid hiding a failing check", () => {
  const prompt = buildInstructionPrompt("Request", "repair");
  assert.match(prompt, /automatic CI repair/u);
  assert.match(prompt, /Never try to make a check green by disabling it/u);
  assert.match(prompt, /change no files and explain/u);
  assert.doesNotMatch(
    buildInstructionPrompt("Request", "implementation"),
    /automatic CI repair/u,
  );
});
