import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSessionKey,
  sessionIdentifier,
} from "../../src/sessions/identity.mjs";

test("derives the chat and the forum topic from the session key", () => {
  assert.deepEqual(parseSessionKey("-1001234567890:7"), {
    chatIdentifier: -1001234567890,
    threadIdentifier: 7,
  });
});

test("builds a Pi session identifier without unsupported characters", () => {
  assert.equal(sessionIdentifier("-1001234567890:7"), "topic_n1001234567890_7");
  assert.match(sessionIdentifier("-1001234567890:7"), /^[A-Za-z0-9._-]+$/u);
});

test("rejects a session key without two numeric parts", () => {
  for (const sessionKey of ["-1001234567890", "topic:7", "-1:two", ":"]) {
    assert.throws(() => parseSessionKey(sessionKey), Error, sessionKey);
  }
});
