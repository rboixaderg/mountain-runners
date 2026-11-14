// Trusted remote publication. The workflow passes public metadata, not tokens
// or GitHub API details. Unknown remote effects still throw and are not retried.

import { PublishRefusedError } from "./github.mjs";
import { recordPublication } from "./worktrees.mjs";

export function createPublisher({ github, secrets }) {
  /**
   * A repair never creates a pull request: it pushes only while the pull
   * request it continues is still open at the failed commit, and it does not
   * report a publication when that pull request disappeared meanwhile.
   */
  return async function publishChange({
    worktree,
    branch,
    title,
    body,
    repair,
  }) {
    if (repair) {
      const pullRequest = await github.getPullRequest({
        number: repair.pullRequestNumber,
      });
      if (
        pullRequest.state !== "open" ||
        pullRequest.headSha !== repair.commit
      ) {
        return { refused: true };
      }
    }
    let pushed;
    try {
      pushed = await github.pushBranch({ worktree, branch, secrets });
    } catch (error) {
      if (error instanceof PublishRefusedError) {
        return { refused: true };
      }
      throw error;
    }
    const { pullRequest, created } = await github.ensurePullRequest({
      branch,
      title,
      body,
      createMissing: !repair,
    });
    recordPublication(worktree, pushed.commit);
    if (pullRequest === null) {
      return { refused: true };
    }
    return { created, pullRequest, commit: pushed.commit };
  };
}
