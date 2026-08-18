#!/usr/bin/env node
// Mountain Runners release CLI (phase 5, task 5.3).
//
// Subcommands:
//   install  <archive> <manifest>   validate, extract and register a release
//   activate <commit>               atomically point `current` at a release
//   rollback [<commit>]             activate the previous eligible release
//   revoke   <commit> --reason <t>  mark a release revoked (never activates)
//   list                            show the release registry
//   health                          verify registry, active release and digests
//   daemon                          serve the release socket (systemd, root)
//
// The maintainer runs the operations as root (sudo); the deploy identity runs
// them through the SSH gate, which forwards validated requests to the daemon.
// Exit codes: 0 success, 1 error, 3 rollback with no eligible release (the
// runbook emergency response applies). Install failure removes the incomplete
// release and never touches the active pointer.

import {
  NoEligibleReleaseError,
  performActivate,
  performHealth,
  performInstall,
  performList,
  performRevoke,
  performRollback,
} from "./operations.mjs";

process.umask(0o022);

const usage = `Usage:
  mountain-release install <archive.tar.gz> <manifest.json>
  mountain-release activate <commit>
  mountain-release rollback [<commit>]
  mountain-release revoke <commit> --reason <text>
  mountain-release list
  mountain-release health
  mountain-release daemon`;

const commands = new Set([
  "install",
  "activate",
  "rollback",
  "revoke",
  "list",
  "health",
  "daemon",
]);

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined || !commands.has(command)) {
    throw new CliError(usage);
  }

  if (command === "install") {
    const [archivePath, manifestPath] = args;
    if (archivePath === undefined || manifestPath === undefined) {
      throw new CliError("install requires an archive and a manifest.");
    }
    console.log(await performInstall(archivePath, manifestPath));
    return;
  }

  if (command === "activate") {
    const [commit] = args;
    if (commit === undefined) {
      throw new CliError("activate requires a commit.");
    }
    console.log(await performActivate(commit));
    return;
  }

  if (command === "rollback") {
    console.log(await performRollback(args[0]));
    return;
  }

  if (command === "revoke") {
    const [commit, reasonFlag, ...reasonTokens] = args;
    const reason =
      reasonFlag === "--reason" ? reasonTokens.join(" ") : undefined;
    if (commit === undefined || reason === undefined || reason.trim() === "") {
      throw new CliError("revoke requires a commit and --reason <text>.");
    }
    console.log(await performRevoke(commit, reason.trim()));
    return;
  }

  if (command === "list") {
    console.log(performList());
    return;
  }

  if (command === "health") {
    const message = await performHealth();
    console.log(message);
    if (!message.startsWith("Health: OK")) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "daemon") {
    await import("./daemon.mjs");
    return;
  }

  throw new CliError(usage);
}

class CliError extends Error {}

main().catch((error) => {
  if (error instanceof NoEligibleReleaseError) {
    console.error(error.message);
    process.exitCode = 3;
  } else {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
});
