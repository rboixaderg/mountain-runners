// Recognise the confirmation of the trusted preview publisher (phase 6).
//
// The agent never builds or guesses a preview URL: it accepts only the comment
// the publisher wrote and updates in place, and only when every part of it
// matches the request. Anything else, including the comment of a person who
// copies the marker, is ignored.

const publisherLogin = "github-actions[bot]";
const marker = "<!-- mountain-runners-preview -->";
const fullCommitPattern = "[a-f0-9]{40}";

function bodyPattern(pullRequestNumber) {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("A positive pull request number is required.");
  }
  const origin = `https://pr-${pullRequestNumber}\\.preview\\.mountainrunners\\.cat`;
  // GitHub normalises a comment body to LF, but a body read through another
  // client can still carry CRLF: both separate the same three lines.
  return new RegExp(
    `^${marker}\\r?\\nPreview publicada: (${origin})\\r?\\nCommit: \`(${fullCommitPattern})\`\\.$`,
    "u",
  );
}

/**
 * The origin the publisher confirmed for this pull request and commit, or null.
 * The commit binds the comment to the head the request pinned. The label starts
 * the publication when the head is pushed, so a comment written before the
 * request began still confirms it.
 */
export function confirmedPreviewOrigin({
  comments,
  pullRequestNumber,
  commit,
}) {
  const pattern = bodyPattern(pullRequestNumber);
  for (const comment of comments) {
    if (comment.user?.login !== publisherLogin) continue;
    const parsed = pattern.exec(comment.body ?? "");
    if (parsed === null || parsed[2] !== commit) continue;
    return parsed[1];
  }
  return null;
}
