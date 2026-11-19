// Coordination of the CI notifications and of the bounded automatic repair of
// a failing CI (T8.4).
//
// A publication registers one durable watch pinned to the exact pushed commit.
// The worker runs beside the Telegram bridge: it never blocks the instruction
// queue, it never claims a result it did not read, and it never sends a result
// automatically twice. When the required checks of the pinned commit fail, it
// reserves at most two consecutive automatic repairs of the same failing checks
// and hands the work to the durable repair queue. The repair itself runs in the
// same single execution as the instructions, never here.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import {
  classifyCommitStatus,
  describeFailedChecks,
  failureFingerprint,
  isDecisiveFailure,
} from "../repository/ci-status.mjs";
import { repairWillNotRun } from "../repository/ci-watch-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
  sleep,
} from "../repository/request-signal.mjs";
import { redactSecrets } from "../repository/secret-scan.mjs";
import {
  ciNoteReports,
  ciReports,
  ciWatchOutcomes,
} from "../policy/development.mjs";

export const ciResults = {
  success: "success",
  failure: "failure",
  repairing: "repairing",
  repairNotRun: "repair-not-run",
  repairBlocked: "repair-blocked",
  repairLimit: "repair-limit",
  unknown: "unknown",
  headChanged: "head-changed",
  pullRequestClosed: "pull-request-closed",
};

function describe(watch) {
  return `#${watch.pull_request_number} ${watch.commit_sha.slice(0, 7)}`;
}

/** Read and classify the required checks of one exact commit. */
export async function readCiState({ github, requiredChecks, commit, signal }) {
  const [checkRuns, statuses] = await Promise.all([
    github.getCommitCheckRuns({ commit, signal }),
    github.getCommitStatuses({ commit, signal }),
  ]);
  return classifyCommitStatus({ requiredChecks, checkRuns, statuses });
}

/**
 * Persist the watch for a confirmed publication. A failed insert costs the
 * notification, not the work already published, so it is reported to the topic
 * instead of blocking the service.
 *
 * An automatic repair reopens the finished watch of the instruction it
 * continues instead of adding a row: the topic keeps one follow-up slot per
 * published instruction. A human publication resets the repair budget of its
 * pull request.
 */
export function createCiWatchRegistration({ store, logger = () => {} }) {
  return function registerCiWatch({
    updateIdentifier,
    sessionKey,
    pullRequestNumber,
    commit,
    automatic = false,
  }) {
    try {
      if (automatic) {
        if (
          !store.reopen({
            updateIdentifier,
            sessionKey,
            pullRequestNumber,
            commitSha: commit,
          })
        ) {
          throw new Error("The finished watch cannot be reopened.");
        }
      } else {
        store.add({
          updateIdentifier,
          sessionKey,
          pullRequestNumber,
          commitSha: commit,
        });
      }
    } catch (error) {
      logger(
        "ci_watch_registration_failed",
        error instanceof Error ? error.message : "unknown",
      );
      return ciWatchOutcomes.unavailable;
    }
    // The watch is durable: failing to forget the old repair budget costs a
    // stricter limit, never the notification.
    if (!automatic) {
      try {
        store.resetRepairs(pullRequestNumber);
      } catch (error) {
        logger(
          "ci_repair_budget_reset_failed",
          error instanceof Error ? error.message : "unknown",
        );
      }
    }
    return ciWatchOutcomes.registered;
  };
}

/**
 * Read the CI state of the pinned commit. Reading first means a restart can
 * still report the real result; the deadline only ends a watch that has no
 * decisive evidence, and then reports the unknown state.
 */
