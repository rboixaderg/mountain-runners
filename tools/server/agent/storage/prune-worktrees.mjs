// Operator command: report or apply archived and finished worktree retention.
//
// Usage, as the service identity with mountain-agent.service stopped (for
// non-dry-run):
//   node storage/prune-worktrees.mjs --dry-run
//   node storage/prune-worktrees.mjs
//
// The dry run prints the same decision the service would take without writing
// state or removing anything. A worktree with unmerged or unpublished work is
// never removed, and the newest archive of each topic is always preserved;
// generated dependency directories are stripped from kept archives and closed
// topics.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { readAgentConfig } from "../config.mjs";
import { GitHubTrust } from "../repository/github.mjs";
import {
  createIdentifierNames,
  identifierSaltPath,
  readIdentifierSalt,
} from "../repository/identifiers.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
} from "../repository/request-signal.mjs";
import {
  pruneArchivedWorktrees,
  pruneFinishedTopicWorktrees,
} from "../repository/retention.mjs";

const usage = `Usage: node storage/prune-worktrees.mjs [--dry-run]

Report or apply archived and finished worktree retention. Stop
mountain-agent.service before running without --dry-run.
`;

function querySingleCount(databasePath, sql) {
  if (!existsSync(databasePath)) {
    return 0;
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).get()?.count ?? 0;
  } finally {
    database.close();
  }
}

function activeOrUncertainWorkCount(statePath) {
  return querySingleCount(
    join(statePath, "admission.sqlite"),
    "SELECT COUNT(*) AS count FROM instructions WHERE status IN ('running', 'uncertain')",
  );
}

function readTopicBindings(topicJobsPath) {
  const database = new DatabaseSync(topicJobsPath, { readOnly: true });
  try {
    return database
      .prepare(
        "SELECT session_key, branch, pull_request_number FROM topic_jobs ORDER BY pull_request_number ASC",
      )
      .all()
      .map((row) => ({
        sessionKey: row.session_key,
        branch: row.branch,
        pullRequestNumber: row.pull_request_number,
      }));
  } finally {
    database.close();
  }
}

function reportSection(report, { dryRun }) {
  for (const entry of report.removed) {
    console.log(`${dryRun ? "would remove" : "removed"} ${entry.path}`);
  }
  for (const entry of report.cleaned) {
    console.log(
      `${dryRun ? "would clean" : "cleaned"} ${entry.path} (${entry.directories.join(", ")})`,
    );
  }
  for (const entry of report.kept) {
    console.log(`kept ${entry.path} (${entry.reason})`);
  }
}

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
  if (!dryRun) {
    const active = activeOrUncertainWorkCount(config.paths.state);
    if (active > 0) {
      process.stderr.write(
        `Refusing to prune while ${active} instruction(s) are running or uncertain. Stop mountain-agent.service and reconcile uncertain cases first.\n`,
      );
      return 1;
    }
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const archived = await pruneArchivedWorktrees({
      repositoryPath: config.paths.repository,
      worktreeRoot: config.paths.worktrees,
      dryRun,
      signal: controller.signal,
    });
    reportSection(archived, { dryRun });

    let finished = { removed: [], kept: [], cleaned: [] };
    const topicJobsPath = join(config.paths.state, "topic-jobs.sqlite");
    if (
      existsSync(topicJobsPath) &&
      existsSync(identifierSaltPath(config.paths.state))
    ) {
      const identifiers = createIdentifierNames({
        salt: readIdentifierSalt(config.paths.state),
      });
      const github = new GitHubTrust({
        token: config.github.token,
        repository: config.github.repository,
      });
      finished = await pruneFinishedTopicWorktrees({
        repositoryPath: config.paths.repository,
        worktreeRoot: config.paths.worktrees,
        bindings: readTopicBindings(topicJobsPath),
        worktreeNameForSession: (sessionKey) =>
          identifiers.worktreeName(sessionKey),
        readPullRequest: (number, { signal } = {}) =>
          github.getPullRequest({
            number,
            signal: requestSignal(
              signal ?? controller.signal,
              defaultRequestTimeoutMilliseconds,
            ),
          }),
        dryRun,
        signal: controller.signal,
      });
      reportSection(finished, { dryRun });
    }

    const removedCount = archived.removed.length + finished.removed.length;
    const cleanedCount = archived.cleaned.length + finished.cleaned.length;
    const keptCount = archived.kept.length + finished.kept.length;
    console.log(
      `${dryRun ? "planned" : "applied"}: ${removedCount} removed, ${cleanedCount} cleaned, ${keptCount} kept`,
    );
    return 0;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

process.umask(0o077);
process.exitCode = await main();
