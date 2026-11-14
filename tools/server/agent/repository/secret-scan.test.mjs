import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./secret-scan.mjs";

test("removes every known credential from text that leaves the component", () => {
  assert.equal(
    redactSecrets("token ghp_one and ghp_two", ["ghp_one", "ghp_two"]),
    "token *** and ***",
  );
  assert.equal(redactSecrets("plain text", []), "plain text");
  assert.equal(redactSecrets("plain text", ["", undefined]), "plain text");
});
