// Operator command: rename the worktrees of the previous naming scheme (T8.6).
//
// Usage, as the service identity and inside the service cgroup:
//   node commands/migrate-identifiers/cli.mjs
//
// The service runs the same migration at its startup. This command exists for
// the upgrade order of docs/operations/agent.md: update the code, migrate, reconcile
// the cases that block the start, then start the service. It creates the
// installation salt when it does not exist yet, never removes anything, and a
// second run changes nothing.

import { readAgentConfig } from "../../config.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import { renameLegacyWorktrees } from "../../repository/worktrees.mjs";

function messageOf(error) {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Run the migration and return the exit code. A failure changes nothing the
 * next start cannot finish: every step of the migration is idempotent.
 */
export async function runMigrateIdentifiersCommand({
  environment = process.env,
  write = (text) => process.stdout.write(text),
  warn = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  let config;
  try {
    config = readAgentConfig(environment);
  } catch (error) {
    warn(messageOf(error));
    return 1;
  }

  try {
    const renamed = await renameLegacyWorktrees({
      repositoryPath: config.paths.repository,
      worktreeRoot: config.paths.worktrees,
      identifiers: openIdentifierNames(config.paths.state),
      logger: (event, detail) =>
        write(`${event}${detail === undefined ? "" : ` ${detail}`}\n`),
    });
    write(`migrated ${renamed.length} worktree(s)\n`);
    return 0;
  } catch (error) {
    warn(messageOf(error));
    return 1;
  }
}
