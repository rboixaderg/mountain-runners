// Build topic state for the sandbox. The live reader uses GitHub for the pull
// request, checks and trusted preview confirmation.

import { mergeStates } from "../repository/merge-request-store.mjs";
import { pullRequestReviewUrl } from "../policy/development.mjs";
import { ciResults } from "./ci-watch.mjs";
import {
  confirmPullRequestUnchanged,
  readLivePullRequest,
} from "../repository/github.mjs";
import { confirmedPreviewOrigin } from "../repository/preview-comment.mjs";

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

/**
 * The preview the state block describes. The label, not a request of the
 * topic, decides whether the head has one: only an open pull request that
 * carries `preview` and not `preview-revoked` does, so a revoked or ended
 * preview never keeps its address.
 */
function previewOf(pullRequest, comments, pullRequestNumber) {
  if (pullRequest.state !== "open") {
    return { preview: "none: the pull request is not open", origin: null };
  }
  if (pullRequest.previewRevoked) {
    return { preview: "revoked by a maintainer", origin: null };
  }
  if (!pullRequest.previewLabeled) {
    return {
      preview: "none: the pull request has no preview label",
      origin: null,
    };
  }
  const origin = confirmedPreviewOrigin({
    comments,
    pullRequestNumber,
    commit: pullRequest.headSha,
  });
  return {
    preview: origin ? "confirmed" : "not confirmed by the publisher yet",
    origin,
  };
}

export function createLiveTopicStateReader({
  ciWatches,
  mergeRequests,
  findTopicPullRequest,
  repositoryName,
  github,
  requiredChecks,
  logger = () => {},
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
      // The comments are read before the confirming read of the pull request,
      // so a preview withdrawn meanwhile is never described.
      const comments = await github.listIssueComments({ number, signal });
      const confirmed = await github.getPullRequest({ number, signal });
      confirmPullRequestUnchanged(live.pullRequest, confirmed);
      const merge = mergeRequests.latest({
        sessionKey: source,
        pullRequestNumber: number,
      });
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
          hasUnreportedWork: ciWatches.hasUnreportedWork(source),
          merge:
            merge === undefined
              ? null
              : {
                  description: describeState(mergeDescriptions, merge.state),
                  mergeCommit: merge.merge_commit_sha ?? null,
                },
          ...previewOf(confirmed, comments, number),
        },
      };
    } catch (error) {
      signal?.throwIfAborted();
      logger(
        "topic_state_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return { liveState: { unavailable: true } };
    }
  };
}