async function evaluateWatch({
  watch,
  github,
  requiredChecks,
  watchTimeoutMilliseconds,
  requestTimeoutMilliseconds,
  secrets,
  now,
  signal,
}) {
  const readSignal = requestSignal(signal, requestTimeoutMilliseconds);
  const [checkRuns, statuses] = await Promise.all([
    github.getCommitCheckRuns({ commit: watch.commit_sha, signal: readSignal }),
    github.getCommitStatuses({ commit: watch.commit_sha, signal: readSignal }),
  ]);
  const classification = classifyCommitStatus({
    requiredChecks,
    checkRuns,
    statuses,
  });
  const age = now().getTime() - Date.parse(watch.created_at);
  // At the deadline an indecisive picture is reported as unconfirmed, still
  // naming the checks that already failed. It never starts a repair.
  const undecided = () =>
    age < watchTimeoutMilliseconds
      ? null
      : { result: ciResults.unknown, failedChecks: classification.failed };
  if (
    classification.state !== "success" &&
    classification.state !== "failure"
  ) {
    return undecided();
  }

  const pullRequest = await github.getPullRequest({
    number: watch.pull_request_number,
    signal: readSignal,
  });
  if (pullRequest.state !== "open") {
    return { result: ciResults.pullRequestClosed };
  }
  if (pullRequest.headSha !== watch.commit_sha) {
    return { result: ciResults.headChanged, headSha: pullRequest.headSha };
  }
  if (classification.state === "success") {
    return { result: ciResults.success, pullRequestUrl: pullRequest.htmlUrl };
  }
  // A failure is decisive only when the whole required set is known and no
  // required check is still running: the identity of the failure and the repair
  // itself must see the complete set.
  if (!isDecisiveFailure(classification)) {
    return undecided();
  }
  // The failure evidence goes to the private repair queue and to the model, so
  // it is clipped, stripped of terminal codes and redacted before it leaves
  // this read.
  return {
    result: ciResults.failure,
    failedChecks: classification.failed,
    evidence: describeFailedChecks({
      failedChecks: classification.failed,
      checkRuns,
      statuses,
    }).map((entry) => ({
      name: entry.name,
      detail: redactSecrets(entry.detail, secrets),
    })),
  };
}

function unconfirmedNotice(common, failedChecks) {
  if (failedChecks.length === 0) {
    return {
      person: ciReports.unknown,
      note: ciNoteReports.unknown(common),
    };
  }
  return {
    person: ciReports.unconfirmedFailure,
    note: ciNoteReports.unconfirmedFailure({ ...common, failedChecks }),
  };
}

/**
 * The facts of one notice for the private log: the pull request, the exact
 * commit and the names of the checks it talks about.
 */
function describeNotice(watch, outcome, requiredChecks) {
  // The configured list is never empty, and a failure always names its own
  // failing checks, so one of the two always has at least one name.
  const checks =
    outcome.failedChecks?.length > 0 ? outcome.failedChecks : requiredChecks;
  return `${describe(watch)} ${outcome.result} ${checks.join(",")}`;
}

/**
 * The kind of notice an outcome produces. Two notices of the same commit can be
 * different effects (`repairing` and `repair-not-run`, or a plain `unknown` and
 * an unconfirmed failure), so the note identity is not only update and commit.
 */
function noticeKind(outcome) {
  if (outcome.result === ciResults.unknown) {
    return outcome.failedChecks?.length > 0
      ? "unconfirmed-failure"
      : ciResults.unknown;
  }
  return outcome.result;
}

/**
 * The two texts of one notice: the plain one the person reads in the topic, and
 * the technical one that stays in the private trace and in the service note of
 * the session.
 */
function noticeFor({
  watch,
  outcome,
  requiredChecks,
  maximumAutomaticRepairs,
}) {
  const common = {
    pullRequestNumber: watch.pull_request_number,
    commit: watch.commit_sha,
  };
  switch (outcome.result) {
    case ciResults.success:
      return {
        person: ciReports.success({ pullRequestUrl: outcome.pullRequestUrl }),
        note: ciNoteReports.success({ ...common, requiredChecks }),
      };
    case ciResults.repairing:
      return {
        person: ciReports.repairing,
        note: ciNoteReports.repairing({
          ...common,
          failedChecks: outcome.failedChecks,
          attemptNumber: outcome.attemptNumber,
          maximumAttempts: maximumAutomaticRepairs,
        }),
      };
    case ciResults.repairNotRun:
      return {
        person: ciReports.repairNotRun,
        note: ciNoteReports.repairNotRun({
          ...common,
          failedChecks: outcome.failedChecks,
        }),
      };
    case ciResults.repairBlocked:
      return {
        person: ciReports.repairBlocked,
        note: ciNoteReports.repairBlocked({
          ...common,
          failedChecks: outcome.failedChecks,
        }),
      };
    case ciResults.repairLimit:
      return {
        person: ciReports.repairLimit,
        note: ciNoteReports.repairLimit({
          ...common,
          failedChecks: outcome.failedChecks,
          maximumAttempts: maximumAutomaticRepairs,
        }),
      };
    case ciResults.headChanged:
      return {
        person: ciReports.headChanged,
        note: ciNoteReports.headChanged({
          ...common,
          headSha: outcome.headSha,
        }),
      };
    case ciResults.pullRequestClosed:
      return {
        person: ciReports.pullRequestClosed,
        note: ciNoteReports.pullRequestClosed(common),
      };
    default:
      return unconfirmedNotice(common, outcome.failedChecks);
  }
}

