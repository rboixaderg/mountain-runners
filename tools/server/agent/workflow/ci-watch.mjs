// Coordination of the CI notifications (T8.4).
//
// A publication registers one durable watch pinned to the exact pushed commit.
// The worker runs beside the Telegram bridge: it never blocks the instruction
// queue, it never claims a result it did not read, and it never sends a result
// automatically twice.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import { classifyCommitStatus } from "../repository/ci-status.mjs";
import { ciReports, ciWatchOutcomes } from "../policy/development.mjs";

const ciResults = {
  success: "success",
  failure: "failure",
  unknown: "unknown",
  headChanged: "head-changed",
  pullRequestClosed: "pull-request-closed",
};

// A read that never returns would stall every pending notice behind it.
const defaultRequestTimeoutMilliseconds = 30 * 1000;

function sleep(milliseconds, signal) {
  return new Promise((resolve) => {
    let timer;
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    if (signal?.aborted) {
      resolve();
      return;
    }
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
    // The signal may have aborted between the check and the listener.
    if (signal?.aborted) finish();
  });
}

function requestSignal(signal, milliseconds) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

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
      return ciWatchOutcomes.registered;
    } catch (error) {
      logger(
        "ci_watch_registration_failed",
        error instanceof Error ? error.message : "unknown",
      );
      return ciWatchOutcomes.unavailable;
    }
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
  if (
    classification.state !== "success" &&
    classification.state !== "failure"
  ) {
    const age = now().getTime() - Date.parse(watch.created_at);
    return age < watchTimeoutMilliseconds
      ? null
      : { result: ciResults.unknown };
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
  return {
    result:
      classification.state === "success"
        ? ciResults.success
        : ciResults.failure,
    failedChecks: classification.failed,
  };
}

function noticeFor({ watch, outcome, requiredChecks }) {
  const common = {
    pullRequestNumber: watch.pull_request_number,
    commit: watch.commit_sha,
  };
  switch (outcome.result) {
    case ciResults.success:
      return ciReports.success({ ...common, requiredChecks });
    case ciResults.failure:
      return ciReports.failure({
        ...common,
        failedChecks: outcome.failedChecks,
      });
    case ciResults.headChanged:
      return ciReports.headChanged({ ...common, headSha: outcome.headSha });
    case ciResults.pullRequestClosed:
      return ciReports.pullRequestClosed(common);
    default:
      return ciReports.unknown(common);
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
  logger = () => {},
  now = () => new Date(),
}) {
  async function deliver(watch, outcome, { signal } = {}) {
    let message;
    try {
      const { chatIdentifier, threadIdentifier } = parseSessionKey(
        watch.session_key,
      );
      message = {
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text: noticeFor({ watch, outcome, requiredChecks }),
      };
    } catch {
      // Nothing was sent, and the notice can never be produced: end the watch
      // without pretending the delivery reached Telegram.
      store.markUncertain(watch.update_identifier);
      logger("ci_notification_invalid", describe(watch));
      return;
    }

    if (!store.beginSend(watch.update_identifier, outcome.result)) {
      return;
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
      return;
    }
    store.finishSend(watch.update_identifier);
    logger("ci_notification_sent", outcome.result);
  }

  function logFailure(error) {
    logger(
      "ci_watch_failed",
      error instanceof Error ? error.message : "unknown",
    );
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
