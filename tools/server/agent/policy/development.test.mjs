import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchNameForChange,
  buildInstructionPrompt,
  changeTypes,
  parseChangeSummary,
  parseRequestKind,
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
