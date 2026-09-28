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
import { verifyPreviewSite } from "./smoke.mjs";
import { signPreviewAuthorization } from "../server/preview/authorization-proof.mjs";
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
  if (pullRequest.labels?.some((label) => label.name === "preview-revoked")) {
    throw new Error(`Pull request ${pullNumber} has a revoked preview.`);
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

const previewCommentMarker = "<!-- mountain-runners-preview -->";

// Only update a comment authored by this workflow's GitHub Actions bot.
// Neither the PR title nor any other PR-controlled text enters the comment.
export async function commentOnPublishedPreview({
  repository,
  apiUrl,
  token,
  pullNumber,
  headSha,
  origin,
  fetchImpl = fetch,
}) {
  const base = `${apiBaseUrl(apiUrl)}/repos/${repository}`;
  const body = `${previewCommentMarker}\nPreview publicada: ${origin}\nCommit: \`${headSha}\`.`;
  let existingComment;
  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(
      `${base}/issues/${pullNumber}/comments?per_page=100&page=${page}`,
      { headers: apiHeaders(token) },
    );
    if (!response.ok) {
      throw new Error(
        `Cannot list preview comments (HTTP ${response.status}).`,
      );
    }
    const comments = await response.json();
    existingComment = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.body?.includes(previewCommentMarker),
    );
    if (existingComment || comments.length < 100) break;
  }

  const response = await fetchImpl(
    existingComment
      ? `${base}/issues/comments/${existingComment.id}`
      : `${base}/issues/${pullNumber}/comments`,
    {
      method: existingComment ? "PATCH" : "POST",
      headers: { ...apiHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  if (!response.ok) {
    throw new Error(`Cannot write preview comment (HTTP ${response.status}).`);
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
  authorizedBy,
  authorizationPrivateKey,
  transport,
  verifyPreview = verifyPreviewSite,
  onPublished,
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

  const authorization = {
    pullRequestNumber: pullNumber,
    commit: pullRequest.headSha,
    actor: authorizedBy,
    issuedAt: Date.now(),
  };
  await transport.run(
    `mountain-preview authorize ${pullNumber} ${pullRequest.headSha} ${authorizedBy}`,
    JSON.stringify({
      issuedAt: authorization.issuedAt,
      signature: signPreviewAuthorization(
        authorization,
        authorizationPrivateKey,
      ),
    }),
  );
  const previousList = await transport.run(
    `mountain-preview list ${pullNumber}`,
  );
  const previousCommit = /^active\s+([0-9a-f]{40})/mu.exec(previousList)?.[1];
  await transport.run(`mountain-preview site-enable ${pullNumber}`);
  let activated = false;
  try {
    const beforeActivation = await resolvePullRequestState();
    assertPullRequestUnchanged(pullRequest, beforeActivation);
    await revalidateCommentAuthorization?.();
    await revalidateDispatchAuthorization?.();
    await activatePreviewRelease(transport, pullNumber, pullRequest.headSha);
    activated = true;
    const health = await transport.run(`mountain-preview health ${pullNumber}`);
    if (!health.startsWith("Health: OK")) throw new Error(health);
    await verifyPreview(previewOrigin(pullNumber));
  } catch (error) {
    if (activated && previousCommit && previousCommit !== pullRequest.headSha) {
      await transport.run(
        `mountain-preview activate ${pullNumber} ${previousCommit}`,
      );
    } else if (!previousCommit) {
      await transport.run(`mountain-preview retire ${pullNumber}`);
      await transport.run(`mountain-preview site-disable ${pullNumber}`);
    }
    throw error;
  }
  try {
    await transport.run(`mountain-preview prune ${pullNumber}`);
  } catch (error) {
    console.warn(
      `Preview ${pullNumber} is published but prune failed: ${error.message}`,
    );
  }
  if (onPublished) {
    const current = await resolvePullRequestState();
    assertPullRequestUnchanged(pullRequest, current);
    await revalidateCommentAuthorization?.();
    await revalidateDispatchAuthorization?.();
    await onPublished({
      origin: previewOrigin(pullNumber),
      headSha: pullRequest.headSha,
    });
  }
  return `Published preview ${previewOrigin(pullNumber)} at commit ${pullRequest.headSha}.`;
}
