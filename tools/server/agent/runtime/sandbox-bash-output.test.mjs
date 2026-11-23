import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatSandboxBashResult,
  maximumToolOutputBytes,
} from "./sandbox-bash-output.mjs";

test("keeps ordinary sandbox_bash output unchanged when within the tool cap", () => {
  const formatted = formatSandboxBashResult({
    exitCode: 0,
    stdout: "line 1\nline 2",
    stderr: "warn",
    timedOut: false,
    outputLimitExceeded: false,
  });

  assert.equal(formatted.text, "exit code: 0\nline 1\nline 2\nwarn");
  assert.deepEqual(formatted.details, {
    exitCode: 0,
    timedOut: false,
    outputLimitExceeded: false,
    truncated: false,
  });
});

test("truncates oversized tool output preserving head, tail and valid UTF-8", () => {
  const headMarker = "HEAD-àèéíòóúç-START\n";
  const tailMarker = "\nTAIL-àèéíòóúç-END";
  const filler = "ç".repeat(maximumToolOutputBytes);
  const formatted = formatSandboxBashResult({
    exitCode: 0,
    stdout: `${headMarker}${filler}`,
    stderr: `${filler}${tailMarker}`,
    timedOut: false,
    outputLimitExceeded: false,
  });

  assert.equal(formatted.details.truncated, true);
  assert.match(formatted.text, /exceeded 32 KiB and was truncated/u);
  assert.match(formatted.text, /HEAD-àèéíòóúç-START/u);
  assert.match(formatted.text, /\[\.\.\. output truncated \.\.\.\]/u);
  assert.match(formatted.text, /TAIL-àèéíòóúç-END/u);
  assert.equal(formatted.text.includes("\uFFFD"), false);
  assert.ok(
    Buffer.byteLength(formatted.text, "utf8") < maximumToolOutputBytes + 512,
  );
});

test("never splits 4-byte UTF-8 surrogate pairs at the head or tail cut boundary", () => {
  const formatted = formatSandboxBashResult(
    {
      exitCode: 0,
      stdout: "a😀😀😀😀",
      stderr: "😀😀😀😀z",
      timedOut: false,
      outputLimitExceeded: false,
    },
    14,
  );

  assert.equal(formatted.details.truncated, true);
  assert.equal(formatted.text.includes("\uFFFD"), false);
  assert.equal(formatted.text.isWellFormed(), true);
  assert.match(
    formatted.text,
    /a😀\n\[\.\.\. output truncated \.\.\.\]\n😀z$/u,
  );
});

test("keeps timeout and sandbox output limit notices alongside truncation", () => {
  const formatted = formatSandboxBashResult(
    {
      exitCode: null,
      stdout: "a".repeat(200),
      stderr: "b".repeat(200),
      timedOut: true,
      outputLimitExceeded: true,
    },
    64,
  );

  assert.equal(formatted.details.timedOut, true);
  assert.equal(formatted.details.outputLimitExceeded, true);
  assert.equal(formatted.details.truncated, true);
  assert.match(formatted.text, /reached its execution deadline/u);
  assert.match(formatted.text, /exceeded the output limit and was stopped/u);
  assert.match(formatted.text, /exceeded 32 KiB and was truncated/u);
});
