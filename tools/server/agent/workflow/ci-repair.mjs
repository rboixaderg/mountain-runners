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
  // The text of a report is an effect the next turn of the topic must know.
  recordServiceNote = () => {},
  logger = () => {},
}) {
  // Set when a result could not be stored: the `running` row blocks every
  // later claim until a restart, so each report from then on says so.
  let queueStalled = false;

  /**
   * Tell the topic what happened. The note is only the service-written part of
   * the text (`noteText`), because the model's own words already live in its
   * session and a note is presented as trusted service data. `state` gives the
   * report a durable identity, so a repeated report of the same attempt never
   * duplicates the effect.
   */
  async function report(
    repair,
    reportText,
    { signal, state, noteText = reportText } = {},
  ) {
    const suffix = queueStalled ? `\n\n${ciRepairReports.queueStalled}` : "";
    const text = `${reportText}${suffix}`;
    recordServiceNote({
      sessionKey: repair.session_key,
      text: `${noteText}${suffix}`,
      receivedText: text,
      // `sequence` is a row identity that `resetRepairs` can reuse, so the
      // effect is named after columns that survive it: the update, the commit
      // and the moment the attempt was created.
      effectKey: `repair:${repair.update_identifier}:${repair.commit_sha}:${repair.created_at}:${state}`,
    });
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

  function trace(repair, action, detail) {
    try {
      recordTrace({
        updateIdentifier: repair.update_identifier,
        sessionKey: repair.session_key,
        action,
        detail,
      });
    } catch (error) {
      // The notice to the topic matters more than the trace.
      logger(
        "ci_trace_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  /** Close the durable attempt first, then tell the topic what happened. */
  function close(repair, { status, outcome, traceAction, detail }) {
    const description = detail ?? describe(repair);
    try {
      repairs.finishRepair(repair.sequence, { status, outcome });
    } catch (error) {
      // The attempt stays `running`, which blocks the queue on purpose: the
      // result is not durable, so the next start reconciles it as `uncertain`
      // and it is never retried automatically. The trace keeps the real result
      // and the close failure, and the topic learns that repairs are paused.
      queueStalled = true;
      logger(
        "ci_repair_close_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    trace(repair, traceAction, description);
    if (queueStalled) {
      trace(repair, "ci_repair_close_failed", description);
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
        await report(repair, ciRepairReports.interrupted(common), {
          state: "interrupted",
        });
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
      await report(repair, ciRepairReports.stateUnknown(common), {
        signal,
        state: "state_unknown",
      });
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
      await report(repair, ciRepairReports.notApplicable(common), {
        signal,
        state: "not_applicable",
      });
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
        await report(repair, ciRepairReports.interrupted(common), {
          state: "interrupted",
        });
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
          return {
            state: "checks_unreadable",
            text: ciRepairReports.checksUnreadable(common),
          };
        }
        if (classification.state === "success") {
          return {
            state: "checks_not_failing",
            text: ciRepairReports.checksNotFailing(common),
          };
        }
        return {
          state: "checks_not_decisive",
          text: ciRepairReports.checksNotDecisive(common),
        };
      })();
      await report(repair, notice.text, { signal, state: notice.state });
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
        error instanceof Error ? error.name : "unknown",
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
      await report(repair, ciRepairReports.uncertain(common), {
        state: "uncertain",
      });
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
        {
          signal,
          state: "published",
          // The note keeps only what the service wrote about the publication:
          // the pull request, the branch, the published commit and the local
          // checks. The model's words stay in the text of the topic.
          noteText: ciRepairReports.publishedNote({
            pullRequestNumber: repair.pull_request_number,
            publicationNote: result.serviceText ?? null,
          }),
        },
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
        {
          signal,
          state: "unchanged",
          // Only the service sentence is the note: the detail is the model's
          // own explanation and stays in its session.
          noteText: ciRepairReports.unchangedNotice(common),
        },
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
      await report(repair, ciRepairReports.interrupted(common), {
        state: "interrupted",
      });
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
      { signal, state: "failed" },
    );
    return true;
  }

  return { runNext };
}
