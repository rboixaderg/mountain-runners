// The one comment per pull request the trusted publisher keeps in place: it
// names the published preview and, once the preview is retired, says so. Only a
// comment authored by this workflow's GitHub Actions bot counts, and no
// pull-request-controlled text ever enters it.

export const previewCommentMarker = "<!-- mountain-runners-preview -->";

// It keeps the marker, so the comment stays the one to edit, and it no longer
// names an origin or a commit, so the private agent does not read it as a
// confirmation.
const retiredPreviewBody = `${previewCommentMarker}\nPreview retirada.`;

export async function findPreviewComment({
  base,
  headers,
  pullNumber,
  fetchImpl,
}) {
  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(
      `${base}/issues/${pullNumber}/comments?per_page=100&page=${page}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(
        `Cannot list preview comments (HTTP ${response.status}).`,
      );
    }
    const comments = await response.json();
    const found = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.body?.includes(previewCommentMarker),
    );
    if (found || comments.length < 100) return found;
  }
}

/** A pull request that never had a preview comment has nothing to edit. */
export async function markPreviewRetired({
  base,
  headers,
  pullNumber,
  fetchImpl = fetch,
}) {
  const existing = await findPreviewComment({
    base,
    headers,
    pullNumber,
    fetchImpl,
  });
  if (existing === undefined) return;
  const response = await fetchImpl(`${base}/issues/comments/${existing.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body: retiredPreviewBody }),
  });
  if (!response.ok) {
    throw new Error(`Cannot write preview comment (HTTP ${response.status}).`);
  }
}
