// Continue a pull request from another topic (T8.4).
//
// A continuation that names one pull request with a whole `#<number>` token is
// parsed by the service, never by the model. The service reads the pull request
// and resumes it only when it is open, not a draft, based on `main`, taken from
// the configured repository, on a service work branch and published by the
// service itself. The topic of the most recent publication owns it, so the
// resume waits until that topic has nothing pending and no unreported work:
// two topics never write the same branch at the same time.
//
// The branch is released from every worktree that holds it, the session
// worktree is preserved like a new task and the branch is checked out at the
// current head. From there the instruction follows the normal path, publishes
// only into that pull request and, once GitHub confirms the push, the new topic
// registers its own watch and becomes the owner. The previous topic receives one
// short notice; a notice that cannot be sent is logged and traced, never failed.

import {
  assertWorkBranch,
  changeDiff,
  currentBranch,
  findSessionWorktree,
  headCommit,
  resumeWorkBranch,
} from "../repository/worktrees.mjs";
import {
  buildContinuationInstruction,
  continuationReports,
  shortCommit,
} from "../policy/development.mjs";

// A whole token: `#12`, never `issue#12`, `#12a` or `##12`.
const pullRequestNumberPattern = /(?<![\w#])#(\d+)(?!\w)/gu;
// The list is filtered by update time and the prompt keeps only the last
// comments, so every comment is read.
const everyCommentSince = new Date(0).toISOString();

const refusals = {
  multiplePullRequests: "multiple_pull_requests",
  unreadable: "unreadable",
  notOpen: "not_open",
  draft: "draft",
  notMainBase: "not_main_base",
  notMainRepository: "not_main_repository",
  notWorkBranch: "not_work_branch",
  notPublishedByService: "not_published_by_service",
  ownerBusy: "owner_busy",
  dirtyWorktree: "dirty_worktree",
  unpublishedCommits: "unpublished_commits",
  divergedBranch: "diverged_branch",
  movedHead: "moved_head",
};

const refusalReports = {
  [refusals.unreadable]: continuationReports.unreadable,
  [refusals.notOpen]: continuationReports.notOpen,
  [refusals.draft]: continuationReports.draft,
  [refusals.notMainBase]: continuationReports.notMainBase,
  [refusals.notMainRepository]: continuationReports.notMainRepository,
  [refusals.notWorkBranch]: continuationReports.notWorkBranch,
  [refusals.notPublishedByService]: continuationReports.notPublishedByService,
  [refusals.ownerBusy]: continuationReports.ownerBusy,
  [refusals.dirtyWorktree]: continuationReports.dirtyWorktree,
  [refusals.unpublishedCommits]: continuationReports.unpublishedCommits,
  [refusals.divergedBranch]: continuationReports.divergedBranch,
  [refusals.movedHead]: continuationReports.movedHead,
};

/** The distinct pull request numbers the text names, as whole tokens. */
function pullRequestNumbers(text) {
  const numbers = new Set();
  for (const match of text.matchAll(pullRequestNumberPattern)) {
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) {
      numbers.add(number);
    }
  }
  return [...numbers];
}

/** The GitHub comments reduced to the author and the text the prompt shows. */
function commentEntries(comments) {
  return comments.map((comment) => ({
    login: typeof comment?.user?.login === "string" ? comment.user.login : "",
    body: typeof comment?.body === "string" ? comment.body : "",
  }));
}

export function createCrossTopicContinuation({
  repositoryPath,
  worktreeRoot,
  identifiers,
  repositoryName,
  readPullRequest,
  readComments,
  readCiState,
  findOwner,
  hasPendingWork,
  notifyHandover = async () => {
    throw new Error("The handover notice has no transport.");
  },
  recordTrace = () => {},
  logger = () => {},
}) {
  function safeTrace(entry) {
    try {
      recordTrace(entry);
    } catch (error) {
      logger(
        "continuation_trace_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  function trace(request, action, detail) {
    safeTrace({
      updateIdentifier: request.updateIdentifier,
      sessionKey: request.sessionKey,
      action,
      detail,
    });
  }

  function refuse(request, pullRequestNumber, reason, headSha) {
    const detail =
      headSha === undefined
        ? `${reason} #${pullRequestNumber}`
        : `${reason} #${pullRequestNumber} ${shortCommit(headSha)}`;
    trace(request, "continuation_refused", detail);
    return {
      reason,
      report: refusalReports[reason]({ pullRequestNumber }),
    };
  }

  /**
   * Tell the previous owner that another topic continues its pull request. The
   * publication already reached GitHub, so a lost notice is logged and traced
   * and never fails the instruction.
   */
  async function notifyPreviousOwner({
    request,
    ownerSessionKey,
    pullRequestNumber,
    commit,
    signal,
  }) {
    if (ownerSessionKey === request.sessionKey) {
      return;
    }
    const detail = `#${pullRequestNumber} ${shortCommit(commit)}`;
    try {
      await notifyHandover({
        updateIdentifier: request.updateIdentifier,
        sessionKey: ownerSessionKey,
        pullRequestNumber,
        signal,
      });
    } catch (error) {
      logger(
        "continuation_handover_failed",
        error instanceof Error ? error.name : "unknown",
      );
      trace(request, "continuation_handover_failed", detail);
      return;
    }
    trace(request, "continuation_handover_notified", detail);
  }

  async function readContext({ pullRequestNumber, headSha, signal }) {
    const [comments, checks] = await Promise.all([
      readComments({
        number: pullRequestNumber,
        since: everyCommentSince,
        signal,
      }),
      readCiState({ commit: headSha, signal }),
    ]);
    return { comments: commentEntries(comments), checks };
  }

  /** Resolve, validate and resume the named pull request, or refuse it. */
  async function resume(
    request,
    pullRequestNumber,
    { signal, continueInPlace = false } = {},
  ) {
    let pullRequest;
    try {
      pullRequest = await readPullRequest({
        number: pullRequestNumber,
        signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "continuation_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return refuse(request, pullRequestNumber, refusals.unreadable);
    }
    signal?.throwIfAborted();
    // Every eligibility check reads this exact pull request: a branch name is
    // not an identity, so a fork with the same branch never resumes the work of
    // a pull request that the service published.
    if (pullRequest.state !== "open") {
      return refuse(
        request,
        pullRequestNumber,
        refusals.notOpen,
        pullRequest.headSha,
      );
    }
    if (pullRequest.draft) {
      return refuse(
        request,
        pullRequestNumber,
        refusals.draft,
        pullRequest.headSha,
      );
    }
    if (pullRequest.baseRef !== "main") {
      return refuse(
        request,
        pullRequestNumber,
        refusals.notMainBase,
        pullRequest.headSha,
      );
    }
    if (
      pullRequest.headRepository?.toLowerCase() !== repositoryName.toLowerCase()
    ) {
      return refuse(
        request,
        pullRequestNumber,
        refusals.notMainRepository,
        pullRequest.headSha,
      );
    }
    let branch;
    try {
      branch = assertWorkBranch(pullRequest.headRef);
    } catch {
      return refuse(
        request,
        pullRequestNumber,
        refusals.notWorkBranch,
        pullRequest.headSha,
      );
    }
    const owner = findOwner(pullRequestNumber);
    if (owner === undefined) {
      return refuse(
        request,
        pullRequestNumber,
        refusals.notPublishedByService,
        pullRequest.headSha,
      );
    }
    const worktreeName = identifiers.worktreeName(request.sessionKey);
    const worktree = await findSessionWorktree({
      repositoryPath,
      worktreeRoot,
      name: worktreeName,
      signal,
    });
    // The topic already has that branch: the pending work of the topic is the
    // pull request, and the existing same-topic path continues it. When the
    // service resumed the request for the topic's own pull request, that path
    // only applies at the head the pull request reports: an older local head is
    // resumed below, at the published head.
    if (
      worktree !== null &&
      (await currentBranch(worktree, { signal })) === branch
    ) {
      if (!continueInPlace) {
        return null;
      }
      if ((await headCommit(worktree, { signal })) === pullRequest.headSha) {
        // The validated pull request and head travel with the result: the
        // publication revalidates them and never opens another pull request.
        return {
          inPlace: true,
          pullRequestNumber,
          baseHeadSha: pullRequest.headSha,
        };
      }
    }
    if (
      hasPendingWork({
        sessionKey: owner.session_key,
        updateIdentifier: request.updateIdentifier,
      })
    ) {
      return refuse(
        request,
        pullRequestNumber,
        refusals.ownerBusy,
        pullRequest.headSha,
      );
    }
    let context;
    try {
      context = await readContext({
        pullRequestNumber,
        headSha: pullRequest.headSha,
        signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "continuation_read_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return refuse(
        request,
        pullRequestNumber,
        refusals.unreadable,
        pullRequest.headSha,
      );
    }
    signal?.throwIfAborted();
    const resumed = await resumeWorkBranch({
      repositoryPath,
      worktreeRoot,
      name: worktreeName,
      branch,
      headSha: pullRequest.headSha,
      newTaskSuffix: identifiers.changeSuffix(request.updateIdentifier),
      signal,
    });
    if (resumed.refusal !== undefined) {
      return refuse(
        request,
        pullRequestNumber,
        resumed.refusal,
        pullRequest.headSha,
      );
    }
    trace(
      request,
      "continuation_resumed",
      `#${pullRequestNumber} ${shortCommit(pullRequest.headSha)}`,
    );
    return {
      resume: {
        worktree: resumed.worktree,
        pullRequestNumber,
        baseHeadSha: pullRequest.headSha,
        instruction: buildContinuationInstruction({
          pullRequestNumber,
          branch,
          baseHeadSha: pullRequest.headSha,
          diff: await changeDiff({ worktree: resumed.worktree, signal }),
          comments: context.comments,
          checks: context.checks,
          request: request.instruction,
        }),
        notifyPublished: ({ commit, signal }) =>
          notifyPreviousOwner({
            request,
            ownerSessionKey: owner.session_key,
            pullRequestNumber,
            commit,
            signal,
          }),
        recordOwnerUnregistered: (commit) =>
          trace(
            request,
            "continuation_owner_unregistered",
            `#${pullRequestNumber} ${shortCommit(commit)}`,
          ),
      },
    };
  }

  /**
   * Prepare a continuation of another topic's pull request. Returns null when
   * the request must keep the existing behaviour: no number, or the pending
   * work of this same topic is the pull request it names.
   *
   * `unnamedTopicPullRequest` is the open pull request the service published in
   * this topic (T8.7). A continuation that names none resumes it with the same
   * checks, as if the request had named it. A pull request that is merged or
   * closed is no pending work of the topic, so the caller answers the request as
   * a consultation instead of refusing it.
   */
  return async function prepare(
    request,
    { signal, unnamedTopicPullRequest = null } = {},
  ) {
    const numbers = pullRequestNumbers(request.instruction);
    if (numbers.length > 1) {
      trace(request, "continuation_refused", refusals.multiplePullRequests);
      return { report: continuationReports.multiplePullRequests };
    }
    if (numbers.length > 0) {
      return resume(request, numbers[0], { signal });
    }
    if (unnamedTopicPullRequest === null) {
      return null;
    }
    const continued = await resume(request, unnamedTopicPullRequest, {
      signal,
      continueInPlace: true,
    });
    if (continued?.reason === refusals.notOpen) {
      return null;
    }
    return continued;
  };
}
