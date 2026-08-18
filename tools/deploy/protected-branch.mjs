// Protected-branch head check (phase 5, task 5.4).
//
// A delayed workflow run must not activate an older commit after a newer one
// has been merged, and it must not become an implicit rollback. Only the
// protected rollback workflow may activate a previous eligible release.

import { commitPattern } from "../server/release/validate.mjs";

export class StaleCommitError extends Error {}

export function assertCurrentHead(candidateCommit, protectedHead) {
  if (candidateCommit !== protectedHead) {
    throw new StaleCommitError(
      `Refusing to deploy stale commit ${candidateCommit}; protected main is ${protectedHead}.`,
    );
  }
}

export async function resolveProtectedHead({
  repository,
  apiUrl,
  token,
  fetchImpl = fetch,
}) {
  if (repository === undefined || repository === "") {
    throw new Error(
      "GITHUB_REPOSITORY is required to resolve the protected head.",
    );
  }
  const baseUrl = (apiUrl ?? "https://api.github.com").replace(/\/$/u, "");
  const url = `${baseUrl}/repos/${repository}/commits/main`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mountain-runners-deploy",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token !== undefined && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(
      `Cannot resolve the protected branch head (${response.status}).`,
    );
  }
  const body = await response.json();
  if (typeof body.sha !== "string" || !commitPattern.test(body.sha)) {
    throw new Error(
      "The protected branch head is not a 40-character hex SHA-1.",
    );
  }
  return body.sha;
}
