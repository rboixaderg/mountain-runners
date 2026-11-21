import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedPreviewOrigin } from "./preview-comment.mjs";

const commit = "a".repeat(40);
const origin = "https://pr-42.preview.mountainrunners.cat";

function publisherComment(overrides = {}) {
  return {
    user: { login: "github-actions[bot]" },
    body: `<!-- mountain-runners-preview -->\nPreview publicada: ${origin}\nCommit: \`${commit}\`.`,
    updated_at: "2026-11-14T10:05:00Z",
    ...overrides,
  };
}

function confirmed(comment, overrides = {}) {
  return confirmedPreviewOrigin({
    comments: [comment],
    pullRequestNumber: 42,
    commit,
    ...overrides,
  });
}

test("accepts the publisher comment for this pull request and commit", () => {
  assert.equal(confirmed(publisherComment()), origin);
});

test("rejects a comment the publisher did not write", () => {
  assert.equal(
    confirmed(publisherComment({ user: { login: "someone" } })),
    null,
  );
  assert.equal(confirmed(publisherComment({ user: undefined })), null);
});

test("rejects a forged, foreign or decorated origin", () => {
  for (const forged of [
    "https://pr-43.preview.mountainrunners.cat",
    "https://pr-42.preview.mountainrunners.cat.evil.example",
    "https://evil.example/pr-42.preview.mountainrunners.cat",
    "http://pr-42.preview.mountainrunners.cat",
    "https://pr-42.preview.mountainrunners.cat/",
    "https://pr-421.preview.mountainrunners.cat",
  ]) {
    assert.equal(
      confirmed(
        publisherComment({
          body: `<!-- mountain-runners-preview -->\nPreview publicada: ${forged}\nCommit: \`${commit}\`.`,
        }),
      ),
      null,
      forged,
    );
  }
});

test("rejects another commit, a missing marker and extra text", () => {
  const other = "b".repeat(40);
  assert.equal(
    confirmed(
      publisherComment({
        body: `<!-- mountain-runners-preview -->\nPreview publicada: ${origin}\nCommit: \`${other}\`.`,
      }),
    ),
    null,
  );
  assert.equal(
    confirmed(
      publisherComment({
        body: `Preview publicada: ${origin}\nCommit: \`${commit}\`.`,
      }),
    ),
    null,
  );
  assert.equal(
    confirmed(
      publisherComment({
        body: `${publisherComment().body}\nhttps://evil.example`,
      }),
    ),
    null,
  );
});

test("accepts a comment written before the request began", () => {
  // The label starts the build when the head is pushed, so the publisher can
  // confirm the commit before anyone asks for the preview.
  assert.equal(
    confirmed(publisherComment({ updated_at: "2020-01-01T00:00:00Z" })),
    origin,
  );
});

test("finds the valid comment among unrelated ones", () => {
  assert.equal(
    confirmedPreviewOrigin({
      comments: [
        { user: { login: "person" }, body: "/preview" },
        publisherComment({ user: { login: "someone" } }),
        publisherComment(),
      ],
      pullRequestNumber: 42,
      commit,
    }),
    origin,
  );
});

test("accepts a publisher comment separated by CRLF", () => {
  const crlf = publisherComment().body.replaceAll("\n", "\r\n");
  assert.equal(confirmed(publisherComment({ body: crlf })), origin);
});

test("rejects a pull request number that is not a positive integer", () => {
  for (const invalid of [0, -1, 1.5, "42", undefined]) {
    assert.throws(
      () =>
        confirmedPreviewOrigin({
          comments: [publisherComment()],
          pullRequestNumber: invalid,
          commit,
        }),
      /positive pull request number/u,
      String(invalid),
    );
  }
});
