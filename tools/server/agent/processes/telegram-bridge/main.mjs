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
import { AdmissionQueue, parseSessionKey } from "telegram-pi-bridge/sessions";
import {
  AgentBridge,
  TelegramApi,
  verifyMembership,
} from "telegram-pi-bridge/telegram";
import {
  bridgeMessages,
  continuationReports,
  maximumAutomaticRepairs,
  previewConfirmationTimeoutMilliseconds,
} from "../../policy/development.mjs";
import { agentSecrets, readAgentConfig } from "../../config.mjs";
import { createAttachmentPreparation } from "../../attachments/prepare.mjs";
import { GitHubTrust } from "../../repository/github.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../../repository/merge-request-store.mjs";
import { PreviewRequestStore } from "../../repository/preview-request-store.mjs";
import { SessionNoteStore } from "../../repository/session-note-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
} from "../../repository/request-signal.mjs";
import { pruneArchivedWorktrees } from "../../repository/retention.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import { renameLegacyWorktrees } from "../../repository/worktrees.mjs";
import { createCiRepairExecutor } from "../../workflow/ci-repair.mjs";
import {
  createCiWatchWorker,
  readCiState as readCiCheckState,
} from "../../workflow/ci-watch.mjs";
import { createMergeRequests } from "../../workflow/merge-request.mjs";
import { createPreviewRequests } from "../../workflow/preview-request.mjs";
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

  // The installation salt names every worktree and every public branch suffix.
  // It is created once in the private state directory and never leaves it.
  const identifiers = openIdentifierNames(config.paths.state);

  // A worktree or an archive named after a Telegram chat and topic is renamed
  // before anything uses it. A failure refuses the start: renaming nothing is
  // better than half of the volume keeping a private name.
  try {
    await renameLegacyWorktrees({
      repositoryPath: config.paths.repository,
      worktreeRoot: config.paths.worktrees,
      identifiers,
      signal,
      logger,
    });
  } catch (error) {
    logger(
      "worktree_migration_failed",
      error instanceof Error ? error.message : "unknown",
    );
    throw new Error(
      "Refusing to start: the worktrees of the previous naming scheme could not be renamed.",
      { cause: error },
    );
  }

  const queue = new AdmissionQueue(
    join(config.paths.state, "admission.sqlite"),
    { maxPending: config.limits.maxPendingInstructions },
  );
  const ciWatches = new CiWatchStore(
    join(config.paths.state, "ci-watch.sqlite"),
  );
  const previewRequests = new PreviewRequestStore(
    join(config.paths.state, "preview-request.sqlite"),
  );
  const mergeRequests = new MergeRequestStore(
    join(config.paths.state, "merge-request.sqlite"),
  );
  // The conversation state of every topic: the service effects the next Pi turn
  // must receive and the last text the topic received.
  const sessionNotes = new SessionNoteStore(
    join(config.paths.state, "session-notes.sqlite"),
  );

  // A text the service decides for a topic is kept before it is sent, so the
  // next turn of its session knows the effect even when the send fails. The
  // notes are bookkeeping: a store failure is logged and never stops a report.
  // `effectKey` makes a repeated notice idempotent; `text` is the service-written
  // part (the model's own words are never a note) and `receivedText` the full
  // text the topic received when the two differ.
  function recordServiceNote({ sessionKey, text, effectKey, receivedText }) {
    try {
      sessionNotes.addNote({ sessionKey, text, effectKey, receivedText });
    } catch (error) {
      logger(
        "session_note_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  function closeStateStores() {
    sessionNotes.close();
    mergeRequests.close();
    previewRequests.close();
    ciWatches.close();
    queue.close();
  }

  // Every local recovery runs before any refusal. A refused start must not
  // leave a later case half reconciled, or the next start would depend on the
  // order in which the cases were reported.
  const recovered = queue.recover();
  if (recovered > 0) {
    queue.recordTrace({
      action: "startup_refused_uncertain",
      detail: String(recovered),
    });
  }

  // Interrupted deliveries are unknown, not retried: each one stays attributed
  // in the private trace so an operator can reconcile it with GitHub.
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
  for (const repair of ciWatches.interruptRepairs()) {
    queue.recordTrace({
      updateIdentifier: repair.update_identifier,
      sessionKey: repair.session_key,
      action: "ci_repair_uncertain",
      detail: `#${repair.pull_request_number} ${repair.commit_sha.slice(0, 7)}`,
    });
  }

  // A reservation that a restart found unannounced never reached the queue. It
  // is closed instead of blocking the topic with a result that will not come.
  for (const repair of ciWatches.abortInterruptedReservations(
    "interrupted_before_queue",
  )) {
    queue.recordTrace({
      updateIdentifier: repair.update_identifier,
      sessionKey: repair.session_key,
      action: "ci_repair_not_queued",
      detail: `#${repair.pull_request_number} ${repair.commit_sha.slice(0, 7)}`,
    });
  }

  // An interrupted preview comment may or may not exist. Like an interrupted
  // repair, it is never posted again automatically: the service refuses to
  // start until a person reconciles the real state.
  for (const request of previewRequests.recoverCommenting()) {
    queue.recordTrace({
      updateIdentifier: request.update_identifier,
      authorIdentifier: request.author_identifier,
      sessionKey: request.session_key,
      action: "preview_uncertain",
      detail: `#${request.pull_request_number} ${request.commit_sha.slice(0, 7)}`,
    });
  }

  // An interrupted merge may have happened. It is never requested again
  // blindly: it stays uncertain, attributed in the private trace, until the
  // pull request is read and the topic is told once at startup. That never
  // blocks the service, because only a new merge of the same pull request
  // depends on it.
  for (const request of mergeRequests.recoverMerging()) {
    queue.recordTrace({
      updateIdentifier: request.update_identifier,
      authorIdentifier: request.author_identifier,
      sessionKey: request.session_key,
      action: "merge_uncertain",
      detail: `#${request.pull_request_number} ${request.commit_sha.slice(0, 7)}`,
    });
  }

  if (recovered > 0) {
    closeStateStores();
    throw new Error(
      `Refusing to start: ${recovered} interrupted instruction(s) have an unknown external result.`,
    );
  }

  const uncertainRepairs = ciWatches.uncertainRepairCount();
  if (uncertainRepairs > 0) {
    logger("ci_repair_uncertain", String(uncertainRepairs));
    closeStateStores();
    throw new Error(
      `Refusing to start: ${uncertainRepairs} CI repair(s) have an unknown external result.`,
    );
  }

  const uncertainPreviews = previewRequests.uncertainCount();
  if (uncertainPreviews > 0) {
    logger("preview_uncertain", String(uncertainPreviews));
    closeStateStores();
    throw new Error(
      `Refusing to start: ${uncertainPreviews} preview request(s) have an unknown external result.`,
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
    sessionNotes.close();
    mergeRequests.close();
    previewRequests.close();
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
  // Both the preview and the merge re-check the author's membership when the
  // request runs: neither is ordinary queued work. The read is bounded by the
  // request deadline, so a Telegram that never answers cannot stall them.
  const verifyAuthorMembership = (authorIdentifier, signal) =>
    verifyMembership({
      telegram,
      groupIdentifier: config.telegram.groupIdentifier,
      authorIdentifier,
      signal: requestSignal(signal, defaultRequestTimeoutMilliseconds),
    });
  const previewWorker = createPreviewRequests({
    store: previewRequests,
    reportedCommits: ciWatches,
    verifyMembership: verifyAuthorMembership,
    github,
    repository: config.github.repository,
    requiredChecks: config.github.requiredChecks,
    telegram,
    pollIntervalMilliseconds: config.limits.ciPollIntervalMs,
    confirmationTimeoutMilliseconds: previewConfirmationTimeoutMilliseconds,
    recordTrace: (entry) => queue.recordTrace(entry),
    recordServiceNote,
    logger,
  });
  const mergeWorker = createMergeRequests({
    store: mergeRequests,
    reportedCommits: ciWatches,
    hasNewerWork: ({ sessionKey, updateIdentifier }) =>
      queue.hasOtherInstructions(sessionKey, updateIdentifier) ||
      ciWatches.hasUnreportedWork(sessionKey),
    verifyMembership: verifyAuthorMembership,
    github,
    repository: config.github.repository,
    requiredChecks: config.github.requiredChecks,
    telegram,
    recordTrace: (entry) => queue.recordTrace(entry),
    recordServiceNote,
    logger,
  });
  await mergeWorker.reconcileUncertain({ signal });
  // One read of the required checks of an exact commit, shared by the
  // continuation of a pull request and the automatic repair.
  const readCiState = ({ commit, signal }) =>
    readCiCheckState({
      github,
      requiredChecks: config.github.requiredChecks,
      commit,
      signal,
    });
  const runner =
    runnerOverride ??
    createProjectRunner({
      config,
      github,
      environment,
      logger,
      ciWatches,
      requestPreview: previewWorker.handle,
      requestMerge: mergeWorker.handle,
      readCiState,
      // The raw download only touches the service temporary directory, so the
      // downloaded image is cleaned before it reaches a worktree.
      prepareAttachment: createAttachmentPreparation({ telegram, logger }),
      sessionNotes,
      hasOtherInstructions: (sessionKey, updateIdentifier) =>
        queue.hasOtherInstructions(sessionKey, updateIdentifier),
      notifyHandover: async ({
        updateIdentifier,
        sessionKey,
        pullRequestNumber,
        signal,
      }) => {
        const { chatIdentifier, threadIdentifier } =
          parseSessionKey(sessionKey);
        const text = continuationReports.handover({ pullRequestNumber });
        recordServiceNote({
          sessionKey,
          text,
          effectKey: `handover:${updateIdentifier}`,
        });
        await telegram.sendMessage({
          chatIdentifier,
          messageThreadIdentifier: threadIdentifier,
          text,
          signal: requestSignal(signal, defaultRequestTimeoutMilliseconds),
        });
      },
      recordTrace: (entry) => queue.recordTrace(entry),
    });

  const ciRepairExecutor = createCiRepairExecutor({
    repairs: ciWatches,
    runInstruction: runner,
    readPullRequest: ({ pullRequestNumber, signal }) =>
      github.getPullRequest({ number: pullRequestNumber, signal }),
    readCiState,
    telegram,
    recordTrace: (entry) => queue.recordTrace(entry),
    recordServiceNote,
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
    onServiceReport: recordServiceNote,
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
    recordServiceNote,
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
    previewRequests,
    previewWorker,
    mergeRequests,
    mergeWorker,
    ciRepairExecutor,
    sessionNotes,
    logger,
  };
}

/**
 * Run the bridge and the CI and preview watchers together. A watcher never
 * blocks the bridge, and both are always stopped before the remaining cleanup
 * so a failing bridge cannot leave the process waiting for them.
 */
export async function runBridgeWithCiWatcher({
  bridge,
  ciWorker,
  previewWorker,
  signal,
  abort,
  logger = defaultLogger,
}) {
  function supervise(failureEvent, worker) {
    return worker.run({ signal }).catch((error) => {
      logger(failureEvent, error instanceof Error ? error.message : "unknown");
    });
  }
  const workers = [supervise("ci_watch_worker_failed", ciWorker)];
  if (previewWorker) {
    workers.push(supervise("preview_worker_failed", previewWorker));
  }

  try {
    await bridge.run({ signal });
  } finally {
    abort();
    await Promise.all(workers);
  }
}

export async function main({ environment = process.env } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const {
    queue,
    bridge,
    ciWatches,
    ciWorker,
    previewRequests,
    previewWorker,
    mergeRequests,
    sessionNotes,
    logger,
  } = await startService({
    environment,
    signal: controller.signal,
  });

  try {
    await runBridgeWithCiWatcher({
      bridge,
      ciWorker,
      previewWorker,
      signal: controller.signal,
      abort: stop,
      logger,
    });
  } finally {
    await stopAllSandboxedCommands();
    sessionNotes.close();
    mergeRequests.close();
    previewRequests.close();
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
