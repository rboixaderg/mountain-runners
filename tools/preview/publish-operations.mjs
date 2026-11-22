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
  findPreviewComment,
  markPreviewRetired,
  previewCommentMarker,
} from "./preview-comment.mjs";
import { retirePreviewOf } from "./reconcile.mjs";
import { verifyPreviewSite } from "./smoke.mjs";
import { signPreviewAuthorization } from "../server/preview/authorization-proof.mjs";
import {
  assertPreviewManifestConsistency,
  previewOrigin,
} from "../server/preview/config.mjs";

const confirmedAuthorizationRejections = [
  "Invalid preview authorization proof.",
  "Invalid preview authorization signature.",
  "Preview authorization requires the unprivileged preview UID.",
];

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

class IneligiblePullRequestError extends Error {}
export class MissingPreviewLabelError extends IneligiblePullRequestError {}

export function previewActorOf({ eventName, event, workflowActor }) {
  if (eventName === "workflow_dispatch") return workflowActor;
  if (eventName === "pull_request_target") return event.sender?.login;
  throw new Error(`Unsupported preview event: ${eventName}.`);
}

// A workflow_dispatch run or a label request is initially authorized by the
// actor's repository access. Recheck that the actor still has write access
// before activation; the collaborator endpoint's legacy permission maps
// maintain to write, while read and none are insufficient.
export async function assertActorWritePermission({
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
    throw new Error("The requesting actor is required to check write access.");
  }
  const response = await fetchImpl(
    `${apiBaseUrl(apiUrl)}/repos/${repository}/collaborators/${actor}/permission`,
    { headers: apiHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(
      `The actor ${actor} does not have current repository write permission (HTTP ${response.status}).`,
    );
  }
  const { permission } = await response.json();
  if (permission !== "write" && permission !== "admin") {
    throw new Error(
      `The actor ${actor} no longer has repository write permission.`,
    );
  }
}

// Reads the pull request state from the platform: only an open pull request
// from this repository with the preview label can be published. Returns the
// head SHA the artifact must match.
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
    throw new IneligiblePullRequestError(
      `Pull request ${pullNumber} is ${pullRequest.state}; only an open pull request can be published.`,
    );
  }
  if (pullRequest.labels?.some((label) => label.name === "preview-revoked")) {
    throw new IneligiblePullRequestError(
      `Pull request ${pullNumber} has a revoked preview.`,
    );
  }
  if (pullRequest.head?.repo?.full_name !== repository) {
    throw new IneligiblePullRequestError(
      "The pull request head repository is not this repository; forks have no previews.",
    );
  }
  if (!pullRequest.labels?.some((label) => label.name === "preview")) {
    throw new MissingPreviewLabelError(
      "The pull request no longer has the preview label.",
    );
  }
  return { headSha: pullRequest.head.sha };
}

// Only update a comment authored by this workflow's GitHub Actions bot.
// Neither the PR title nor any other PR-controlled text enters the comment.
export async function preparePublishedPreviewComment({
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
  const existingComment = await findPreviewComment({
    base,
    headers: apiHeaders(token),
    pullNumber,
    fetchImpl,
  });

  return async () => {
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
      throw new Error(
        `Cannot write preview comment (HTTP ${response.status}).`,
      );
    }
  };
}

