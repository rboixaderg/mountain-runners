// Warn the current topic about files that also appear in known active work
// (T8.4).
//
// The list is a local best effort: it comes from `ci_watches` and from Git, and
// GitHub is never asked. A pull request counts unless its latest delivered
// notice said it is closed; its branch can only be read when it is the newest
// publication of its owner topic, so an older pull request of a topic is
// skipped. A worktree of another topic counts as local work only with
// uncommitted changes or commits the service never published, and archived
// worktrees never count.
//
// The warning is private and short: it names the shared paths and the pull
// requests, never another topic, an author or a path outside the change. It
// never blocks, and the caller ignores and logs any error.

import { sessionIdentifier } from "telegram-pi-bridge/sessions";
import {
  assertWorkBranch,
  changedPathsAgainstMain,
  currentBranch,
  hasUnpublishedCommit,
  listChangedPaths,
  listOtherTopicWorktrees,
} from "../repository/worktrees.mjs";
import { ciResults } from "./ci-watch.mjs";
import { overlapWarningReport } from "../policy/development.mjs";

export function createOverlapWarning({
  repositoryPath,
  worktreeRoot,
  listPullRequests,
  recordTrace = () => {},
}) {
  /**
   * The work of a published pull request whose owner topic holds a work branch.
   * A branch the service never created is never attributed, so a foreign
   * worktree is not reported as this pull request.
   */
  async function publishedWork(
    published,
    { worktreesByTopic, branch, signal },
  ) {
    const ownerWorktree = worktreesByTopic.get(
      sessionIdentifier(published.session_key),
    );
    if (ownerWorktree === undefined) {
      return null;
    }
    let ownerBranch;
    try {
      ownerBranch = assertWorkBranch(
        await currentBranch(ownerWorktree, { signal }),
      );
    } catch {
      return null;
    }
    if (ownerBranch === branch) {
      return null;
    }
    return {
      pullRequestNumber: published.pull_request_number,
      paths: await changedPathsAgainstMain(ownerWorktree, { signal }),
    };
  }

  /** Uncommitted changes or commits the service never published. */
  async function hasPendingWork(worktree, { signal }) {
    return (
      (await listChangedPaths(worktree, { signal })).length > 0 ||
      (await hasUnpublishedCommit(worktree, { signal }))
    );
  }

  return async function warnAboutOverlaps({
    updateIdentifier,
    sessionKey,
    worktree,
    branch,
    continuedPullRequestNumber,
    signal,
  }) {
    const currentPaths = new Set(
      await changedPathsAgainstMain(worktree, { signal }),
    );
    const otherWorktrees = await listOtherTopicWorktrees({
      repositoryPath,
      worktreeRoot,
      excludeName: sessionIdentifier(sessionKey),
      signal,
    });
    const worktreesByTopic = new Map(
      otherWorktrees.map((entry) => [entry.name, entry.worktree]),
    );
    // A worktree is attributed to a known pull request only when that pull
    // request is reported from it, or when it is the work of the current
    // change. Any other topic keeps its pending work as a local work.
    const attributedTopics = new Set();
    const works = [];
    for (const published of listPullRequests()) {
      const ownerTopic = sessionIdentifier(published.session_key);
      if (published.session_key === sessionKey) {
        attributedTopics.add(ownerTopic);
        continue;
      }
      if (
        published.pull_request_number === continuedPullRequestNumber ||
        published.delivered_result === ciResults.pullRequestClosed ||
        !published.is_owner_latest
      ) {
        continue;
      }
      const work = await publishedWork(published, {
        worktreesByTopic,
        branch,
        signal,
      });
      if (work === null) {
        continue;
      }
      works.push(work);
      attributedTopics.add(ownerTopic);
    }
    for (const entry of otherWorktrees) {
      if (attributedTopics.has(entry.name)) {
        continue;
      }
      if (!(await hasPendingWork(entry.worktree, { signal }))) {
        continue;
      }
      works.push({
        pullRequestNumber: null,
        paths: await changedPathsAgainstMain(entry.worktree, { signal }),
      });
    }

    const overlappingPaths = new Set();
    const pullRequestNumbers = new Set();
    let localWorkCount = 0;
    for (const work of works) {
      const sharedPaths = work.paths.filter((path) => currentPaths.has(path));
      if (sharedPaths.length === 0) {
        continue;
      }
      for (const path of sharedPaths) {
        overlappingPaths.add(path);
      }
      if (work.pullRequestNumber === null) {
        localWorkCount += 1;
      } else {
        pullRequestNumbers.add(work.pullRequestNumber);
      }
    }
    if (overlappingPaths.size === 0) {
      return null;
    }
    const sortedNumbers = [...pullRequestNumbers].sort(
      (left, right) => left - right,
    );
    const detail = [
      ...sortedNumbers.map((number) => `#${number}`),
      `${localWorkCount} local`,
      `${overlappingPaths.size} paths`,
    ].join(" ");
    recordTrace({
      updateIdentifier,
      sessionKey,
      action: "overlap_warned",
      detail,
    });
    return overlapWarningReport({
      overlappingPaths: [...overlappingPaths].sort(),
      pullRequestNumbers: sortedNumbers,
      hasLocalWork: localWorkCount > 0,
    });
  };
}
