// Trusted preview publisher orchestration (T6.3).
//
// Runs from `main` on a GitHub-hosted runner behind the `previews`
// environment. It never checks out the pull request and never executes PR
// code: it verifies the pull request state against trusted platform
// metadata, validates the intermediate artifact built in the same workflow
// run (manifest, size, file count, digests and paths), and only then writes
// to the namespace assigned to the PR. The pull request state is revalidated
// immediately before activation, so a closed, unauthorized or moved pull
// request can never be activated.

import { loadVerifiedArtifact } from "../deploy/artifact.mjs";
import { RemoteCommandError } from "../deploy/ssh.mjs";
import {
  assertPreviewManifestConsistency,
  previewOrigin,
} from "../server/preview/config.mjs";

function apiHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mountain-runners-preview-publisher",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token !== undefined && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function apiBaseUrl(apiUrl) {
  return (apiUrl ?? "https://api.github.com").replace(/\/$/u, "");
}

async function fetchRepositoryJson({
  repository,
  apiUrl,
  token,
  path,
  fetchImpl,
  failureMessage,
}) {
  if (repository === undefined || repository === "") {
    throw new Error("GITHUB_REPOSITORY is required to reach the GitHub API.");
  }
  const response = await fetchImpl(
    `${apiBaseUrl(apiUrl)}/repos/${repository}/${path}`,
    {
      headers: apiHeaders(token),
    },
  );
  if (!response.ok) {
    throw new Error(`${failureMessage} (${response.status}).`);
  }
  return response.json();
}

// The comment that requests a publish must come from a repository
// collaborator: this verified check is the explicit maintainer
// authorization for the publish (the environment only scopes the secrets).
export async function assertCommentAuthorized({
  repository,
  apiUrl,
  token,
  commentAuthor,
  fetchImpl = fetch,
}) {
  if (repository === undefined || repository === "") {
    throw new Error("GITHUB_REPOSITORY is required to reach the GitHub API.");
  }
  if (commentAuthor === undefined || commentAuthor === "") {
    throw new Error("The comment author is required.");
  }
  const response = await fetchImpl(
    `${apiBaseUrl(apiUrl)}/repos/${repository}/collaborators/${commentAuthor}`,
    { headers: apiHeaders(token) },
  );
  if (response.status !== 204) {
    throw new Error(
      `The comment author ${commentAuthor} is not a repository collaborator; previews require explicit maintainer authorization.`,
    );
  }
}

