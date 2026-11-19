// Operator command: report or apply archived worktree retention.
//
// Usage, as the service identity and inside the service cgroup:
//   node storage/prune-worktrees.mjs --dry-run
//   node storage/prune-worktrees.mjs
//
// The dry run prints the same decision the service would take without removing
// anything. A worktree with unpublished commits or uncommitted changes is never
// removed, and the newest archive of each topic is always preserved.

import { parseArgs } from "node:util";
import { readAgentConfig } from "../config.mjs";
import { pruneArchivedWorktrees } from "../repository/retention.mjs";

const usage = `Usage: node storage/prune-worktrees.mjs [--dry-run]

Report or apply archived worktree retention. Without --dry-run the worktrees
are removed.
`;

async function main() {
  let values;
  try {
    // Strict parsing: a mistyped flag must never run the destructive default.
    values = parseArgs({
      options: { "dry-run": { type: "boolean" } },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}`);
    return 1;
  }
  const dryRun = values["dry-run"] === true;
  const config = readAgentConfig(process.env);
  const report = await pruneArchivedWorktrees({
    repositoryPath: config.paths.repository,
    worktreeRoot: config.paths.worktrees,
    dryRun,
  });

  for (const entry of report.removed) {
    console.log(`${dryRun ? "would remove" : "removed"} ${entry.path}`);
  }
  for (const entry of report.kept) {
    console.log(`kept ${entry.path} (${entry.reason})`);
  }
  console.log(
    `${dryRun ? "planned" : "applied"}: ${report.removed.length} removed, ${report.kept.length} kept`,
  );
  return 0;
}

process.umask(0o077);
process.exitCode = await main();