// The comment of a retired preview stops naming it, so nobody reads it as ready.
export function markPublishedPreviewRetired({
  repository,
  apiUrl,
  token,
  pullNumber,
  fetchImpl = fetch,
}) {
  return markPreviewRetired({
    base: `${apiBaseUrl(apiUrl)}/repos/${repository}`,
    headers: apiHeaders(token),
    pullNumber,
    fetchImpl,
  });
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
  authorizedSha,
  resolvePullRequestState,
  revalidateActorAuthorization,
  authorizedBy,
  authorizationPrivateKey,
  transport,
  verifyPreview = verifyPreviewSite,
  prepareComment,
  markRetired,
}) {
  let previousCommit;
  let authorizationRecorded = false;
  let siteEnabled = false;
  let activated = false;

  async function revalidatePublication() {
    let actorError;
    try {
      await revalidateActorAuthorization();
    } catch (error) {
      actorError = error;
    }
    const { headSha } = await resolvePullRequestState().catch((error) => {
      if (error instanceof IneligiblePullRequestError) throw error;
      throw actorError ?? error;
    });
    if (actorError) throw actorError;
    if (headSha !== authorizedSha) {
      throw new Error(
        `Refusing to activate a moved pull request: live head ${headSha} does not match authorized SHA ${authorizedSha}.`,
      );
    }
  }

  const withdraw = () =>
    retirePreviewOf({ transport, pullNumber, markRetired });
  async function abortPublication(error) {
    if (
      error instanceof IneligiblePullRequestError ||
      (siteEnabled && !previousCommit) ||
      (authorizationRecorded && previousCommit === authorizedSha)
    ) {
      await withdraw();
    } else if (activated && previousCommit !== authorizedSha) {
      try {
        const rollback = await activatePreviewRelease(
          transport,
          pullNumber,
          previousCommit,
        );
        if (rollback.changedPointer === false) {
          const health = await transport.run(
            `mountain-preview health ${pullNumber}`,
          );
          if (!health.startsWith("Health: OK")) throw new Error(health);
        }
      } catch (rollbackError) {
        const errors = [error, rollbackError];
        let message = `${error.message} Rollback failed: ${rollbackError.message}`;
        try {
          await withdraw();
        } catch (withdrawalError) {
          errors.push(withdrawalError);
          message += ` Withdrawal failed: ${withdrawalError.message}`;
        }
        throw new AggregateError(errors, message, { cause: rollbackError });
      }
    }
    throw error;
  }

  try {
    await revalidatePublication();
    const artifact = await loadVerifiedArtifact(artifactDirectory, {
      expectedCommit: authorizedSha,
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
      authorizedSha,
    );

    const previousList = await transport.run(
      `mountain-preview list ${pullNumber}`,
    );
    previousCommit = /^active\s+([0-9a-f]{40})/mu.exec(previousList)?.[1];
    await revalidatePublication();
    const authorization = {
      pullRequestNumber: pullNumber,
      commit: authorizedSha,
      actor: authorizedBy,
      issuedAt: Date.now(),
    };
    const proof = JSON.stringify({
      issuedAt: authorization.issuedAt,
      signature: signPreviewAuthorization(
        authorization,
        authorizationPrivateKey,
      ),
    });
    try {
      await transport.run(
        `mountain-preview authorize ${pullNumber} ${authorizedSha} ${authorizedBy}`,
        proof,
      );
      authorizationRecorded = true;
    } catch (error) {
      // Only known pre-write rejections rule out a grant renewal.
      authorizationRecorded = !(
        error instanceof RemoteCommandError &&
        confirmedAuthorizationRejections.some((reason) =>
          error.message.includes(reason),
        )
      );
      throw error;
    }
    await transport.run(`mountain-preview site-enable ${pullNumber}`);
    siteEnabled = true;

    await revalidatePublication();
    activated = true;
    await activatePreviewRelease(transport, pullNumber, authorizedSha);
    const health = await transport.run(`mountain-preview health ${pullNumber}`);
    if (!health.startsWith("Health: OK")) throw new Error(health);
    await verifyPreview(previewOrigin(pullNumber));
  } catch (error) {
    await abortPublication(error);
  }

  const origin = previewOrigin(pullNumber);
  let readyToPrune = false;
  try {
    let writeComment;
    let commentError;
    try {
      writeComment = await prepareComment({ origin, headSha: authorizedSha });
    } catch (error) {
      commentError = error;
    }
    try {
      await revalidatePublication();
    } catch (error) {
      await abortPublication(error);
    }
    readyToPrune = true;
    if (commentError) throw commentError;
    await writeComment();
  } finally {
    if (readyToPrune) {
      try {
        await transport.run(`mountain-preview prune ${pullNumber}`);
      } catch (error) {
        console.warn(
          `Preview ${pullNumber} is published but prune failed: ${error.message}`,
        );
      }
    }
  }
  return `Published preview ${origin} at commit ${authorizedSha}.`;
}
