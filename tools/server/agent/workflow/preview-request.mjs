// Deterministic `/preview` on request (T8.4).
//
// A verified person asks in natural language for the preview of the pull
// request the topic reported as green. The model is never started for it: the
// service re-reads the pull request and its required checks, pins the request to
// the current head of that open pull request, posts the constant `/preview`
// comment with its own GitHub credential and then waits for the trusted
// publisher of phase 6 to confirm it. The head can be newer than the commit the
// topic reported, because a maintainer may have updated the pull request
// outside the agent; the preview is bound anyway to that exact head commit and
// only to it. The URL is never built or guessed: only the publisher's own
// comment, written after the request and naming the pinned commit, is reported.
//
// Waiting also reads the runs of the preview workflow (T8.8): a run that ended
// badly ends the request as failed and says so in plain words, instead of
// letting the person wait for a preview that will never be published. Only the
// runs that the service's own identity started are considered, and the publisher
// comment is read first: a run never confirms an address, and the comment is what
// binds the URL to the commit.
//
// The author's membership is asked again when the request runs, as the merge
// does: a preview publishes the pull request, so it is not ordinary queued work.
//
// Nothing here runs without a request: a green CI, a new pull request or a
// repair publication never asks for a preview.

import { parseSessionKey } from "telegram-pi-bridge/sessions";
import {
  isDefiniteRejection,
  isPermissionRejection,
  statusClass,
} from "../repository/github.mjs";
import { classifyCommitStatus } from "../repository/ci-status.mjs";
import { confirmedPreviewOrigin } from "../repository/preview-comment.mjs";
import {
  previewBeginResults,
  previewStates,
} from "../repository/preview-request-store.mjs";
import {
  defaultRequestTimeoutMilliseconds,
  requestSignal,
  sleep,
} from "../repository/request-signal.mjs";
import {
  previewCommand,
  previewNotes,
  previewReports,
  previewRunsRetryMilliseconds,
  pullRequestReviewUrl,
} from "../policy/development.mjs";

const refusals = {
  membershipRevoked: "membership_revoked",
  membershipUnavailable: "membership_unavailable",
  noReportedCommit: "no_reported_commit",
  newerWork: "newer_work",
  alreadyInProgress: "already_in_progress",
  alreadyHandled: "already_handled",
  notApplicable: "not_applicable",
  notMainRepository: "not_main_repository",
  checksNotGreen: "checks_not_green",
  unreadable: "unreadable",
};

function describeTarget({ pullRequestNumber, commit }) {
  return `#${pullRequestNumber} ${commit.slice(0, 7)}`;
}

/**
 * The window in which a run can belong to each request, read from every request
 * that posted its `/preview` comment. A request's window starts at its own
 * comment and ends at the comment of the next request, whatever state that
 * request is in: a request that already ended still separates the runs of its
 * neighbours, so the bounds never move and never leave a gap.
 *
 * GitHub timestamps have second granularity, so two requests of the same second
 * share their window. They are resolved by request identifier, which is the
 * order in which the service posted the comments: the request with the lower
 * identifier takes the first run of that burst (`rank`), the next one takes the
 * second, and so on. Runs are ordered by creation time and then by run
 * identifier. The order is a best available guess that GitHub gives us no
 * comment on a run to remove: a wrong match can only end a request as failed,
 * never confirm an address, because the publisher comment is read first and is
 * the only source of the URL.
 *
 * A comment whose instant cannot be read belongs to no window: guessing one
 * would attribute a run to the wrong request.
 */
function previewRunWindows(requests) {
  const ordered = requests
    .filter((request) => Number.isFinite(Date.parse(request.commented_at)))
    .sort((left, right) => {
      const byComment =
        Date.parse(left.commented_at) - Date.parse(right.commented_at);
      return byComment === 0
        ? left.update_identifier - right.update_identifier
        : byComment;
    });
  const windows = new Map();
  let burstStart = 0;
  while (burstStart < ordered.length) {
    const from = Date.parse(ordered[burstStart].commented_at);
    let burstEnd = burstStart;
    while (
      burstEnd < ordered.length &&
      Date.parse(ordered[burstEnd].commented_at) === from
    ) {
      burstEnd += 1;
    }
    // The next comment of another request that is strictly later; the request
    // of the same second belongs to the same burst and does not bound it.
    const until =
      burstEnd < ordered.length ? ordered[burstEnd].commented_at : null;
    for (let index = burstStart; index < burstEnd; index += 1) {
      windows.set(ordered[index].update_identifier, {
        from: ordered[index].commented_at,
        until,
        rank: index - burstStart,
      });
    }
    burstStart = burstEnd;
  }
  return windows;
}

