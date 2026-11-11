import assert from "node:assert/strict";
import { test } from "node:test";
import { editorialBrowserNames } from "./browser-profile.mjs";

test("the agent profile uses Chromium while ordinary checks cover every browser", () => {
  assert.deepEqual(editorialBrowserNames("chromium"), ["chromium"]);
  assert.deepEqual(editorialBrowserNames(undefined), [
    "chromium",
    "firefox",
    "webkit",
  ]);
  assert.throws(() => editorialBrowserNames("unexpected"));
});
