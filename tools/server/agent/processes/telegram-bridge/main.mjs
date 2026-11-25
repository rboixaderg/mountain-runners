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
import {
  AgentBridge,
  TelegramApi,
  verifyMembership,
} from "telegram-pi-bridge/telegram";
import {
  bridgeMessages,
  previewConfirmationTimeoutMilliseconds,
} from "../../policy/development.mjs";
import {
  agentSecrets,
  readAgentConfig,
  removeAgentCredentials,
} from "../../config.mjs";
import { createAttachmentPreparation } from "../../attachments/prepare.mjs";
import { GitHubTrust } from "../../repository/github.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { MergeRequestStore } from "../../repository/merge-request-store.mjs";
import { PreviewRequestStore } from "../../repository/preview-request-store.mjs";
import { SessionNoteStore } from "../../repository/session-note-store.mjs";
import { createResearchReview } from "../../repository/research-review.mjs";
import { TopicJobStore } from "../../repository/topic-job-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
} from "../../repository/request-signal.mjs";
import {
  pruneFinishedTopicWorktrees,
  pruneStoredAttachments,
} from "../../repository/retention.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import { createCiWatchWorker } from "../../workflow/ci-watch.mjs";
import {
  createMergeRequests,
  mergeConfirmationOutcome,
} from "../../workflow/merge-request.mjs";
import { createPreviewRequests } from "../../workflow/preview-request.mjs";
import { createProjectRunner } from "../../workflow/project-runner.mjs";
import { createTopicPullRequestFinder } from "../../workflow/topic-state.mjs";
import { stopAllSandboxedCommands } from "../../sandbox/commands.mjs";
import { readPiVersion } from "../../runtime/pi-adapter.mjs";
import { createWebResearch } from "../../web-research/broker.mjs";
import { createTopicResearch } from "../../web-research/topic-research.mjs";
import {
  disclosureApprovalReply,
  disclosureCancellationReply,
} from "../../web-research/disclosure-approvals.mjs";

