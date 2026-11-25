// Build topic state for the sandbox. The live reader uses GitHub for the pull
// request, checks and trusted preview confirmation.

import { mergeStates } from "../repository/merge-request-store.mjs";
import { pullRequestReviewUrl } from "../policy/development.mjs";
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
  repositoryName,
  github,
  requiredChecks,
  logger = () => {},
}) {
  return async function readTopicState(
    sessionKey,
    { continuedPullRequestNumber = null, signal } = {},
  ) {
    // A closed or merged pull request stays in the answer: the state block still
    // describes the change the topic last worked on.
    const number =
      continuedPullRequestNumber ??
      ciWatches.topicPullRequestNumber(sessionKey);
    if (number === null) return { liveState: { noPullRequest: true } };
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
        sessionKey,
        pullRequestNumber: number,
      });
      return {
        liveState: {
          url: pullRequestReviewUrl({
            repository: repositoryName,
            pullRequestNumber: number,
          }),
          state: confirmed.merged ? "merged" : confirmed.state,
          head: confirmed.headSha,
          checks: live.classification.state,
          hasUnreportedWork: ciWatches.hasUnreportedWork(sessionKey),
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
