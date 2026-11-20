// Build topic state for the sandbox. The live reader uses GitHub for the pull
// request, checks and trusted preview confirmation. The original store reader
// remains while the remaining T8.9 workflow changes are in progress.

import { mergeStates } from "../repository/merge-request-store.mjs";
import { previewStates } from "../repository/preview-request-store.mjs";
import { pullRequestReviewUrl } from "../policy/development.mjs";
import { ciResults } from "./ci-watch.mjs";
import { readLivePullRequest } from "../repository/github.mjs";
import { confirmedPreviewOrigin } from "../repository/preview-comment.mjs";

const ciResultDescriptions = {
  [ciResults.success]: "green",
  [ciResults.failure]: "failed",
  [ciResults.repairing]: "failing, and an automatic repair is running",
  [ciResults.repairNotRun]: "failed, and no automatic repair will run",
  [ciResults.repairBlocked]: "failed, with the automatic repair blocked",
  [ciResults.repairLimit]: "failed, and the automatic repairs are exhausted",
  [ciResults.unknown]: "not confirmed in time",
  [ciResults.headChanged]:
    "not reported, because the head of the pull request changed",
  [ciResults.pullRequestClosed]:
    "not reported, because the pull request is closed",
};

const previewDescriptions = {
  [previewStates.commenting]: "the request is being posted",
  [previewStates.awaiting]: "waiting for the trusted publisher to confirm it",
  [previewStates.confirmed]: "confirmed",
  [previewStates.timedOut]: "not confirmed in time",
  [previewStates.failed]: "the preview failed",
  [previewStates.uncertain]: "the result is unknown",
};

const mergeDescriptions = {
  [mergeStates.merging]: "in progress",
  [mergeStates.merged]: "merged",
  [mergeStates.failed]: "rejected by GitHub",
  [mergeStates.uncertain]: "the result is unknown",
  [mergeStates.notMerged]: "not merged",
};

function describeState(descriptions, state) {
  return descriptions[state] ?? `reported as ${state}`;
}

/**
 * The pull request the topic published last and still owns, read from the CI
 * watches, or null. Without those watches the service knows none.
 *
 * `includeEnded` keeps a closed or merged pull request in the answer: the state
 * block still describes the change the topic last worked on. The classifier
 * asks for the open view instead, so it never receives a pull request that can
 * no longer be continued as the topic's active one.
 */
export function createTopicPullRequestFinder(
  ciWatches,
  { includeEnded = true, mergeRequests = null } = {},
) {
  return function findTopicPullRequest(sessionKey) {
    const publications = ciWatches.latestPublications();
    const owned = publications.find(
      (publication) =>
        publication.session_key === sessionKey && publication.is_owner_latest,
    );
    if (owned === undefined) {
      return null;
    }
    if (includeEnded) {
      return owned.pull_request_number;
    }
    if (owned.delivered_result === ciResults.pullRequestClosed) {
      return null;
    }
    const merge = mergeRequests?.latest({
      sessionKey,
      pullRequestNumber: owned.pull_request_number,
    });
    return merge?.state === mergeStates.merged
      ? null
      : owned.pull_request_number;
  };
}

export function createLiveTopicStateReader({
  ciWatches,
  previewRequests,
  findTopicPullRequest,
  repositoryName,
  github,
  requiredChecks,
}) {
  return async function readTopicState(
    sessionKey,
    { continuedPullRequestNumber = null, signal } = {},
  ) {
    const number =
      continuedPullRequestNumber ?? findTopicPullRequest(sessionKey);
    if (number === null) return { liveState: { noPullRequest: true } };
    const source =
      ciWatches.latestPublication(number)?.session_key ?? sessionKey;
    try {
      const live = await readLivePullRequest({
        github,
        number,
        requiredChecks,
        signal,
      });
      const request = previewRequests.latest({
        sessionKey: source,
        pullRequestNumber: number,
      });
      let preview = "no preview requested for the current change";
      let origin = null;
      if (
        request?.commit_sha === live.pullRequest.headSha &&
        request.commented_at
      ) {
        const comments = await github.listIssueComments({
          number,
          since: request.commented_at,
          signal,
        });
        origin = confirmedPreviewOrigin({
          comments,
          pullRequestNumber: number,
          commit: live.pullRequest.headSha,
          requestedAt: request.commented_at,
        });
        preview = origin ? "confirmed" : "not confirmed by the publisher";
      }
      const confirmed = await github.getPullRequest({ number, signal });
      if (
        confirmed.headSha !== live.pullRequest.headSha ||
        confirmed.state !== live.pullRequest.state ||
        confirmed.merged !== live.pullRequest.merged
      ) {
        throw new Error("The pull request changed while reading its preview.");
      }
      return {
        liveState: {
          url: pullRequestReviewUrl({
            repository: repositoryName,
            pullRequestNumber: number,
          }),
          state: confirmed.merged ? "merged" : confirmed.state,
          fromAnotherTopic: source !== sessionKey,
          head: confirmed.headSha,
          checks: live.classification.state,
          preview,
          origin,
        },
      };
    } catch {
      signal?.throwIfAborted();
      return { liveState: { unavailable: true } };
    }
  };
}