function defaultLogger(event, detail) {
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), event, detail: detail ?? null })}\n`,
  );
}

// Retention runs at startup and every six hours while the service is up. The
// interval is unref'd so it never keeps a stopping process alive.
export const retentionIntervalMilliseconds = 6 * 60 * 60 * 1000;

/**
 * Run the callback on every interval until the signal aborts. A failure only
 * reaches the logger: retention must never crash the bridge.
 */
export function scheduleRetention({
  runRetention,
  signal,
  logger = defaultLogger,
  intervalMilliseconds = retentionIntervalMilliseconds,
}) {
  const timer = setInterval(() => {
    runRetention().catch((error) => {
      logger(
        "retention_failed",
        error instanceof Error ? error.message : "unknown",
      );
    });
  }, intervalMilliseconds);
  timer.unref();
  const stop = () => {
    clearInterval(timer);
    signal?.removeEventListener("abort", stop);
  };
  if (signal?.aborted) {
    stop();
    return stop;
  }
  signal?.addEventListener("abort", stop, { once: true });
  return stop;
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
  removeAgentCredentials(config, environment);
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
  const topicJobs = new TopicJobStore(
    join(config.paths.state, "topic-jobs.sqlite"),
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

  // The service runs whatever Pi release is installed. A new one can change its
  // behaviour, so every start records which one it is. A runner override
  // replaces Pi.
  if (!runnerOverride) {
    try {
      const version = await readPiVersion(config.model.piCommand, {
        environment,
      });
      logger("pi_version", version);
      queue.recordTrace({ action: "pi_version", detail: version });
    } catch (error) {
      logger(
        "pi_version_unreadable",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  function closeStateStores() {
    topicJobs.close();
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

  const telegram =
    telegramOverride ?? new TelegramApi({ botToken: config.telegram.botToken });
  let identity;
  try {
    identity = await telegram.getMe({ signal });
  } catch (error) {
    closeStateStores();
    throw error;
  }
  if (
    typeof identity?.username !== "string" ||
    identity.username.toLowerCase() !==
      config.telegram.botUsername.toLowerCase()
  ) {
    closeStateStores();
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

  // Worktrees keep an offline copy of `node_modules` each; when idle, remove
  // clean published worktrees of merged pull requests and strip generated
  // dependencies from other closed topics. Attachments stay available until
  // published or for seven days. Attachment retention runs at startup; the
  // checks of finished topics on GitHub run exclusively inside
  // `AgentBridge.runWhenIdle` so they can never overlap with a sandboxed turn or
  // shutdown.
  const isServiceIdle = () => !queue.isBlocked();

  let retentionDue = true;
  function requestRetention() {
    retentionDue = true;
  }

  async function applyRetention({
    signal: retentionSignal = signal,
    includeFinishedTopics = true,
  } = {}) {
    if (!isServiceIdle()) {
      return;
    }
    if (
      includeFinishedTopics &&
      isServiceIdle() &&
      typeof github?.getPullRequest === "function"
    ) {
      try {
        const finished = await pruneFinishedTopicWorktrees({
          repositoryPath: config.paths.repository,
          worktreeRoot: config.paths.worktrees,
          bindings: topicJobs.list(),
          worktreeNameForSession: (sessionKey) =>
            identifiers.worktreeName(sessionKey),
          readPullRequest: (number, { signal: readSignal } = {}) =>
            github.getPullRequest({
              number,
              signal: requestSignal(
                readSignal ?? retentionSignal,
                defaultRequestTimeoutMilliseconds,
              ),
            }),
          signal: retentionSignal,
          logger,
        });
        if (finished.removed.length > 0) {
          logger(
            "finished_worktree_retention_applied",
            String(finished.removed.length),
          );
        }
        if (finished.cleaned.length > 0) {
          logger(
            "finished_worktree_dependencies_cleaned",
            String(finished.cleaned.length),
          );
        }
      } catch (error) {
        if (retentionSignal?.aborted) {
          return;
        }
        logger(
          "finished_worktree_retention_failed",
          error instanceof Error ? error.message : "unknown",
        );
      }
    }
    try {
      const attachments = pruneStoredAttachments({
        statePath: config.paths.state,
        logger,
      });
      if (attachments.length > 0) {
        logger("attachment_retention_applied", String(attachments.length));
      }
    } catch (error) {
      logger(
        "attachment_retention_failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  await applyRetention({ includeFinishedTopics: false });
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
  const hasWorkInProgress = ({ sessionKey, updateIdentifier }) =>
    queue.hasUnsettledInstructions(sessionKey, updateIdentifier);
  const previewWorker = createPreviewRequests({
    store: previewRequests,
    findTopicPullRequest: createTopicPullRequestFinder(ciWatches),
    verifyMembership: verifyAuthorMembership,
    github,
    repository: config.github.repository,
    telegram,
    pollIntervalMilliseconds: config.limits.ciPollIntervalMs,
    confirmationTimeoutMilliseconds: previewConfirmationTimeoutMilliseconds,
    recordTrace: (entry) => queue.recordTrace(entry),
    recordServiceNote,
    hasWorkInProgress,
    logger,
  });
  let runner;
  const mergeWorker = createMergeRequests({
    store: mergeRequests,
    findDeliveredPreview: (sessionKey) => {
      // Identify the publication independently of its CI notice and of any
      // manual preview request. Never fall back to an earlier preview.
      const publication = ciWatches.latestTopicPublication(sessionKey);
      if (
        publication === undefined ||
        ciWatches.latestPublication(publication.pull_request_number)
          ?.session_key !== sessionKey
      ) {
        return undefined;
      }
      return (
        previewRequests.deliveredPublicationPreview({
          sessionKey,
          updateIdentifier: publication.update_identifier,
          pullRequestNumber: publication.pull_request_number,
          commitSha: publication.commit_sha,
        }) ?? undefined
      );
    },
    hasNewerWork: ({ sessionKey, updateIdentifier }) =>
      queue.hasOtherInstructions(sessionKey, updateIdentifier) ||
      ciWatches.hasUnreportedWork(sessionKey),
    hasInterveningInstructions: (range) =>
      queue.hasInterveningInstructions({
        ...range,
        excludingOutcome: mergeConfirmationOutcome,
      }),
    verifyMembership: verifyAuthorMembership,
    synchronizeBehind: runnerOverride
      ? undefined
      : (request, target, options) =>
          runner.synchronizeForMerge(request, target, options),
    github,
    repository: config.github.repository,
    requiredChecks: config.github.requiredChecks,
    telegram,
    recordTrace: (entry) => queue.recordTrace(entry),
    recordServiceNote,
    logger,
  });
  try {
    await mergeWorker.reconcileUncertain({ signal });
  } catch (error) {
    closeStateStores();
    throw error;
  }
  try {
    const researchReview = createResearchReview({
      directory: join(config.paths.state, "research-review"),
    });
    const research = config.webResearch
      ? createTopicResearch({
          broker: createWebResearch({
            ...config.webResearch,
            neverSend: agentSecrets(config).filter(Boolean),
          }),
          telegram,
          attribution: { groupIdentifier: config.telegram.groupIdentifier },
          checkMembership: verifyAuthorMembership,
          worktreeForSession: identifiers.worktreeName,
          hasInterveningInstructions: (range) =>
            queue.hasInterveningInstructions(range),
          markResearch(jobId) {
            researchReview.ensure(jobId);
            researchReview.markResearch(jobId);
          },
        })
      : undefined;
    runner =
      runnerOverride ??
      createProjectRunner({
        config,
        github,
        environment,
        logger,
        ciWatches,
        mergeRequests,
        topicJobs,
        requestPreview: previewWorker.handle,
        followPreview: previewWorker.followPublication,
        requestMerge: mergeWorker.handle,
        requestMergeConfirmation: mergeWorker,
        research,
        researchReview,
        // The raw download only touches the service temporary directory, so the
        // downloaded image is cleaned before it reaches a worktree.
        prepareAttachment: createAttachmentPreparation({ telegram, logger }),
        sessionNotes,
        recordTrace: (entry) => queue.recordTrace(entry),
      });
  } catch (error) {
    closeStateStores();
    throw error;
  }

  const bridge = new AgentBridge({
    groupIdentifier: config.telegram.groupIdentifier,
    botUsername: config.telegram.botUsername,
    messages: bridgeMessages,
    telegram,
    queue,
    runInstruction: runner,
    shouldAcknowledge: (classification) =>
      (!config.webResearch ||
        ![disclosureApprovalReply, disclosureCancellationReply].includes(
          classification.text,
        )) &&
      mergeWorker.contextualIntent(classification, classification.text) ===
        null,
    botIdentifier: identity.id,
    disableLinkPreview: config.webResearch !== null,
    onServiceReport: recordServiceNote,
    logger,
    // Periodic retention runs strictly inside this single-execution idle hook,
    // never concurrently with an instruction, a sandbox container or shutdown,
    // and never while an unknown external result is unresolved.
    runWhenIdle: async ({ signal: idleSignal }) => {
      if (!isServiceIdle()) {
        return false;
      }
      if (!retentionDue) {
        return false;
      }
      retentionDue = false;
      await applyRetention({ signal: idleSignal });
      return false;
    },
  });

  const ciWorker = createCiWatchWorker({
    store: ciWatches,
    github,
    telegram,
    requiredChecks: config.github.requiredChecks,
    pollIntervalMilliseconds: config.limits.ciPollIntervalMs,
    watchTimeoutMilliseconds: config.limits.ciWatchTimeoutMs,
    recordTrace: (entry) => queue.recordTrace(entry),
    recordServiceNote,
    hasWorkInProgress,
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
    sessionNotes,
    applyRetention,
    requestRetention,
    closeStateStores,
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

/**
 * Release the sandboxed commands and every state store. The stores are closed
 * even when stopping the commands fails: a leaked SQLite handle would keep the
 * state of a service that is already stopping.
 */
export async function stopService({
  stopSandboxedCommands = stopAllSandboxedCommands,
  closeStateStores,
  logger = defaultLogger,
}) {
  try {
    await stopSandboxedCommands();
  } finally {
    closeStateStores();
    logger("service_stopped");
  }
}

export async function main({ environment = process.env } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const {
    bridge,
    ciWorker,
    previewWorker,
    requestRetention,
    closeStateStores,
    logger,
  } = await startService({
    environment,
    signal: controller.signal,
  });

  const stopRetention = scheduleRetention({
    runRetention: async () => {
      requestRetention();
    },
    signal: controller.signal,
    logger,
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
    stopRetention();
    await stopService({ closeStateStores, logger });
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
