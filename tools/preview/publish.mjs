#!/usr/bin/env node
// Preview publish entrypoint (T6.3).
//
// Runs from `main` on a GitHub-hosted runner behind the `previews`
// environment with the preview deployment secrets. It never prints
// credentials, never rebuilds the site and never touches production: the
// pull request state is verified against trusted platform metadata inside
// publishPreview, and the artifact built in the same workflow run is
// validated before anything is written to the namespace assigned to the
// pull request.
//
// Required environment:
//   PREVIEW_PULL_NUMBER   pull request number to publish
//   PREVIEW_HOST          preview VPS host
//   PREVIEW_DEPLOY_USER   optional; must be the preview-deploy identity
//   PREVIEW_SSH_PRIVATE_KEY, PREVIEW_KNOWN_HOSTS  preview identity secrets
//   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL
import { readFileSync } from "node:fs";
import {
  assertCommentAuthorized,
  assertDispatchActorAuthorized,
  commentOnPublishedPreview,
  publishPreview,
  resolvePullRequestState,
} from "./publish-operations.mjs";
import { createSshTransport } from "../deploy/ssh.mjs";

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to publish the preview.`);
  }
  return value;
}

function readEvent() {
  return JSON.parse(
    readFileSync(requireEnvironment("GITHUB_EVENT_PATH"), "utf8"),
  );
}

async function main() {
  const repository = requireEnvironment("GITHUB_REPOSITORY");
  const apiUrl = process.env.GITHUB_API_URL;
  const token = process.env.GITHUB_TOKEN;
  const pullNumber = Number(requireEnvironment("PREVIEW_PULL_NUMBER"));
  const revalidateCommentAuthorization =
    process.env.GITHUB_EVENT_NAME === "issue_comment"
      ? async () => {
          const event = readEvent();
          await assertCommentAuthorized({
            repository,
            apiUrl,
            token,
            commentAuthor: event.comment?.user?.login,
          });
        }
      : undefined;
  const revalidateDispatchAuthorization =
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
      ? () =>
          assertDispatchActorAuthorized({
            repository,
            apiUrl,
            token,
            actor: requireEnvironment("GITHUB_ACTOR"),
          })
      : undefined;

  const message = await publishPreview({
    artifactDirectory: process.env.ARTIFACT_DIRECTORY ?? "artifacts/preview",
    pullNumber,
    authorizedBy:
      process.env.GITHUB_EVENT_NAME === "issue_comment"
        ? readEvent().comment?.user?.login
        : requireEnvironment("GITHUB_ACTOR"),
    authorizationPrivateKey: requireEnvironment("PREVIEW_AUTH_PRIVATE_KEY"),
    resolvePullRequestState: () =>
      resolvePullRequestState({
        repository,
        apiUrl,
        token,
        pullNumber,
      }),
    revalidateCommentAuthorization,
    revalidateDispatchAuthorization,
    onPublished: ({ headSha, origin }) =>
      commentOnPublishedPreview({
        repository,
        apiUrl,
        token,
        pullNumber,
        headSha,
        origin,
      }),
    transport: createSshTransport({
      host: requireEnvironment("PREVIEW_HOST"),
      user: process.env.PREVIEW_DEPLOY_USER || "preview-deploy",
      allowedUsers: ["preview-deploy"],
      remoteTool: "mountain-preview",
      privateKey: requireEnvironment("PREVIEW_SSH_PRIVATE_KEY"),
      knownHosts: requireEnvironment("PREVIEW_KNOWN_HOSTS"),
    }),
  });
  console.log(message);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
