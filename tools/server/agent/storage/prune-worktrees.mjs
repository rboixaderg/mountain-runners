// Operator command: report or apply archived worktree retention.
//
// Usage, as the service identity and inside the service cgroup:
//   node storage/prune-worktrees.mjs --dry-run
//   node storage/prune-worktrees.mjs
//
// The dry run prints the same decision the service would take without removing
// anything. A worktree with unpublished commits or uncommitted changes is never
// removed, and the newest archive of each topic is always preserved.

import { readAgentConfig } from "../config.mjs";
import { pruneArchivedWorktrees } from "../repository/retention.mjs";

const dryRun = process.argv.includes("--dry-run");
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