export function createTopicStateReader({
  ciWatches,
  previewRequests,
  mergeRequests,
  findTopicPullRequest,
  repositoryName,
}) {
  /**
   * The topic whose facts describe the pull request: this one, or the topic that
   * published the pull request this turn continues.
   */
  function sourceOf(sessionKey, continuedPullRequestNumber) {
    if (continuedPullRequestNumber === null) {
      return { sessionKey, fromAnotherTopic: false };
    }
    const owner =
      ciWatches.latestPublication(continuedPullRequestNumber)?.session_key ??
      null;
    if (owner === null || owner === sessionKey) {
      return { sessionKey, fromAnotherTopic: false };
    }
    return { sessionKey: owner, fromAnotherTopic: true };
  }

  /**
   * The last notice delivered for this pull request. Every fact of the block
   * belongs to the pull request it prints: a notice of another pull request of
   * the same topic describes a different change.
   */
  function lastReportedOf(sessionKey, pullRequestNumber) {
    const reported = ciWatches.lastReportedForPullRequest({
      sessionKey,
      pullRequestNumber,
    });
    if (reported === undefined) {
      return { row: undefined, described: null };
    }
    return {
      row: reported,
      described: {
        commit: reported.commit_sha,
        description: describeState(ciResultDescriptions, reported.result),
      },
    };
  }

  /**
   * Whether the preview request describes the change the block prints for this
   * pull request. It does when it was pinned to the reported commit, or to a head
   * newer than it: the handler always pins the live head, so a request made after
   * the reported notice belongs to a newer commit of the same change. A request
   * made before that notice belongs to an earlier change, even when it was
   * confirmed. The update identifier is the order in which the service handled
   * both, and it is the tiebreak the stores already use.
   */
  function describesReportedChange({ reported, preview }) {
    if (reported === undefined) {
      // Nothing is reported for this pull request, so no request is older than a
      // notice and the newest one describes it.
      return true;
    }
    if (preview.commit_sha === reported.commit_sha) {
      return true;
    }
    return preview.update_identifier > reported.update_identifier;
  }

  /**
   * The preview of this pull request and the origin the publisher confirmed for
   * it. A later request for the same commit does not remove a confirmation. A
   * confirmation of an earlier change is reported without a URL because it
   * describes a result the pull request no longer has, and one stored before the
   * origin was kept says that its link is not stored.
   */
  function previewOf({ source, pullRequestNumber, lastReported }) {
    const preview = previewRequests.latest({
      sessionKey: source,
      pullRequestNumber,
    });
    if (preview === undefined) {
      return null;
    }
    const reported = lastReported.described;
    const confirmed =
      reported === null
        ? null
        : previewRequests.confirmedOrigin({
            sessionKey: source,
            pullRequestNumber,
            commitSha: reported.commit,
          });
    if (confirmed !== null) {
      return {
        description: previewDescriptions[previewStates.confirmed],
        origin: confirmed,
      };
    }
    if (!describesReportedChange({ reported: lastReported.row, preview })) {
      // A request of an earlier change is not the preview of the reported one:
      // the block never presents it as the state of this change.
      if (preview.state !== previewStates.confirmed) {
        return null;
      }
      return {
        description:
          "confirmed for an earlier change, so this block holds no URL for the reported commit",
        origin: null,
      };
    }
    // The request belongs to the printed change: it is the reported commit or the
    // newer head the handler pinned instead of it.
    const previewOrigin = previewRequests.confirmedOrigin({
      sessionKey: source,
      pullRequestNumber,
      commitSha: preview.commit_sha,
    });
    if (previewOrigin !== null) {
      return {
        description: previewDescriptions[previewStates.confirmed],
        origin: previewOrigin,
      };
    }
    if (preview.state !== previewStates.confirmed) {
      return {
        description: describeState(previewDescriptions, preview.state),
        origin: null,
      };
    }
    return {
      description: "confirmed, but its link is not stored",
      origin: null,
    };
  }

  return function readTopicState(
    sessionKey,
    { continuedPullRequestNumber = null } = {},
  ) {
    const source = sourceOf(sessionKey, continuedPullRequestNumber);
    const pullRequestNumber =
      continuedPullRequestNumber ?? findTopicPullRequest(sessionKey);
    if (pullRequestNumber === null) {
      return {
        pullRequest: null,
        lastReported: null,
        hasUnreportedWork: ciWatches.hasUnreportedWork(source.sessionKey),
        preview: null,
        merge: null,
      };
    }
    const lastReported = lastReportedOf(source.sessionKey, pullRequestNumber);
    const merge = mergeRequests.latest({
      sessionKey: source.sessionKey,
      pullRequestNumber,
    });
    return {
      pullRequest: {
        url: pullRequestReviewUrl({
          repository: repositoryName,
          pullRequestNumber,
        }),
        fromAnotherTopic: source.fromAnotherTopic,
        isClosed: lastReported.row?.result === ciResults.pullRequestClosed,
        isMerged: merge?.state === mergeStates.merged,
      },
      lastReported: lastReported.described,
      hasUnreportedWork: ciWatches.hasUnreportedWork(source.sessionKey),
      preview: previewOf({
        source: source.sessionKey,
        pullRequestNumber,
        lastReported,
      }),
      merge:
        merge === undefined
          ? null
          : {
              description: describeState(mergeDescriptions, merge.state),
              mergeCommit: merge.merge_commit_sha ?? null,
            },
    };
  };
}
