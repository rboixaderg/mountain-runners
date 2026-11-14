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
  const origin = `https://pr-${pullRequestNumber}\\.preview\\.mountainrunners\\.cat`;
  return new RegExp(
    `^${marker}\\nPreview publicada: (${origin})\\nCommit: \`(${fullCommitPattern})\`\\.$`,
    "u",
  );
}

/**
 * The origin the publisher confirmed for this pull request and commit, or null.
 * The comment must have been written or updated after the request was posted,
 * so a confirmation of an earlier publication of the same commit never counts.
 */
export function confirmedPreviewOrigin({
  comments,
  pullRequestNumber,
  commit,
  requestedAt,
}) {
  const pattern = bodyPattern(pullRequestNumber);
  for (const comment of comments) {
    if (comment.user?.login !== publisherLogin) continue;
    const parsed = pattern.exec(comment.body ?? "");
    if (parsed === null || parsed[2] !== commit) continue;
    // GitHub timestamps have second granularity: a publication within the same
    // second as the request cannot be told apart from it, so it is accepted.
    if (Date.parse(comment.updated_at) >= Date.parse(requestedAt)) {
      return parsed[1];
    }
  }
  return null;
}
