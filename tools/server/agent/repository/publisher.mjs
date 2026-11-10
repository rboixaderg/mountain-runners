// Trusted remote publication. The workflow passes public metadata, not tokens
// or GitHub API details. Unknown remote effects still throw and are not retried.

import { PublishRefusedError } from "./github.mjs";
import { recordPublication } from "./worktrees.mjs";

export function createPublisher({ github, secrets }) {
  return async function publishChange({ worktree, branch, title, body }) {
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
    });
    recordPublication(worktree, pushed.commit);
    return { created, pullRequest, commit: pushed.commit };
  };
}
