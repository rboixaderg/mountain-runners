#!/usr/bin/env node
// SSH forced-command gate and direct CLI for the preview identity (T6.3).
//
// The preview SSH key is installed with `command="/usr/local/bin/preview-ssh-gate"`
// in authorized_keys, so the holder can only run the bounded preview
// operations on its own namespace. The gate tokenizes SSH_ORIGINAL_COMMAND
// without a shell and rejects any token containing shell metacharacters, the
// same way the release gate does. The direct maintainer invocation reads the
// command from argv instead.
//
// The preview identity owns its namespace and runs release operations directly.
// The separate root-owned preview process verifies signed authorizations and manages Caddy;
// the gate cannot write its configuration or authorize a release on its own.
// Install binds the PR argument to the manifest origin and number.
//
// Commands:
//   receive <pr-number> <name>                    stage an upload (stdin)
//   install <pr-number> <archive> <manifest>      validate and extract
//   authorize <pr-number> <commit> <actor>        send signed proof from stdin
//   activate <pr-number> <commit>                 repoint the namespace
//   list <pr-number>                              show the namespace registry
//   health <pr-number>                            verify registry + active digests
//   retire <pr-number>                            unpublish and remove namespace
//   inventory                                     list origins for reconciliation
//   prune <pr-number>                            remove inactive releases/uploads
//   site-enable <pr-number>                     configure verified origin in Caddy
//   site-disable <pr-number>                    remove origin from Caddy
//   site-sync                                   remove sites without a current release
//
// Exit codes: 0 success, 1 error.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  performActivate,
  performHealth,
  performInstall,
  performList,
} from "../../../release/operations.mjs";
import { loadAndValidateManifest } from "../../../release/manifest.mjs";
import { loadRegistry } from "../../../release/registry.mjs";
import {
  formatReceiveMessage,
  receiveIncomingFile,
} from "../../../release/receive.mjs";
import { commitPattern, incomingPath } from "../../../release/validate.mjs";
import {
  assertPreviewManifestConsistency,
  prNumberPattern,
  previewNamespacePaths,
} from "../../config.mjs";
import { cleanRetiredPreviews, retirePreview } from "./retire.mjs";
import {
  assertNamespaceCapacity,
  assertPreviewCapacity,
  withPreviewCapacity,
} from "./capacity.mjs";
import { previewInventory } from "./inventory.mjs";
import { prunePreview } from "./prune.mjs";
import { requestPreviewSite } from "./site-request.mjs";

