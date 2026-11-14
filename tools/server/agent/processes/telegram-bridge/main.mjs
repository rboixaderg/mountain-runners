// Telegram bridge process for the private agent (T8.3).
//
// Wires the trusted components together: Telegram transport, durable admission,
// Git/GitHub operations and the Pi runner. It never starts the model, the
// sandbox or the repository with the production services of phase 5 and 6.
//
// Startup refuses to continue when the previous execution left an unknown
// external result: an operator must inspect the real state first.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { AgentBridge, TelegramApi } from "telegram-pi-bridge/telegram";
import {
  bridgeMessages,
  maximumAutomaticRepairs,
} from "../../policy/development.mjs";
import { agentSecrets, readAgentConfig } from "../../config.mjs";
import { GitHubTrust } from "../../repository/github.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { classifyCommitStatus } from "../../repository/ci-status.mjs";
import { pruneArchivedWorktrees } from "../../repository/retention.mjs";
import { createCiRepairExecutor } from "../../workflow/ci-repair.mjs";
import { createCiWatchWorker } from "../../workflow/ci-watch.mjs";
import { createProjectRunner } from "../../workflow/project-runner.mjs";
import { stopAllSandboxedCommands } from "../../sandbox/commands.mjs";

function defaultLogger(event, detail) {
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), event, detail: detail ?? null })}\n`,
  );
}

export async function startService({
  environment = process.env,
  signal,
  logger = defaultLogger,
  telegram: telegramOverride,
  github: githubOverride,
  runner: runnerOverride,
}) {
  const config = readAgentConfig(environment);
  for (const directory of [
    config.paths.state,
    config.paths.sessions,
    config.paths.worktrees,
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  const queue = new AdmissionQueue(
    join(config.paths.state, "admission.sqlite"),
    { maxPending: config.limits.maxPendingInstructions },
  );

  const recovered = queue.recover();
  if (recovered > 0) {
    queue.recordTrace({
      action: "startup_refused_uncertain",
      detail: String(recovered),
    });
    queue.close();
    throw new Error(
      `Refusing to start: ${recovered} interrupted instruction(s) have an unknown external result.`,
    );
  }

  // Interrupted deliveries are unknown, not retried: each one stays attributed
  // in the private trace so an operator can reconcile it with GitHub.
  const ciWatches = new CiWatchStore(
    join(config.paths.state, "ci-watch.sqlite"),
  );
  const interruptedNotifications = ciWatches.recoverSending();
  for (const watch of interruptedNotifications) {
    queue.recordTrace({
      updateIdentifier: watch.update_identifier,
      sessionKey: watch.session_key,
      action: "ci_notification_uncertain",
      detail: `#${watch.pull_request_number} ${watch.commit_sha.slice(0, 7)}`,
    });
  }
  if (interruptedNotifications.length > 0) {
    logger(
      "ci_notification_uncertain",
      String(interruptedNotifications.length),
    );
  }

  // An interrupted repair may have pushed a commit. Like an interrupted
  // instruction, it is never replayed automatically: the service refuses to
  // start until a person reconciles the real state.
  const interruptedRepairs = ciWatches.interruptRepairs();
  for (const repair of interruptedRepairs) {
    queue.recordTrace({
      updateIdentifier: repair.update_identifier,
      sessionKey: repair.session_key,
      action: "ci_repair_uncertain",
      detail: `#${repair.pull_request_number} ${repair.commit_sha.slice(0, 7)}`,
    });
  }
  const uncertainRepairs = ciWatches.uncertainRepairCount();
  if (uncertainRepairs > 0) {
    logger("ci_repair_uncertain", String(uncertainRepairs));
    ciWatches.close();
    queue.close();
    throw new Error(
      `Refusing to start: ${uncertainRepairs} CI repair(s) have an unknown external result.`,
    );
  }

  // Archived worktrees keep a dependency tree each; remove only the ones that
  // have nothing left to lose. Retention never blocks the service.
  try {
    const retention = await pruneArchivedWorktrees({
      repositoryPath: config.paths.repository,
      worktreeRoot: config.paths.worktrees,
      logger,
    });
    if (retention.removed.length > 0) {
      logger("worktree_retention_applied", String(retention.removed.length));
    }
  } catch (error) {
    logger(
      "worktree_retention_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }

  const telegram =
    telegramOverride ?? new TelegramApi({ botToken: config.telegram.botToken });
  const identity = await telegram.getMe({ signal });
  if (
    typeof identity?.username !== "string" ||
    identity.username.toLowerCase() !==
      config.telegram.botUsername.toLowerCase()
  ) {
    ciWatches.close();
    queue.close();
    throw new Error(
      "The configured bot token does not match the bot username.",
    );
  }

  const github =
    githubOverride ??
    new GitHubTrust({
      token: config.github.token,
      repository: config.github.repository,
    });
  const runner =
    runnerOverride ??
    createProjectRunner({
      config,
      github,
      environment,
      logger,
      ciWatches,
    });

  const ciRepairExecutor = createCiRepairExecutor({
    repairs: ciWatches,
    runInstruction: runner,
    readPullRequest: ({ pullRequestNumber, signal }) =>
      github.getPullRequest({ number: pullRequestNumber, signal }),
    readCiState: async ({ commit, signal }) => {
      const [checkRuns, statuses] = await Promise.all([
        github.getCommitCheckRuns({ commit, signal }),
        github.getCommitStatuses({ commit, signal }),
      ]);
      return classifyCommitStatus({
        requiredChecks: config.github.requiredChecks,
        checkRuns,
        statuses,
      });
    },
    telegram,
    recordTrace: (entry) => queue.recordTrace(entry),
    logger,
  });

  const bridge = new AgentBridge({
    groupIdentifier: config.telegram.groupIdentifier,
    botUsername: config.telegram.botUsername,
    messages: bridgeMessages,
    telegram,
    queue,
    runInstruction: runner,
    botIdentifier: identity.id,
    logger,
    // A repair continues a published change. It runs only when no admitted
    // instruction is executing, and never while the queue is blocked by an
    // unknown external result.
    runWhenIdle: ({ signal }) =>
      queue.isBlocked() || ciWatches.uncertainRepairCount() > 0
        ? false
        : ciRepairExecutor.runNext({ signal }),
  });

  const ciWorker = createCiWatchWorker({
    store: ciWatches,
    repairs: ciWatches,
    github,
    telegram,
    requiredChecks: config.github.requiredChecks,
    pollIntervalMilliseconds: config.limits.ciPollIntervalMs,
    watchTimeoutMilliseconds: config.limits.ciWatchTimeoutMs,
    maximumAutomaticRepairs,
    secrets: agentSecrets(config, environment),
    recordTrace: (entry) => queue.recordTrace(entry),
    logger,
  });

  return {
    config,
    queue,
    bridge,
    telegram,
    github,
    ciWatches,
    ciWorker,
    ciRepairExecutor,
    logger,
  };
}

/**
 * Run the bridge and the CI watcher together. The watcher never blocks the
 * bridge, and it is always stopped before the remaining cleanup so a failing
 * bridge cannot leave the process waiting for it.
 */
export async function runBridgeWithCiWatcher({
  bridge,
  ciWorker,
  signal,
  abort,
  logger = defaultLogger,
}) {
  const worker = ciWorker.run({ signal }).catch((error) => {
    logger(
      "ci_watch_worker_failed",
      error instanceof Error ? error.message : "unknown",
    );
  });

  try {
    await bridge.run({ signal });
  } finally {
    abort();
    await worker;
  }
}

export async function main({ environment = process.env } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const { queue, bridge, ciWatches, ciWorker, logger } = await startService({
    environment,
    signal: controller.signal,
  });

  try {
    await runBridgeWithCiWatcher({
      bridge,
      ciWorker,
      signal: controller.signal,
      abort: stop,
      logger,
    });
  } finally {
    await stopAllSandboxedCommands();
    ciWatches.close();
    queue.close();
    logger("service_stopped");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    defaultLogger(
      "service_failed",
      error instanceof Error ? error.message : "unknown",
    );
    process.exitCode = 1;
  });
}
