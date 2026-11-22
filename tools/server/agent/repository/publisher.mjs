// Trusted remote publication. The workflow passes public metadata, not tokens
// or GitHub API details. Unknown remote effects still throw and are not retried.
// The instruction signal reaches every remote read and write, so a stop ends the
// publication instead of holding the single global execution.

import { PublishRefusedError } from "./github.mjs";
import { recordPublication } from "./worktrees.mjs";

export function createPublisher({ github, secrets }) {
  /**
   * A repair never creates a pull request: it pushes only while the pull
   * request it continues is still open at the failed commit, and it does not
   * report a publication when that pull request disappeared meanwhile.
   *
   * `onPublicationStarted` runs immediately before the first remote write, so
   * the caller only treats the instruction as possibly published from that
   * point on.
   */
  return async function publishChange({
    worktree,
    branch,
    title,
    body,
    repair,
    signal,
    onPublicationStarted,
  }) {
    if (repair) {
      let pullRequest;
      try {
        pullRequest = await github.getPullRequest({
          number: repair.pullRequestNumber,
          signal,
        });
      } catch (error) {
        // A stop ends the instruction without a refusal report. Anything else
        // is a local failure: nothing has reached GitHub yet.
        if (signal?.aborted) {
          throw error;
        }
        return { refused: true, readFailed: true };
      }
      if (
        pullRequest.state !== "open" ||
        pullRequest.headSha !== repair.commit
      ) {
        return { refused: true };
      }
    }
    let pushed;
    try {
      onPublicationStarted?.();
      pushed = await github.pushBranch({ worktree, branch, secrets, signal });
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
      signal,
    });
    // Only a publication with its pull request is recorded: a repair whose pull
    // request disappeared meanwhile is a refusal, not a publication the service
    // must follow.
    if (pullRequest === null) {
      return { refused: true };
    }
    recordPublication(worktree, pushed.commit);
    // The label that asks for the preview is set once, when the service opens
    // the pull request; an existing pull request is never labelled again. A
    // label that cannot be set never undoes the publication: the caller says so.
    let previewLabelFailed = false;
    if (created) {
      try {
        await github.addPreviewLabel({ number: pullRequest.number, signal });
      } catch {
        previewLabelFailed = true;
      }
    }
    return {
      created,
      pullRequest,
      commit: pushed.commit,
      previewLabelFailed,
    };
  };
}
