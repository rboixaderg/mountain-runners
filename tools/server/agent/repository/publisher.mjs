// Trusted remote publication. The workflow passes public metadata, not tokens
// or GitHub API details. Unknown remote effects still throw and are not retried.
// The instruction signal reaches every remote read and write, so a stop ends the
// publication instead of holding the single global execution.

import {
  GitHubResponseError,
  PublicationBaseChangedError,
  PublishRefusedError,
} from "./github.mjs";
import { sleep } from "./request-signal.mjs";
import { PublicationRuleError } from "./secret-scan.mjs";
import { recordPublication } from "./worktrees.mjs";

const synchronizationRetryDelays = [1000, 2000, 4000, 8000, 16_000];

function isTransientReadError(error) {
  if (error instanceof GitHubResponseError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError || error?.name === "TimeoutError";
}

function synchronizationEligible(pullRequest, branch, repository) {
  return (
    pullRequest.state === "open" &&
    pullRequest.headRef === branch &&
    pullRequest.headRepository?.toLowerCase() === repository.toLowerCase() &&
    pullRequest.baseRef === "main" &&
    !pullRequest.draft &&
    pullRequest.previewLabeled &&
    !pullRequest.previewRevoked
  );
}

async function confirmSynchronizedPullRequest({
  github,
  repair,
  commit,
  branch,
  repository,
  signal,
}) {
  for (const delay of [0, ...synchronizationRetryDelays]) {
    if (delay > 0) await sleep(delay, signal);
    signal?.throwIfAborted();
    let pullRequest;
    try {
      pullRequest = await github.getPullRequest({
        number: repair.pullRequestNumber,
        signal,
      });
    } catch (error) {
      if (signal?.aborted || !isTransientReadError(error)) throw error;
      continue;
    }
    signal?.throwIfAborted();
    if (!synchronizationEligible(pullRequest, branch, repository)) break;
    if (pullRequest.headSha === commit) {
      return { ...pullRequest, number: repair.pullRequestNumber };
    }
    if (pullRequest.headSha !== repair.commit) break;
  }
  throw new Error("The updated pull request cannot be confirmed.");
}

export function createPublisher({
  github,
  secrets,
  researchReview,
  repository,
}) {
  /**
   * `repair` names the pull request a publication continues. Such a publication
   * never creates a pull request: it pushes only while that pull request is
   * still open at the expected commit, and it does not report a publication
   * when the pull request disappeared meanwhile.
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
    researchJobId,
    signal,
    onPublicationStarted,
    validated,
  }) {
    const synchronization = repair?.synchronization;
    repair = repair && {
      pullRequestNumber: repair.pullRequestNumber,
      commit: repair.commit,
    };
    let approved;
    {
      try {
        if (!researchReview) throw new Error("Research review is unavailable.");
        if (typeof researchJobId !== "string" || !researchJobId)
          throw new Error("A stable research job ID is required.");
        const tainted = await researchReview.isTainted(researchJobId);
        if (tainted !== true && tainted !== false)
          throw new Error("Invalid research state.");
        if (tainted) {
          const candidate = await github.researchCandidate({
            worktree,
            branch,
            title,
            body,
            repair,
            signal,
          });
          if (
            candidate.branch !== branch ||
            candidate.title !== title ||
            candidate.body !== body ||
            typeof title !== "string" ||
            typeof body !== "string"
          )
            throw new Error(
              "The candidate metadata does not match the publication.",
            );
          const reviewId = await researchReview.prepare(
            researchJobId,
            candidate,
          );
          if (repair && candidate.expectedHead !== repair.commit)
            return {
              refused: true,
              reason:
                "The work branch on GitHub is not at the expected commit.",
            };
          if (
            (await researchReview.isApproved(researchJobId, reviewId)) !== true
          ) {
            return { refused: true, reviewId };
          }
          approved = candidate;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        return { refused: true, readFailed: true };
      }
    }
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
        pullRequest.headSha !== repair.commit ||
        (synchronization &&
          !synchronizationEligible(pullRequest, branch, repository))
      ) {
        return {
          refused: true,
          reason:
            "The pull request is no longer open at the expected commit or cannot be updated.",
        };
      }
    }
    let pushed;
    try {
      pushed = await github.pushBranch({
        worktree,
        branch,
        secrets,
        signal,
        onPublicationStarted,
        ...(approved ? { approved } : {}),
        ...(validated ? { validated, expectedHead: repair?.commit } : {}),
      });
    } catch (error) {
      if (error instanceof PublicationBaseChangedError)
        return { baseChanged: true };
      if (error instanceof PublishRefusedError) {
        // Only a publication rule has a message written for the topic; any other
        // cause may carry raw Git or GitHub output.
        return {
          refused: true,
          reason:
            error.cause instanceof PublicationRuleError
              ? error.cause.message
              : "A preflight check before the push failed.",
        };
      }
      throw error;
    }
    const { pullRequest, created } = synchronization
      ? {
          pullRequest: await confirmSynchronizedPullRequest({
            github,
            repair,
            commit: pushed.commit,
            branch,
            repository,
            signal,
          }),
          created: false,
        }
      : await github.ensurePullRequest({
          branch,
          title,
          body,
          createMissing: !repair,
          signal,
        });
    // Only a publication with its pull request is recorded: a continuation whose
    // pull request disappeared meanwhile is a refusal, not a publication the service
    // must follow.
    if (pullRequest === null) {
      return {
        refused: true,
        reason: "The pull request disappeared during the publication.",
      };
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
