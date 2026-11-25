// Coordination of the CI notifications.
//
// A publication registers one durable watch pinned to the exact pushed commit.
// The worker runs beside the Telegram bridge: it never blocks the instruction
// queue and it never claims a result it did not read. A watch ends only after
// its notice was sent, so a failed send is retried with a growing delay.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import {
  classifyCommitStatus,
  isDecisiveFailure,
} from "../repository/ci-status.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
  sleep,
} from "../repository/request-signal.mjs";
import {
  ciNoteReports,
  ciReports,
  ciWatchOutcomes,
  maintainerAttentionAction,
} from "../policy/development.mjs";

const maximumRetryDelayMilliseconds = 60 * 60 * 1000;

export const ciResults = {
  success: "success",
  failure: "failure",
  unknown: "unknown",
  headChanged: "head-changed",
  pullRequestClosed: "pull-request-closed",
};

function describe(watch) {
  return `#${watch.pull_request_number} ${watch.commit_sha.slice(0, 7)}`;
}

/**
 * Persist the watch for a confirmed publication. A failed insert costs the
 * notification, not the work already published, so it is reported to the topic
 * instead of blocking the service.
 */
export function createCiWatchRegistration({ store, logger = () => {} }) {
  return function registerCiWatch({
    updateIdentifier,
    sessionKey,
    pullRequestNumber,
    commit,
  }) {
    try {
      store.add({
        updateIdentifier,
        sessionKey,
        pullRequestNumber,
        commitSha: commit,
      });
    } catch (error) {
      logger(
        "ci_watch_registration_failed",
        error instanceof Error ? error.message : "unknown",
      );
      return ciWatchOutcomes.unavailable;
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
  watchTimeoutMilliseconds,
  now,
  ...reads
}) {
  const age = now().getTime() - Date.parse(watch.created_at);
  try {
    return await readWatchOutcome({
      watch,
      age,
      watchTimeoutMilliseconds,
      ...reads,
    });
  } catch (error) {
    // Reads that keep failing must not hold the watch open past its deadline.
    if (age < watchTimeoutMilliseconds) throw error;
    return { result: ciResults.unknown, failedChecks: [] };
  }
}

async function readWatchOutcome({
  watch,
  age,
  github,
  requiredChecks,
  watchTimeoutMilliseconds,
  requestTimeoutMilliseconds,
  signal,
}) {
  const readSignal = requestSignal(signal, requestTimeoutMilliseconds);
  const [checkRuns, statuses] = await Promise.all([
    github.getCommitCheckRuns({
      commit: watch.commit_sha,
      signal: readSignal,
    }),
    github.getCommitStatuses({
      commit: watch.commit_sha,
      signal: readSignal,
    }),
  ]);
  const classification = classifyCommitStatus({
    requiredChecks,
    checkRuns,
    statuses,
  });
  // At the deadline an indecisive picture is reported as unconfirmed, still
  // naming the checks that already failed.
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
  // required check is still running: the notice names the complete set.
  if (!isDecisiveFailure(classification)) {
    return undecided();
  }
  return { result: ciResults.failure, failedChecks: classification.failed };
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
 * different effects (a plain `unknown` and an unconfirmed failure), so the note identity is not only update and commit.
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
function noticeFor({ watch, outcome, requiredChecks }) {
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
    case ciResults.failure:
      return {
        person: ciReports.failure,
        note: ciNoteReports.failure({
          ...common,
          failedChecks: outcome.failedChecks,
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
  recordTrace = () => {},
  // The text of a notice is an effect the next turn of the topic must know.
  recordServiceNote,
  // Whether the topic of a watch has another instruction queued, running or
  // of unknown result, which may have published a newer commit.
  hasWorkInProgress,
  logger = () => {},
  now = () => new Date(),
}) {
  // The delay of each watch whose notice failed. It lives in memory: a restart
  // retries at once.
  const sendRetries = new Map();

  function postponeSend(updateIdentifier) {
    const previousDelay = sendRetries.get(updateIdentifier)?.delay;
    const delay = Math.min(
      previousDelay === undefined
        ? pollIntervalMilliseconds
        : previousDelay * 2,
      maximumRetryDelayMilliseconds,
    );
    sendRetries.set(updateIdentifier, {
      delay,
      retryAt: now().getTime() + delay,
    });
  }

  /**
   * Send the notice of an outcome and end the watch. A failed send leaves it
   * pending, so a later cycle retries it.
   */
  async function deliver(watch, outcome, { signal } = {}) {
    // A watch superseded during the reads produces no notice, so it must not
    // add a note or overwrite the last text of the topic either.
    if (store.state(watch.update_identifier) !== "pending") return;
    // A publication pushes before it registers the watch that supersedes this
    // one: a moved head is only reported once the topic has no work left.
    if (
      outcome.result === ciResults.headChanged &&
      hasWorkInProgress({
        sessionKey: watch.session_key,
        updateIdentifier: watch.update_identifier,
      })
    ) {
      return;
    }
    const { chatIdentifier, threadIdentifier } = parseSessionKey(
      watch.session_key,
    );
    const notice = noticeFor({ watch, outcome, requiredChecks });
    // The effect is decided here, so the topic keeps it even when the send
    // fails: the next turn of its session must know it. The note keeps the
    // technical facts the person never reads.
    try {
      recordServiceNote({
        sessionKey: watch.session_key,
        text: notice.note,
        effectKey: `ci:${watch.update_identifier}:${watch.commit_sha}:${noticeKind(outcome)}`,
      });
    } catch (error) {
      // The notice matters more than its note: a store failure is logged and
      // never costs the delivery.
      logger("ci_note_failed", error instanceof Error ? error.name : "unknown");
    }
    // The publication already told the person the change is saved: the green
    // result stays in the service note and the private trace, so the same
    // sentence does not arrive twice.
    if (outcome.result !== ciResults.success) {
      try {
        await telegram.sendMessage({
          chatIdentifier,
          messageThreadIdentifier: threadIdentifier,
          text: notice.person,
          signal,
        });
      } catch (error) {
        logger(
          "ci_notification_failed",
          `${describe(watch)} ${error instanceof Error ? error.name : "unknown"}`,
        );
        postponeSend(watch.update_identifier);
        return;
      }
      // The notice says the case is noted for the maintainer: this trace and
      // journal line make that true.
      safeTrace({
        updateIdentifier: watch.update_identifier,
        sessionKey: watch.session_key,
        action: maintainerAttentionAction,
        detail: noticeKind(outcome),
      });
      logger(maintainerAttentionAction, noticeKind(outcome));
    }
    store.finishSend(watch.update_identifier, outcome.result);
    sendRetries.delete(watch.update_identifier);
    logger(
      "ci_notification_sent",
      describeNotice(watch, outcome, requiredChecks),
    );
  }

  function logFailure(error) {
    logger("ci_watch_failed", error instanceof Error ? error.name : "unknown");
  }

  /**
   * The notice matters; a failed trace line does not. It is logged instead of
   * stopping the cycle.
   */
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

  /** One cycle over the pending watches. */
  async function runOnce({ signal } = {}) {
    for (const watch of store.pending()) {
      if (signal?.aborted) return;
      const retryAt = sendRetries.get(watch.update_identifier)?.retryAt;
      if (retryAt !== undefined && now().getTime() < retryAt) continue;
      try {
        const outcome = await evaluateWatch({
          watch,
          github,
          requiredChecks,
          watchTimeoutMilliseconds,
          requestTimeoutMilliseconds,
          now,
          signal,
        });
        if (outcome !== null) {
          await deliver(watch, outcome, { signal });
        }
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