/**
 * The run that decides the request. Only runs that the service's own identity
 * started count: the workflow runs for every new comment of every pull request,
 * so a run of another person's `/preview` is never a result of this request.
 * The runs inside the window are ordered first and the one of this request's
 * `rank` is taken; only then is its status read. A run still queued or running
 * is no result yet, and it never lets a later run of its burst speak for this
 * request. A run ordered after that first one changes nothing. Runs are ordered
 * by creation time and, on an equal timestamp, by run identifier, so the order
 * never depends on the order GitHub returns.
 */
function endedPreviewRun({ runs, window, serviceLogin }) {
  if (window === undefined) return null;
  const from = Date.parse(window.from);
  const until = window.until === null ? null : Date.parse(window.until);
  // A bound that cannot be read says nothing: never guess a window from it.
  if (!Number.isFinite(from)) return null;
  if (until !== null && !Number.isFinite(until)) return null;
  const candidates = runs
    .filter((run) => run.event === "issue_comment")
    .filter(
      (run) =>
        run.actor === serviceLogin || run.triggeringActor === serviceLogin,
    )
    .filter((run) => {
      const createdAt = Date.parse(run.createdAt);
      if (!Number.isFinite(createdAt)) return false;
      if (createdAt < from) return false;
      return until === null || createdAt < until;
    })
    .sort((left, right) => {
      const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return byTime === 0 ? left.identifier - right.identifier : byTime;
    });
  const run = candidates[window.rank];
  if (run === undefined || run.status !== "completed") return null;
  if (run.conclusion === "success" || run.conclusion === null) return null;
  return run;
}

/**
 * The earliest instant at which an awaiting request posted its comment, or
 * `null` when none can be read. It bounds every read a cycle needs: the windows
 * of the awaiting requests, and the runs the service may have started for them.
 */
function earliestCommentInstant(rows) {
  const earliest = rows.reduce((moment, row) => {
    const comment = Date.parse(row.commented_at);
    return Number.isFinite(comment) && comment < moment ? comment : moment;
  }, Number.POSITIVE_INFINITY);
  return Number.isFinite(earliest) ? new Date(earliest).toISOString() : null;
}