// A workflow_dispatch run is initially authorized by GitHub's write-access
// requirement. Recheck that the dispatch actor still has write access before
// activation; the collaborator endpoint's legacy permission maps maintain to
// write, while read and none are insufficient.
export async function assertDispatchActorAuthorized({
  repository,
  apiUrl,
  token,
  actor,
  fetchImpl = fetch,
}) {
  if (repository === undefined || repository === "") {
    throw new Error("GITHUB_REPOSITORY is required to reach the GitHub API.");
  }
  if (actor === undefined || actor === "") {
    throw new Error(
      "GITHUB_ACTOR is required to revalidate workflow dispatch authorization.",
    );
  }
  const response = await fetchImpl(
    `${apiBaseUrl(apiUrl)}/repos/${repository}/collaborators/${actor}/permission`,
    { headers: apiHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(
      `The workflow dispatch actor does not have current repository write permission (HTTP ${response.status}).`,
    );
  }
  const { permission } = await response.json();
  if (permission !== "write" && permission !== "admin") {
    throw new Error(
      "The workflow dispatch actor no longer has repository write permission.",
    );
  }
}

// Reads the pull request state from the platform: only an open pull request
// from this repository (own branches) can be published; returns the head
// SHA the artifact must match.
export async function resolvePullRequestState({
  repository,
  apiUrl,
  token,
  pullNumber,
  fetchImpl = fetch,
}) {
  const pullRequest = await fetchRepositoryJson({
    repository,
    apiUrl,
    token,
    fetchImpl,
    path: `pulls/${pullNumber}`,
    failureMessage: `Cannot read pull request ${pullNumber}`,
  });
  if (pullRequest.state !== "open") {
    throw new Error(
      `Pull request ${pullNumber} is ${pullRequest.state}; only an open pull request can be published.`,
    );
  }
  if (pullRequest.head?.repo?.full_name !== repository) {
    throw new Error(
      "The pull request head repository is not this repository; forks have no previews.",
    );
  }
  return { headSha: pullRequest.head.sha };
}

function assertPullRequestUnchanged(previous, current) {
  if (current.headSha !== previous.headSha) {
    throw new Error(
      `Refusing to activate a moved pull request: the head changed from ${previous.headSha} to ${current.headSha}.`,
    );
  }
}

async function transferAndVerify(
  transport,
  pullNumber,
  fileName,
  contents,
  expectedSha256,
) {
  const received = await transport.receive(fileName, contents, pullNumber);
  if (received.sha256 !== expectedSha256) {
    throw new Error(
      `Digest mismatch after transferring ${fileName}: got ${received.sha256}, expected ${expectedSha256}.`,
    );
  }
}

async function installPreviewRelease(
  transport,
  pullNumber,
  archiveFileName,
  headSha,
) {
  try {
    return await transport.run(
      `mountain-preview install ${pullNumber} ${archiveFileName} manifest.json`,
    );
  } catch (error) {
    if (
      error instanceof RemoteCommandError &&
      error.message.includes(`Release ${headSha} is already registered.`)
    ) {
      return error.message;
    }
    throw error;
  }
}

async function activatePreviewRelease(transport, pullNumber, headSha) {
  try {
    return await transport.run(
      `mountain-preview activate ${pullNumber} ${headSha}`,
    );
  } catch (error) {
    if (
      error instanceof RemoteCommandError &&
      error.message.includes(`Release ${headSha} is not eligible (active)`)
    ) {
      return { changedPointer: false, message: error.message };
    }
    throw error;
  }
}

// Publishes the verified intermediate artifact to the namespace assigned to
// the pull request: verifies the pull request state against trusted platform
// metadata, validates the artifact (manifest, size, file count, digests and
// paths), transfers and installs it, revalidates the pull request
// immediately before activation, activates it and checks the namespace
// health.
export async function publishPreview({
  artifactDirectory,
  pullNumber,
  resolvePullRequestState,
  revalidateCommentAuthorization,
  revalidateDispatchAuthorization,
  transport,
}) {
  const pullRequest = await resolvePullRequestState();
  const artifact = await loadVerifiedArtifact(artifactDirectory, {
    expectedCommit: pullRequest.headSha,
    expectedOrigin: previewOrigin(pullNumber),
  });
  assertPreviewManifestConsistency(artifact.manifest, pullNumber);

  await transferAndVerify(
    transport,
    pullNumber,
    artifact.archiveFileName,
    artifact.archiveBuffer,
    artifact.archiveSha256,
  );
  await transferAndVerify(
    transport,
    pullNumber,
    "manifest.json",
    artifact.manifestBuffer,
    artifact.manifestSha256,
  );

  await installPreviewRelease(
    transport,
    pullNumber,
    artifact.archiveFileName,
    pullRequest.headSha,
  );

  const revalidated = await resolvePullRequestState();
  assertPullRequestUnchanged(pullRequest, revalidated);
  await revalidateCommentAuthorization?.();
  await revalidateDispatchAuthorization?.();

  await activatePreviewRelease(transport, pullNumber, pullRequest.headSha);
  const health = await transport.run(`mountain-preview health ${pullNumber}`);
  if (!health.startsWith("Health: OK")) {
    throw new Error(health);
  }

  return `Published preview ${previewOrigin(pullNumber)} at commit ${pullRequest.headSha}.`;
}
