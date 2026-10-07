#!/usr/bin/env node
// Trusted cleanup: never checks out or executes pull request code.
import { createSshTransport } from "../deploy/ssh.mjs";

const activeRetentionMs = 14 * 24 * 60 * 60 * 1000;
const pendingRetentionMs = 24 * 60 * 60 * 1000;

export async function reconcilePreviews({
  transport,
  readPull,
  repository,
  now = Date.now(),
}) {
  await transport.run("mountain-preview cleanup-retired");
  await transport.run("mountain-preview site-reconcile");
  const inventory = JSON.parse(
    await transport.run("mountain-preview inventory"),
  );
  const inconsistent = [];
  const failures = [];
  for (const entry of inventory) {
    try {
      if (!Number.isSafeInteger(entry.pullNumber) || entry.pullNumber < 1) {
        throw new Error("Invalid pull request number in preview inventory.");
      }
      if (entry.inconsistent) {
        await transport.run(`mountain-preview retire ${entry.pullNumber}`);
        await transport.run(
          `mountain-preview site-disable ${entry.pullNumber}`,
        );
        inconsistent.push(entry.pullNumber);
        continue;
      }
      const updatedAt = Date.parse(entry.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt > now) {
        throw new Error(`Invalid update time for preview ${entry.pullNumber}.`);
      }
      let shouldRetire =
        now - updatedAt >=
          (entry.commit === undefined
            ? pendingRetentionMs
            : activeRetentionMs) ||
        (entry.expiresAt !== undefined && Date.parse(entry.expiresAt) <= now);
      if (!shouldRetire) {
        const pull = await readPull(entry.pullNumber);
        shouldRetire =
          pull.state !== "open" ||
          pull.labels?.some((label) => label.name === "preview-revoked") ||
          pull.head?.repo?.full_name !== repository;
      }
      if (shouldRetire) {
        await transport.run(`mountain-preview retire ${entry.pullNumber}`);
        await transport.run(
          `mountain-preview site-disable ${entry.pullNumber}`,
        );
      } else if (entry.commit !== undefined) {
        await transport.run(`mountain-preview prune ${entry.pullNumber}`);
      }
    } catch (error) {
      failures.push(`Preview ${entry.pullNumber}: ${error.message}`);
    }
  }
  if (inconsistent.length > 0) {
    failures.push(
      `Inconsistent active previews were retired: ${inconsistent.join(", ")}.`,
    );
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

async function main() {
  const requireEnvironment = (name) => {
    if (!process.env[name])
      throw new Error(`${name} is required for preview cleanup.`);
    return process.env[name];
  };
  const token = requireEnvironment("GITHUB_TOKEN");
  const repository = requireEnvironment("GITHUB_REPOSITORY");
  const transport = createSshTransport({
    host: requireEnvironment("PREVIEW_HOST"),
    user: process.env.PREVIEW_DEPLOY_USER || "preview-deploy",
    allowedUsers: ["preview-deploy"],
    remoteTool: "mountain-preview",
    privateKey: requireEnvironment("PREVIEW_SSH_PRIVATE_KEY"),
    knownHosts: requireEnvironment("PREVIEW_KNOWN_HOSTS"),
  });
  await reconcilePreviews({
    transport,
    repository,
    readPull: async (number) => {
      const response = await fetch(
        `https://api.github.com/repos/${repository}/pulls/${number}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "mountain-runners-preview-cleanup",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!response.ok)
        throw new Error(
          `Cannot read pull request ${number} (${response.status}).`,
        );
      return response.json();
    },
  });
}

if (process.argv[1]?.endsWith("/reconcile.mjs")) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
