// Trusted preview publisher orchestration (T6.3).
//
// Runs from `main` on a GitHub-hosted runner behind the `previews`
// environment. It never checks out the pull request and never executes PR
// code: it verifies the source workflow run against trusted platform
// metadata (repository, workflow path, run, event, PR binding, head SHA and
// conclusion), validates the intermediate artifact with the same validators
// as production, and only then writes to the namespace assigned to the PR.
// The pull request state is revalidated immediately before activation, so a
// closed, unauthorized or moved pull request can never be activated.

import { loadVerifiedArtifact } from "../deploy/artifact.mjs";
import { RemoteCommandError } from "../deploy/ssh.mjs";
import {
  assertPreviewManifestConsistency,
  previewOrigin,
} from "../server/preview/config.mjs";

const previewBuildWorkflowPath = ".github/workflows/preview-build.yml";

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
  const baseUrl = (apiUrl ?? "https://api.github.com").replace(/\/$/u, "");
  const response = await fetchImpl(`${baseUrl}/repos/${repository}/${path}`, {
    headers: apiHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`${failureMessage} (${response.status}).`);
  }
  return response.json();
}

// Verifies the source workflow run against trusted platform metadata: this
// repository, the preview build workflow, a pull_request event, a successful
// conclusion, a same-repository head (forks get no previews) and the
// platform binding between the run and the pull request. Nothing here is
// taken from the artifact.
export async function resolveSourceRun({
  repository,
  apiUrl,
  token,
  runId,
  pullNumber,
  fetchImpl = fetch,
}) {
  const run = await fetchRepositoryJson({
    repository,
    apiUrl,
    token,
    fetchImpl,
    path: `actions/runs/${runId}`,
    failureMessage: "Cannot read the source workflow run",
  });
  if (run.repository?.full_name !== repository) {
    throw new Error("The source run does not belong to this repository.");
  }
  if (run.path !== previewBuildWorkflowPath) {
    throw new Error(
      `The source run workflow must be ${previewBuildWorkflowPath}, got ${run.path}.`,
    );
  }
  if (run.event !== "pull_request") {
    throw new Error(
      `The source run event must be pull_request, got ${run.event}.`,
    );
  }
  if (run.conclusion !== "success") {
    throw new Error(
      `The source run conclusion must be success, got ${run.conclusion}.`,
    );
  }
  if (run.head_repository?.full_name !== repository) {
    throw new Error(
      "The source run head repository is not this repository; forks have no previews.",
    );
  }
  if (
    !run.pull_requests?.some(
      (associatedPullRequest) => associatedPullRequest.number === pullNumber,
    )
  ) {
    throw new Error(
      `The source run is not associated with pull request ${pullNumber}.`,
    );
  }
  return run;
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
  fileName,
  contents,
  expectedSha256,
) {
  const received = await transport.receive(fileName, contents);
  if (received.sha256 !== expectedSha256) {
    throw new Error(
      `Digest mismatch after transferring ${fileName}: got ${received.sha256}, expected ${expectedSha256}.`,
    );
  }
}

async function installPreviewRelease(transport, archiveFileName, headSha) {
  try {
    return await transport.run(
      `mountain-preview install ${archiveFileName} manifest.json`,
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
// the pull request: verifies the source run and the pull request state,
// validates the artifact (manifest, size, file count, digests and paths),
// transfers and installs it, revalidates the pull request immediately
// before activation, activates it and checks the namespace health.
export async function publishPreview({
  artifactDirectory,
  pullNumber,
  resolveSourceRun,
  resolvePullRequestState,
  transport,
}) {
  await resolveSourceRun();

  const pullRequest = await resolvePullRequestState();
  const artifact = await loadVerifiedArtifact(artifactDirectory, {
    expectedCommit: pullRequest.headSha,
    expectedOrigin: previewOrigin(pullNumber),
  });
  assertPreviewManifestConsistency(artifact.manifest, pullNumber);

  await transferAndVerify(
    transport,
    artifact.archiveFileName,
    artifact.archiveBuffer,
    artifact.archiveSha256,
  );
  await transferAndVerify(
    transport,
    "manifest.json",
    artifact.manifestBuffer,
    artifact.manifestSha256,
  );

  await installPreviewRelease(
    transport,
    artifact.archiveFileName,
    pullRequest.headSha,
  );

  const revalidated = await resolvePullRequestState();
  assertPullRequestUnchanged(pullRequest, revalidated);

  await activatePreviewRelease(transport, pullNumber, pullRequest.headSha);
  const health = await transport.run(`mountain-preview health ${pullNumber}`);
  if (!health.startsWith("Health: OK")) {
    throw new Error(health);
  }

  return `Published preview ${previewOrigin(pullNumber)} at commit ${pullRequest.headSha}.`;
}