const unsafeTokenPattern = /[\s"'`$\\;|&<>()]/u;

function tokenize(originalCommand) {
  if (originalCommand === undefined || originalCommand === "") {
    throw new Error("No command was provided.");
  }
  const tokens = originalCommand.trim().split(/\s+/u);
  for (const token of tokens) {
    if (unsafeTokenPattern.test(token)) {
      throw new Error(
        `Rejected token with shell metacharacters: ${JSON.stringify(token)}.`,
      );
    }
  }
  return tokens;
}

function requirePullRequestNumber(argument) {
  if (argument === undefined || !prNumberPattern.test(argument)) {
    throw new Error(
      `The pull request number must be decimal digits, got ${JSON.stringify(argument)}.`,
    );
  }
  return argument;
}

function validateCommand(command, commandArgs) {
  if (command === "inventory" || command === "site-sync") {
    if (commandArgs.length !== 0)
      throw new Error(`${command} takes no arguments.`);
    return { command };
  }
  if (command === "receive") {
    if (commandArgs.length !== 2) {
      throw new Error(
        "receive requires exactly the pull request number and the incoming file name.",
      );
    }
    return {
      command,
      pullRequestNumber: requirePullRequestNumber(commandArgs[0]),
      fileName: commandArgs[1],
    };
  }

  if (command === "install") {
    if (commandArgs.length !== 3) {
      throw new Error(
        "install requires exactly the pull request number, an archive and a manifest path.",
      );
    }
    return {
      command,
      pullRequestNumber: requirePullRequestNumber(commandArgs[0]),
      archiveArgument: commandArgs[1],
      manifestArgument: commandArgs[2],
    };
  }

  if (command === "activate") {
    if (commandArgs.length !== 2) {
      throw new Error(
        "activate requires exactly the pull request number and a commit.",
      );
    }
    const commit = commandArgs[1];
    if (!commitPattern.test(commit)) {
      throw new Error("The commit must be a 40-character hex SHA-1.");
    }
    return {
      command,
      pullRequestNumber: requirePullRequestNumber(commandArgs[0]),
      commit,
    };
  }

  if (command === "authorize") {
    if (commandArgs.length !== 3 || !commitPattern.test(commandArgs[1])) {
      throw new Error(
        "authorize requires a PR number, commit and GitHub actor.",
      );
    }
    return {
      command,
      pullRequestNumber: requirePullRequestNumber(commandArgs[0]),
      commit: commandArgs[1],
      actor: commandArgs[2],
    };
  }

  if (
    command === "list" ||
    command === "health" ||
    command === "retire" ||
    command === "prune" ||
    command === "site-enable" ||
    command === "site-disable"
  ) {
    if (commandArgs.length !== 1) {
      throw new Error(`${command} requires exactly the pull request number.`);
    }
    return {
      command,
      pullRequestNumber: requirePullRequestNumber(commandArgs[0]),
    };
  }

  throw new Error(`Unknown command: ${command}.`);
}

// Validates the manifest against the namespace before the install extracts
// anything: the origin must be this PR's preview origin and the recorded PR
// number must match the namespace argument.
async function assertManifestBelongsToNamespace(
  manifestPath,
  pullRequestNumber,
) {
  const manifest = await loadAndValidateManifest(manifestPath);
  return assertPreviewManifestConsistency(manifest, pullRequestNumber);
}

async function runCommand(validated) {
  if (validated.command === "inventory") {
    await withPreviewCapacity(cleanRetiredPreviews);
    return JSON.stringify(await previewInventory());
  }
  if (validated.command === "site-sync") {
    return requestPreviewSite("sync");
  }
  const { pullRequestNumber } = validated;
  if (
    validated.command === "site-enable" ||
    validated.command === "site-disable"
  ) {
    return requestPreviewSite(
      validated.command === "site-enable" ? "enable" : "disable",
      Number(pullRequestNumber),
    );
  }
  if (validated.command === "retire") {
    return retirePreview(pullRequestNumber);
  }
  // MOUNTAIN_RELEASE_ROOT points the phase 5 validators, registry and
  // operations at this preview's namespace; nothing outside it is touched.
  const namespaceRoot = previewNamespacePaths(pullRequestNumber).root;
  process.env.MOUNTAIN_RELEASE_ROOT = namespaceRoot;

  await withPreviewCapacity(async () => {
    await assertNamespaceCapacity(pullRequestNumber);
    await mkdir(join(namespaceRoot, "incoming"), { recursive: true });
    await mkdir(join(namespaceRoot, "releases"), { recursive: true });
  });

  if (validated.command === "receive") {
    const received = await receiveIncomingFile({
      fileName: validated.fileName,
      stdin: process.stdin,
    });
    return formatReceiveMessage(received);
  }

  if (validated.command === "install") {
    const archivePath = incomingPath(validated.archiveArgument);
    const manifestPath = incomingPath(validated.manifestArgument);
    await assertManifestBelongsToNamespace(manifestPath, pullRequestNumber);
    return performInstall(archivePath, manifestPath);
  }

  if (validated.command === "authorize") {
    let proof = "";
    for await (const chunk of process.stdin) {
      proof += chunk.toString("utf8");
      if (proof.length > 1024)
        throw new Error("Oversized preview authorization proof.");
    }
    const { issuedAt, signature } = JSON.parse(proof);
    return requestPreviewSite("authorize", Number(pullRequestNumber), {
      commit: validated.commit,
      actor: validated.actor,
      issuedAt,
      signature,
    });
  }

  if (validated.command === "activate") {
    return withPreviewCapacity(async () => {
      await assertPreviewCapacity(pullRequestNumber);
      const registry = loadRegistry();
      const release = registry.releases.find(
        (entry) => entry.commit === validated.commit,
      );
      if (
        !release?.authorizedBy ||
        Date.parse(release.expiresAt) <= Date.now()
      ) {
        throw new Error("The preview release has no current authorization.");
      }
      return performActivate(validated.commit);
    });
  }

  if (validated.command === "list") {
    return performList();
  }

  if (validated.command === "prune") {
    const health = await performHealth();
    if (!health.startsWith("Health: OK")) throw new Error(health);
    return prunePreview();
  }

  const healthMessage = await performHealth();
  if (!healthMessage.startsWith("Health: OK")) {
    throw new Error(healthMessage);
  }
  return healthMessage;
}

async function main() {
  const originalCommand = process.env.SSH_ORIGINAL_COMMAND;
  // An SSH session always carries SSH_ORIGINAL_COMMAND (possibly empty, which
  // the tokenizer rejects); only the direct maintainer invocation falls back
  // to argv, where the first token is the command itself.
  const tokens =
    originalCommand === undefined
      ? process.argv.slice(2)
      : tokenize(originalCommand);
  if (originalCommand === undefined) {
    const [command, ...commandArgs] = tokens;
    console.log(await runCommand(validateCommand(command, commandArgs)));
    return;
  }
  const [toolName, command, ...commandArgs] = tokens;
  if (toolName !== "mountain-preview") {
    throw new Error(
      `Only the preview tool can run over the preview identity; got ${JSON.stringify(toolName)}.`,
    );
  }
  console.log(await runCommand(validateCommand(command, commandArgs)));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
