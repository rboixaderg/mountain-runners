// Operator command: report or apply finished worktree retention.
//
// Usage, as the service identity with mountain-agent.service stopped (for
// non-dry-run):
//   node storage/prune-worktrees.mjs --dry-run
//   node storage/prune-worktrees.mjs
//
// The dry run prints the same decision the service would take without writing
// state or removing anything. A worktree with unmerged or unpublished work is
// never removed; generated dependency directories are stripped from closed
// topics.

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import {
  isStoppedServiceState,
  serviceState,
} from "../commands/service-state.mjs";
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
import { pruneFinishedTopicWorktrees } from "../repository/retention.mjs";
import { stateDatabasePath } from "../repository/state-database.mjs";

const usage = `Usage: node storage/prune-worktrees.mjs [--dry-run]

Report or apply finished worktree retention. Stop
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
    stateDatabasePath(statePath),
    "SELECT COUNT(*) AS count FROM instructions WHERE status IN ('running', 'uncertain')",
  );
}

function readTopicBindings(statePath) {
  const database = new DatabaseSync(statePath, { readOnly: true });
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
    const state = serviceState();
    if (!isStoppedServiceState(state)) {
      process.stderr.write(
        `Refusing to prune while systemctl is-active mountain-agent reports ${JSON.stringify(state)}. Stop mountain-agent.service first.\n`,
      );
      return 1;
    }
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
    let finished = { removed: [], kept: [], cleaned: [] };
    const databasePath = stateDatabasePath(config.paths.state);
    if (
      existsSync(databasePath) &&
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
        bindings: readTopicBindings(databasePath),
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

    console.log(
      `${dryRun ? "planned" : "applied"}: ${finished.removed.length} removed, ${finished.cleaned.length} cleaned, ${finished.kept.length} kept`,
    );
    return 0;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

process.umask(0o077);
process.exitCode = await main();