export function createPreviewRequests({
  store,
  reportedCommits,
  verifyMembership,
  github,
  repository,
  requiredChecks,
  telegram,
  pollIntervalMilliseconds,
  confirmationTimeoutMilliseconds,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
  recordTrace = () => {},
  // The text of a report is an effect the next turn of the topic must know.
  recordServiceNote = () => {},
  logger = () => {},
  now = () => new Date(),
}) {
  function safeTrace(entry) {
    try {
      recordTrace(entry);
    } catch (error) {
      logger(
        "preview_trace_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  function refuse(request, reason, text, detail) {
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_refused",
      detail: detail ?? reason,
    });
    return { outcome: "answered", report: text };
  }

  /**
   * Re-read the live state of the topic's pull request and choose the commit the
   * preview is bound to: its current head. Any picture that is not clearly green
   * on the main repository's open pull request is a refusal, and the refusal
   * carries the commit it was decided for, so every trace names it.
   */
  async function findRefusal(target, signal) {
    const readSignal = requestSignal(signal, requestTimeoutMilliseconds);
    const pullRequest = await github.getPullRequest({
      number: target.pullRequestNumber,
      signal: readSignal,
    });
    if (pullRequest.state !== "open") {
      return { refusal: refusals.notApplicable, commit: target.commit };
    }
    if (
      pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()
    ) {
      return { refusal: refusals.notMainRepository, commit: target.commit };
    }
    // The head is the commit the publisher builds and the comment names, even
    // when it was updated outside the agent after the reported notice.
    const commit = pullRequest.headSha;
    const [checkRuns, statuses] = await Promise.all([
      github.getCommitCheckRuns({ commit, signal: readSignal }),
      github.getCommitStatuses({ commit, signal: readSignal }),
    ]);
    const classification = classifyCommitStatus({
      requiredChecks,
      checkRuns,
      statuses,
    });
    return {
      refusal:
        classification.state === "success" ? null : refusals.checksNotGreen,
      commit,
    };
  }

  const refusalTexts = {
    [refusals.notApplicable]: previewReports.notApplicable,
    [refusals.notMainRepository]: previewReports.notMainRepository,
    [refusals.checksNotGreen]: previewReports.checksNotGreen,
    [refusals.unreadable]: previewReports.unreadable,
  };

  /** The instruction runner calls this for a request classified as `preview`. */
  async function handle(request, { signal } = {}) {
    const reported = reportedCommits.lastReported(request.sessionKey);
    if (reported === undefined) {
      return refuse(
        request,
        refusals.noReportedCommit,
        previewReports.noReportedCommit,
      );
    }
    const target = {
      pullRequestNumber: reported.pull_request_number,
      commit: reported.commit_sha,
    };
    const reviewUrl = pullRequestReviewUrl({
      repository,
      pullRequestNumber: target.pullRequestNumber,
    });
    // A publication newer than the reported notice, including one whose notice
    // was never confirmed, owns the topic: the older commit can no longer be
    // previewed. The refusal names that newer work, never the notice that was
    // already reported.
    const newerWork = reportedCommits.newestUnreportedWork(request.sessionKey);
    if (newerWork !== undefined) {
      const beingPrepared = newerWork.kind === "repair";
      const detail = beingPrepared
        ? `${refusals.newerWork} #${newerWork.pull_request_number} repair`
        : `${refusals.newerWork} #${newerWork.pull_request_number} ${newerWork.commit_sha.slice(0, 7)}`;
      return refuse(
        request,
        refusals.newerWork,
        previewReports.newerWork({
          reviewUrl: pullRequestReviewUrl({
            repository,
            pullRequestNumber: newerWork.pull_request_number,
          }),
          beingPrepared,
        }),
        detail,
      );
    }
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_requested",
      detail: describeTarget(target),
    });

    const membership = await verifyMembership(request.authorIdentifier, signal);
    // A service stop is an abort, not a refusal; a read that ran out of its own
    // deadline is a failed check below and asks the person to try again.
    signal?.throwIfAborted();
    if (!membership.verified) {
      if (membership.reason === "membership_check_failed") {
        return refuse(
          request,
          refusals.membershipUnavailable,
          previewReports.membershipUnavailable({ reviewUrl }),
        );
      }
      return refuse(
        request,
        refusals.membershipRevoked,
        previewReports.membershipRevoked({ reviewUrl }),
      );
    }
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_membership_verified",
      detail: describeTarget(target),
    });

    let decision;
    try {
      decision = await findRefusal(target, signal);
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "preview_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      decision = { refusal: refusals.unreadable, commit: target.commit };
    }
    if (decision.refusal !== null) {
      const refusedTarget = { ...target, commit: decision.commit };
      return refuse(
        request,
        decision.refusal,
        refusalTexts[decision.refusal]({ reviewUrl }),
        `${decision.refusal} ${describeTarget(refusedTarget)}`,
      );
    }

    // Every later step — the stored row, the comment, the confirmation, the
    // traces and the note — uses this commit, so the preview stays bound to the
    // exact SHA whose required checks were read.
    const previewTarget = { ...target, commit: decision.commit };

    const begun = store.begin({
      updateIdentifier: request.updateIdentifier,
      sessionKey: request.sessionKey,
      authorIdentifier: request.authorIdentifier,
      pullRequestNumber: previewTarget.pullRequestNumber,
      commitSha: previewTarget.commit,
    });
    if (begun === previewBeginResults.duplicate) {
      return refuse(
        request,
        refusals.alreadyHandled,
        previewReports.alreadyHandled({ reviewUrl }),
        `${refusals.alreadyHandled} ${describeTarget(previewTarget)}`,
      );
    }
    if (begun === previewBeginResults.open) {
      return refuse(
        request,
        refusals.alreadyInProgress,
        previewReports.alreadyInProgress({ reviewUrl }),
        `${refusals.alreadyInProgress} ${describeTarget(previewTarget)}`,
      );
    }

    let comment;
    try {
      comment = await github.commentOnPullRequest({
        number: previewTarget.pullRequestNumber,
        body: previewCommand,
        signal: requestSignal(signal, requestTimeoutMilliseconds),
      });
    } catch (error) {
      if (isDefiniteRejection(error)) {
        store.markFailed(request.updateIdentifier);
        logger("preview_comment_failed", error.name);
        safeTrace({
          updateIdentifier: request.updateIdentifier,
          authorIdentifier: request.authorIdentifier,
          sessionKey: request.sessionKey,
          action: "preview_failed",
          detail: `${describeTarget(previewTarget)} HTTP ${statusClass(error.status)}`,
        });
        return {
          outcome: "answered",
          report: previewReports.failed({ reviewUrl }),
        };
      }
      // The comment may or may not exist: it is never posted again blindly.
      store.markUncertain(request.updateIdentifier);
      logger(
        "preview_comment_uncertain",
        error instanceof Error ? error.name : "unknown",
      );
      safeTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: "preview_uncertain",
        detail: describeTarget(previewTarget),
      });
      return {
        outcome: "uncertain",
        report: previewReports.uncertain({ reviewUrl }),
      };
    }
    store.markAwaiting(request.updateIdentifier, comment.createdAt);
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "preview_commented",
      detail: describeTarget(previewTarget),
    });
    return {
      outcome: "answered",
      report: previewReports.requested({ reviewUrl }),
    };
  }

  /**
   * Whether the report reached Telegram. A failed send is retried by the next
   * cycle, so the note carries the identity of the effect: the session receives
   * it once, whatever the number of attempts. The note keeps the facts the next
   * turn of the model needs; the text sent to the topic stays plain.
   */
  async function report(row, text, { signal, state, note }) {
    const { chatIdentifier, threadIdentifier } = parseSessionKey(
      row.session_key,
    );
    // The note keeps the facts the next turn of the model needs, while the text
    // sent to the topic stays plain. `receivedText` is that plain reply, so the
    // last text of the topic reads as the person read it.
    recordServiceNote({
      sessionKey: row.session_key,
      text: note,
      receivedText: text,
      effectKey: `preview:${row.update_identifier}:${state}`,
    });
    try {
      await telegram.sendMessage({
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text,
        signal,
      });
      return true;
    } catch (error) {
      logger(
        "preview_report_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return false;
    }
  }

  /**
   * The runs of the preview workflow that the service itself triggered after the
   * oldest awaiting comment, or `null` when this cycle has to keep the publisher
   * comment alone. Reading runs needs `Actions: read` and a login to tell the
   * service's own comments apart; GitHub answers 403 or 404 without the
   * permission, and any other read failure hides the runs of one cycle. Neither
   * ends a request: the comment read and the deadline still run. A refusal by the
   * credential is asked again at most once an hour, so granting the permission
   * needs no restart.
   */
  let serviceLogin;
  let previewRunsRetryAfter = 0;

  async function readPreviewRuns({ createdSince, signal }) {
    if (now().getTime() < previewRunsRetryAfter) return null;
    if (createdSince === null) {
      logger("preview_run_read_failed", "invalid_comment_time");
      return null;
    }
    const boundedSignal = requestSignal(signal, requestTimeoutMilliseconds);
    if (serviceLogin === undefined) {
      try {
        serviceLogin = await github.getAuthenticatedLogin({
          signal: boundedSignal,
        });
      } catch (error) {
        // Without the identity of the service, no run can be attributed safely.
        // It is asked again with the same backoff as a refused read, so a
        // credential that cannot answer does not fill the log every cycle.
        previewRunsRetryAfter = now().getTime() + previewRunsRetryMilliseconds;
        logger(
          "preview_identity_read_failed",
          error instanceof Error ? error.name : "unknown",
        );
        return null;
      }
    }
    try {
      const runs = await github.listPreviewWorkflowRuns({
        createdSince,
        signal: boundedSignal,
      });
      return { runs, serviceLogin };
    } catch (error) {
      if (isPermissionRejection(error)) {
        previewRunsRetryAfter = now().getTime() + previewRunsRetryMilliseconds;
        logger("preview_runs_permission_denied", statusClass(error.status));
      } else {
        logger(
          "preview_run_read_failed",
          error instanceof Error ? error.name : "unknown",
        );
      }
      return null;
    }
  }

  /**
   * One cycle over the requests awaiting the trusted publisher. A row ends only
   * after its report was sent, so a failed send is retried on the next cycle. A
   * crash between the send and the end of the row can repeat the notice once:
   * that is accepted over losing it. A failed read never ends a row by itself,
   * and the deadline is applied only after a successful read of comments. The
   * confirmation is always validated against the request, never against a later
   * reconciliation: a publisher comment written after the request still confirms
   * it. The three endings share one shape: check the stop, send, finish the row,
   * record the trace. A successful send always finishes the row, because the
   * SQLite transition is safe during a shutdown and the notice was delivered.
   */
  async function runOnce({ signal } = {}) {
    const rows = store.awaiting();
    if (rows.length === 0) return;
    // One bound for the whole cycle: the windows of the awaiting requests and
    // the runs the service may have started for them. Earlier comments cannot
    // bound any of them, so the poll never loads the whole history.
    const createdSince = earliestCommentInstant(rows);
    // The window of a request is bounded by the comment of the next request,
    // including the ones that are not awaiting any more.
    const runWindows = previewRunWindows(
      store.commented({ since: createdSince }),
    );
    // A run list that cannot be read leaves this cycle with the publisher
    // comment alone, exactly as before T8.8: it never ends a request by itself.
    const previewRuns = await readPreviewRuns({ createdSince, signal });

    for (const row of rows) {
      if (signal?.aborted) return;
      const target = {
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
      };
      const reviewUrl = pullRequestReviewUrl({
        repository,
        pullRequestNumber: row.pull_request_number,
      });

      let comments;
      try {
        comments = await github.listIssueComments({
          number: row.pull_request_number,
          since: row.created_at,
          signal: requestSignal(signal, requestTimeoutMilliseconds),
        });
      } catch (error) {
        logger(
          "preview_confirmation_read_failed",
          error instanceof Error ? error.name : "unknown",
        );
        continue;
      }
      const origin = confirmedPreviewOrigin({
        comments,
        pullRequestNumber: row.pull_request_number,
        commit: row.commit_sha,
        requestedAt: row.created_at,
      });
      // The publisher's comment is read first and always wins: only it names the
      // address, and a run can never contradict a published preview.
      if (origin !== null) {
        if (signal?.aborted) return;
        const sent = await report(
          row,
          previewReports.confirmed({ origin, reviewUrl }),
          {
            signal,
            state: "confirmed",
            note: previewNotes.confirmed({ ...target, origin }),
          },
        );
        if (!sent) continue;
        // The state and the origin the publisher confirmed are written together:
        // a confirmation never ends without the URL, and the next turn of the
        // topic cannot read GitHub and never builds it.
        const ended = store.finish(
          row.update_identifier,
          previewStates.confirmed,
          origin,
        );
        if (!ended) continue;
        safeTrace({
          updateIdentifier: row.update_identifier,
          authorIdentifier: row.author_identifier,
          sessionKey: row.session_key,
          action: "preview_confirmed",
          detail: describeTarget(target),
        });
        continue;
      }

      const run =
        previewRuns === null
          ? null
          : endedPreviewRun({
              runs: previewRuns.runs,
              window: runWindows.get(row.update_identifier),
              serviceLogin: previewRuns.serviceLogin,
            });
      if (run !== null) {
        if (signal?.aborted) return;
        const sentFailedRun = await report(
          row,
          previewReports.failedRun({ reviewUrl }),
          {
            signal,
            state: "failed_run",
            note: previewNotes.failedRun({
              ...target,
              conclusion: run.conclusion,
            }),
          },
        );
        if (!sentFailedRun) continue;
        // The request ended as `failed`, the same state as a refused comment:
        // nothing was published and a later request is allowed. The trace keeps
        // which of the two it was and the run, so a person can check the match.
        const ended = store.finish(row.update_identifier, previewStates.failed);
        if (!ended) continue;
        safeTrace({
          updateIdentifier: row.update_identifier,
          authorIdentifier: row.author_identifier,
          sessionKey: row.session_key,
          action: "preview_failed_run",
          detail: `${describeTarget(target)} ${run.conclusion} run ${run.identifier}`,
        });
        continue;
      }

      const expired =
        now().getTime() - Date.parse(row.updated_at) >=
        confirmationTimeoutMilliseconds;
      if (!expired) continue;
      if (signal?.aborted) return;
      const sent = await report(
        row,
        previewReports.unconfirmed({ reviewUrl }),
        {
          signal,
          state: "unconfirmed",
          note: previewNotes.unconfirmed(target),
        },
      );
      if (!sent) continue;
      const ended = store.finish(row.update_identifier, previewStates.timedOut);
      if (!ended) continue;
      safeTrace({
        updateIdentifier: row.update_identifier,
        authorIdentifier: row.author_identifier,
        sessionKey: row.session_key,
        action: "preview_unconfirmed",
        detail: describeTarget(target),
      });
    }
  }

  /** Background loop. It returns only when the signal is aborted. */
  async function run({ signal } = {}) {
    while (!signal?.aborted) {
      try {
        await runOnce({ signal });
      } catch (error) {
        logger(
          "preview_worker_failed",
          error instanceof Error ? error.name : "unknown",
        );
      }
      await sleep(pollIntervalMilliseconds, signal);
    }
  }

  return { handle, runOnce, run };
}
