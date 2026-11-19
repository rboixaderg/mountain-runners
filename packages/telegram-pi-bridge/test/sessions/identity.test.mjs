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

test("accepts only decimal integer tokens", () => {
  for (const sessionKey of ["-1001234567890:7", "0:0", "-1:-1"]) {
    assert.deepEqual(parseSessionKey(sessionKey), {
      chatIdentifier: Number(sessionKey.slice(0, sessionKey.lastIndexOf(":"))),
      threadIdentifier: Number(
        sessionKey.slice(sessionKey.lastIndexOf(":") + 1),
      ),
    });
  }
});

test("rejects whitespace, hexadecimal and exponential tokens", () => {
  for (const sessionKey of [
    " -1001234567890:7",
    "-1001234567890: 7",
    "-1001234567890:7 ",
    "0x10:7",
    "1e3:7",
    "-0x1:7",
    "+5:6",
    "1.0:7",
    "1_000:7",
  ]) {
    assert.throws(() => parseSessionKey(sessionKey), Error, sessionKey);
  }
});
