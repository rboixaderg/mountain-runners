import { assertWorkBranch } from "../repository/worktrees.mjs";

export const topicJobMigrationReport =
  "No puc identificar amb seguretat la feina d'aquest tema. No he canviat res; ho ha de revisar la persona que manté el servei.";

// The watch history identifies service publications and their current owner.
// GitHub determines which of those publications are still open.
export function createTopicJobMigration({
  topicJobs,
  ciWatches,
  github,
  repositoryName,
}) {
  return async function migrateTopicJob(sessionKey, { signal } = {}) {
    if (topicJobs.bindingOf(sessionKey) !== null) return null;
    try {
      const candidates = ciWatches
        .latestPublications()
        .filter((publication) => publication.session_key === sessionKey);
      const open = [];
      for (const candidate of candidates) {
        const pullRequest = await github.getPullRequest({
          number: candidate.pull_request_number,
          signal,
        });
        if (pullRequest.state === "closed") continue;
        if (pullRequest.state !== "open") return topicJobMigrationReport;
        if (
          pullRequest.baseRef !== "main" ||
          pullRequest.headRepository?.toLowerCase() !==
            repositoryName.toLowerCase()
        ) {
          return topicJobMigrationReport;
        }
        open.push({
          branch: assertWorkBranch(pullRequest.headRef),
          pullRequestNumber: candidate.pull_request_number,
        });
      }
      if (open.length > 1) return topicJobMigrationReport;
      if (open.length === 1) topicJobs.bind({ sessionKey, ...open[0] });
      return null;
    } catch {
      signal?.throwIfAborted();
      return topicJobMigrationReport;
    }
  };
}