export function createCiWatchWorker({
  store,
  github,
  telegram,
  requiredChecks,
  pollIntervalMilliseconds,
  watchTimeoutMilliseconds,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
  repairs,
  maximumAutomaticRepairs,
  secrets = [],
  recordTrace = () => {},
  // The text of a notice is an effect the next turn of the topic must know.
  recordServiceNote = () => {},
  logger = () => {},
  now = () => new Date(),
}) {
  if (
    !Number.isInteger(maximumAutomaticRepairs) ||
    maximumAutomaticRepairs < 1
  ) {
    throw new Error("maximumAutomaticRepairs must be a positive integer.");
  }
  if (!repairs) {
    throw new Error("The durable repair queue is required.");
  }

  /** Resolve to true only when the notice reached Telegram and was recorded. */
  async function deliver(watch, outcome, { signal } = {}) {
    let message;
    let personText;
    let noteText;
    try {
      const { chatIdentifier, threadIdentifier } = parseSessionKey(
        watch.session_key,
      );
      const notice = noticeFor({
        watch,
        outcome,
        requiredChecks,
        maximumAutomaticRepairs,
      });
      personText = notice.person;
      noteText = notice.note;
      message = {
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text: personText,
      };
    } catch {
      // Nothing was sent, and the notice can never be produced: end the watch
      // without pretending the delivery reached Telegram.
      store.markUncertain(watch.update_identifier);
      logger("ci_notification_invalid", describe(watch));
      return false;
    }

    // The effect is decided here, so the topic keeps it even when the send
    // fails: the next turn of its session must know it. The note keeps the
    // technical facts the person never reads.
    recordServiceNote({
      sessionKey: watch.session_key,
      text: noteText,
      receivedText: personText,
      effectKey: `ci:${watch.update_identifier}:${watch.commit_sha}:${noticeKind(outcome)}`,
    });
    if (!store.beginSend(watch.update_identifier, outcome.result)) {
      return false;
    }
    try {
      await telegram.sendMessage({ ...message, signal });
    } catch (error) {
      // The message may or may not have arrived: never retry it automatically.
      store.markUncertain(watch.update_identifier);
      logger(
        "ci_notification_uncertain",
        `${describe(watch)} ${error instanceof Error ? error.name : "unknown"}`,
      );
      return false;
    }
    store.finishSend(watch.update_identifier);
    logger(
      "ci_notification_sent",
      describeNotice(watch, outcome, requiredChecks),
    );
    return true;
  }

  function logFailure(error) {
    logger(
      "ci_watch_failed",
      error instanceof Error ? error.message : "unknown",
    );
  }

  /**
   * The notice and the durable attempt matter; a failed trace line does not. It
   * is logged instead of stopping the cycle before the topic is informed.
   */
  function safeReset(pullRequestNumber) {
    try {
      repairs.resetRepairs(pullRequestNumber);
    } catch (error) {
      logger(
        "ci_repair_budget_reset_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  function safeTrace(entry) {
    try {
      recordTrace(entry);
    } catch (error) {
      logger(
        "ci_trace_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  /**
   * Reserve the next automatic repair of a failure, or report the limit. The
   * attempt is durable before the notice is sent, so a repeated cycle cannot
   * reserve a third one. It is queued only after the notice is delivered and the
   * watch is finished: the repair can neither report before its announcement nor
   * publish while the watch cannot be reopened. An announcement that is not
   * delivered closes the reservation as aborted, so it never runs and it never
   * blocks the topic waiting for a result that will not come. A failure whose
   * attempt already ended is announced as a job that only a new instruction can
   * continue, never as a repair that is running.
   */
  async function requestRepair(watch, outcome, { signal } = {}) {
    const requested = repairs.requestRepair({
      updateIdentifier: watch.update_identifier,
      sessionKey: watch.session_key,
      pullRequestNumber: watch.pull_request_number,
      failureFingerprint: failureFingerprint(outcome.failedChecks),
      failedChecks: outcome.failedChecks,
      evidence: outcome.evidence,
      commitSha: watch.commit_sha,
      maximumAttempts: maximumAutomaticRepairs,
    });
    if (requested === null) {
      await deliver(
        watch,
        { ...outcome, result: ciResults.repairLimit },
        { signal },
      );
      safeTrace({
        updateIdentifier: watch.update_identifier,
        sessionKey: watch.session_key,
        action: "ci_repair_limit_reached",
        detail: describe(watch),
      });
      return;
    }
    if (repairWillNotRun(requested.status)) {
      await deliver(
        watch,
        { ...outcome, result: ciResults.repairNotRun },
        { signal },
      );
      safeTrace({
        updateIdentifier: watch.update_identifier,
        sessionKey: watch.session_key,
        action: "ci_repair_not_run",
        detail: `${describe(watch)} ${requested.status}`,
      });
      return;
    }
    const announced = await deliver(
      watch,
      {
        ...outcome,
        result: ciResults.repairing,
        attemptNumber: requested.attemptNumber,
      },
      { signal },
    );
    if (!announced) {
      repairs.abortReservedRepair(requested.sequence, "announcement_failed");
      safeTrace({
        updateIdentifier: watch.update_identifier,
        sessionKey: watch.session_key,
        action: "ci_repair_not_announced",
        detail: describe(watch),
      });
      return;
    }
    // Only a reservation that actually reached the queue was requested: the
    // topic must not wait for a repair that cannot run.
    if (!repairs.queueRepair(requested.sequence)) {
      safeTrace({
        updateIdentifier: watch.update_identifier,
        sessionKey: watch.session_key,
        action: "ci_repair_not_queued",
        detail: describe(watch),
      });
      return;
    }
    safeTrace({
      updateIdentifier: watch.update_identifier,
      sessionKey: watch.session_key,
      action: "ci_repair_requested",
      detail: `${describe(watch)} ${requested.attemptNumber}/${maximumAutomaticRepairs}`,
    });
  }

  /** One cycle over the pending watches. */
  async function runOnce({ signal } = {}) {
    for (const watch of store.pending()) {
      if (signal?.aborted) return;
      try {
        const outcome = await evaluateWatch({
          watch,
          github,
          requiredChecks,
          watchTimeoutMilliseconds,
          requestTimeoutMilliseconds,
          secrets,
          now,
          signal,
        });
        if (outcome === null) {
          continue;
        }
        if (outcome.result === ciResults.success) {
          // A green commit closes the automatic repair chain of the pull
          // request. Failing to forget it costs a stricter limit, never the
          // notice.
          safeReset(watch.pull_request_number);
        }
        if (outcome.result === ciResults.failure) {
          if (repairs.uncertainRepairCount() > 0) {
            // An unknown repair blocks every automatic repair until a person
            // reconciles it; the failure is still reported.
            await deliver(
              watch,
              { ...outcome, result: ciResults.repairBlocked },
              { signal },
            );
            safeTrace({
              updateIdentifier: watch.update_identifier,
              sessionKey: watch.session_key,
              action: "ci_repair_blocked",
              detail: describe(watch),
            });
            continue;
          }
          await requestRepair(watch, outcome, { signal });
          continue;
        }
        await deliver(watch, outcome, { signal });
      } catch (error) {
        logFailure(error);
      }
    }
  }

  /** Background loop. It returns only when the signal is aborted. */
  async function run({ signal } = {}) {
    while (!signal?.aborted) {
      try {
        await runOnce({ signal });
      } catch (error) {
        // A broken cycle must not end the notifications of the whole process.
        logFailure(error);
      }
      await sleep(pollIntervalMilliseconds, signal);
    }
  }

  return { runOnce, run };
}
