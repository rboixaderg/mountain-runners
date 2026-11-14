// Bounded automatic repair of a failing CI (T8.4).
//
// The CI worker reserves the attempt and reports it; this executor runs one
// queued repair when the instruction queue is idle. It therefore shares the
// single global execution with the instructions, the same timeouts, the same
// sandbox and the same publication path. A repair that does not succeed is a
// result, never a green check: the attempt is closed and reported, and nothing
// is retried automatically.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import { ciRepairReports, repairRequestKind } from "../policy/development.mjs";
import { isDecisiveFailure } from "../repository/ci-status.mjs";
import { requestSignal } from "../repository/request-signal.mjs";

const publishedOutcomes = new Set([
  "pull_request_created",
  "pull_request_updated",
]);

function describe(repair) {
  return `#${repair.pull_request_number} ${repair.commit_sha.slice(0, 7)}`;
}

/**
 * The request handed to the shared instruction runner. The runner resolves the
 * existing worktree, verifies the published commit and builds the prompt from
 * the stored evidence.
 */
export function repairRequestFor(repair) {
  return {
    kind: repairRequestKind,
    updateIdentifier: repair.update_identifier,
    sessionKey: repair.session_key,
    pullRequestNumber: repair.pull_request_number,
    commit: repair.commit_sha,
    failedChecks: JSON.parse(repair.failed_checks),
    evidence: JSON.parse(repair.evidence),
  };
}

export function createCiRepairExecutor({
  repairs,
  runInstruction,
  readPullRequest,
  readCiState,
  telegram,
  recordTrace = () => {},
  logger = () => {},
}) {
  async function report(repair, text, { signal } = {}) {
    try {
      const { chatIdentifier, threadIdentifier } = parseSessionKey(
        repair.session_key,
      );
      await telegram.sendMessage({
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text,
        signal,
      });
    } catch (error) {
      // The attempt is already closed; a lost report never repeats the work.
      logger(
        "ci_repair_report_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  /** Close the durable attempt first, then tell the topic what happened. */
  function close(repair, { status, outcome, traceAction, detail }) {
    try {
      repairs.finishRepair(repair.sequence, { status, outcome });
    } catch (error) {
      // The attempt stays `running` and nothing is repeated; the topic still
      // learns the result.
      logger(
        "ci_repair_close_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    try {
      recordTrace({
        updateIdentifier: repair.update_identifier,
        sessionKey: repair.session_key,
        action: traceAction,
        detail: detail ?? describe(repair),
      });
    } catch (error) {
      // The attempt is closed and the notice still matters more than the trace.
      logger(
        "ci_trace_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  /** Execute the next queued repair. Returns false when there is none. */
  async function runNext({ signal } = {}) {
    const repair = repairs.claimNextRepair();
    if (repair === null) {
      return false;
    }
    const common = {
      pullRequestNumber: repair.pull_request_number,
      commit: repair.commit_sha,
    };
    // The attempt may have waited in the queue: re-read the pull request before
    // touching the branch, so a closed or moved pull request is never repaired
    // and never gets a duplicate pull request.
    let pullRequest;
    try {
      pullRequest = await readPullRequest({
        pullRequestNumber: repair.pull_request_number,
        signal: requestSignal(signal),
      });
    } catch (error) {
      if (signal?.aborted) {
        close(repair, {
          status: "aborted",
          outcome: "aborted",
          traceAction: "ci_repair_aborted",
        });
        // The stop signal is already aborted: the notice needs its own attempt.
        await report(repair, ciRepairReports.interrupted(common));
        return true;
      }
      logger(
        "ci_repair_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      close(repair, {
        status: "done",
        outcome: "failed",
        traceAction: "ci_repair_not_published",
        detail: `${describe(repair)} pull request unreadable`,
      });
      await report(repair, ciRepairReports.stateUnknown(common), { signal });
      return true;
    }
    if (
      pullRequest.state !== "open" ||
      pullRequest.headSha !== repair.commit_sha
    ) {
      close(repair, {
        status: "done",
        outcome: "declined",
        traceAction: "ci_repair_not_published",
        detail: `${describe(repair)} not applicable`,
      });
      await report(repair, ciRepairReports.notApplicable(common), { signal });
      return true;
    }
    // The queued attempt may be old: repairing a commit whose required checks
    // no longer fail would publish a speculative change.
    let classification;
    try {
      classification = await readCiState({
        commit: repair.commit_sha,
        signal: requestSignal(signal),
      });
    } catch (error) {
      if (signal?.aborted) {
        close(repair, {
          status: "aborted",
          outcome: "aborted",
          traceAction: "ci_repair_aborted",
        });
        await report(repair, ciRepairReports.interrupted(common));
        return true;
      }
      logger(
        "ci_repair_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      classification = null;
    }
    if (
      classification?.state !== "failure" ||
      !isDecisiveFailure(classification)
    ) {
      close(repair, {
        status: "done",
        outcome: "declined",
        traceAction: "ci_repair_not_published",
        detail: `${describe(repair)} checks ${classification?.state ?? "unreadable"}`,
      });
      const notice = (() => {
        if (classification === null) {
          return ciRepairReports.checksUnreadable(common);
        }
        if (classification.state === "success") {
          return ciRepairReports.checksNotFailing(common);
        }
        return ciRepairReports.checksNotDecisive(common);
      })();
      await report(repair, notice, { signal });
      return true;
    }
    let result;
    try {
      result = await runInstruction(repairRequestFor(repair), { signal });
    } catch (error) {
      // The shared runner handles its own failures; an exception here leaves
      // the external result unknown and blocks the service until a person
      // reconciles it.
      logger(
        "ci_repair_failed",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
      );
      result = { outcome: "uncertain" };
    }

    if (result.outcome === "uncertain") {
      close(repair, {
        status: "uncertain",
        outcome: "uncertain",
        traceAction: "ci_repair_uncertain",
      });
      // The process may already be stopping: the uncertain result must reach
      // the topic anyway.
      await report(repair, ciRepairReports.uncertain(common));
      return true;
    }
    if (publishedOutcomes.has(result.outcome)) {
      close(repair, {
        status: "done",
        outcome: "published",
        traceAction: "ci_repair_published",
        detail: `${describe(repair)} ${result.outcome}`,
      });
      await report(
        repair,
        ciRepairReports.published({
          pullRequestNumber: repair.pull_request_number,
          report: result.report,
        }),
        { signal },
      );
      return true;
    }
    if (result.outcome === "answered") {
      close(repair, {
        status: "done",
        outcome: "declined",
        traceAction: "ci_repair_not_published",
        detail: `${describe(repair)} no change`,
      });
      await report(
        repair,
        ciRepairReports.unchanged({ ...common, detail: result.report }),
        { signal },
      );
      return true;
    }
    if (signal?.aborted) {
      close(repair, {
        status: "aborted",
        outcome: "aborted",
        traceAction: "ci_repair_aborted",
      });
      // The stop signal is already aborted: the notice uses its own transport
      // attempt, or the topic would never learn that the repair stopped.
      await report(repair, ciRepairReports.interrupted(common));
      return true;
    }
    close(repair, {
      status: "done",
      outcome: "failed",
      traceAction: "ci_repair_not_published",
    });
    await report(
      repair,
      ciRepairReports.failed({ ...common, detail: result.report }),
      { signal },
    );
    return true;
  }

  return { runNext };
}
