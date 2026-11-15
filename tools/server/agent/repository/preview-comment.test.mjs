import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedPreviewOrigin } from "./preview-comment.mjs";

const commit = "a".repeat(40);
const origin = "https://pr-42.preview.mountainrunners.cat";
const requestedAt = "2026-11-14T10:00:00Z";

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
    requestedAt,
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

test("rejects a comment not updated after the request", () => {
  assert.equal(
    confirmed(publisherComment({ updated_at: "2026-11-14T09:59:59Z" })),
    null,
  );
  assert.equal(confirmed(publisherComment({ updated_at: undefined })), null);
});

test("rejects a comment updated in the same second as the request", () => {
  assert.equal(confirmed(publisherComment({ updated_at: requestedAt })), null);
});

test("accepts a comment updated one second after the request", () => {
  assert.equal(
    confirmed(publisherComment({ updated_at: "2026-11-14T10:00:01Z" })),
    origin,
  );
});

test("finds the valid comment among unrelated ones", () => {
  assert.equal(
    confirmedPreviewOrigin({
      comments: [
        { user: { login: "person" }, body: "/preview" },
        publisherComment({ updated_at: "2026-11-14T09:00:00Z" }),
        publisherComment(),
      ],
      pullRequestNumber: 42,
      commit,
      requestedAt,
    }),
    origin,
  );
});
