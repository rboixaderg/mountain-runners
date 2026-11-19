// The current state of one topic, built from the durable stores of the service.
//
// The model runs in a sandbox without network or credentials, so it cannot read
// the pull request, its required checks, the preview or the merge. Every turn
// receives instead the facts the service already holds, as data: the pull
// request the turn works on, the commit its topic reported last and the result,
// whether newer work is still being checked, the latest preview request and the
// latest merge request. Building it makes no call to GitHub.
//
// A turn that continues another topic's pull request reports that pull request
// and the facts of the topic that owns it, because this topic owns it only after
// its own publication registers the watch.
//
// The store states are internal names, so each one is described in plain words
// before it reaches the model. A state added later is still described instead of
// dropped. The preview URL comes only from the origin the trusted publisher
// confirmed for the commit that is still the reported head; the service never
// builds one.

import { mergeStates } from "../repository/merge-request-store.mjs";
import { previewStates } from "../repository/preview-request-store.mjs";
import { ciResults } from "./ci-watch.mjs";

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
 */
export function createTopicPullRequestFinder(ciWatches) {
  return function findTopicPullRequest(sessionKey) {
    const publications = ciWatches.latestPublications();
    const owned = publications.find(
      (publication) =>
        publication.session_key === sessionKey && publication.is_owner_latest,
    );
    return owned?.pull_request_number ?? null;
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
   * The preview of this pull request and the origin the publisher confirmed for
   * its reported commit. A later request for the same commit does not remove a
   * confirmation. A confirmation of an earlier change is reported without a URL
   * because it describes a result the pull request no longer has, and one stored
   * before the origin was kept says that its link is not stored.
   */
  function previewOf({ source, pullRequestNumber, lastReported }) {
    const preview = previewRequests.latest({
      sessionKey: source,
      pullRequestNumber,
    });
    if (preview === undefined) {
      return null;
    }
    const confirmed =
      lastReported === null
        ? null
        : previewRequests.confirmedOrigin({
            sessionKey: source,
            pullRequestNumber,
            commitSha: lastReported.commit,
          });
    if (confirmed !== null) {
      return {
        description: previewDescriptions[previewStates.confirmed],
        origin: confirmed,
      };
    }
    if (preview.state !== previewStates.confirmed) {
      return {
        description: describeState(previewDescriptions, preview.state),
        origin: null,
      };
    }
    if (lastReported !== null && preview.commit_sha === lastReported.commit) {
      return {
        description: "confirmed, but its link is not stored",
        origin: null,
      };
    }
    return {
      description:
        "confirmed for an earlier change, so this block holds no URL for the reported commit",
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
        url: `https://github.com/${repositoryName}/pull/${pullRequestNumber}`,
        fromAnotherTopic: source.fromAnotherTopic,
        isClosed: lastReported.row?.result === ciResults.pullRequestClosed,
        isMerged: merge?.state === mergeStates.merged,
      },
      lastReported: lastReported.described,
      hasUnreportedWork: ciWatches.hasUnreportedWork(source.sessionKey),
      preview: previewOf({
        source: source.sessionKey,
        pullRequestNumber,
        lastReported: lastReported.described,
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
