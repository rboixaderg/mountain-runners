// Classify the CI status of one commit from both GitHub check runs and legacy
// commit statuses.
//
// Only the names the configuration declares as required can make a commit
// green. A required check that is missing, reported twice (a re-run or two jobs
// with the same name) or finished with a conclusion other than success is never
// evidence of success. The result is always tied to the exact commit SHA it was
// read for.

const pendingStatuses = new Set([
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
]);

const failingStatusStates = new Set(["error", "failure"]);

function timestamp(entry) {
  return Date.parse(entry.created_at ?? "");
}

/** Keep the newest commit status of each context; equal times stay ambiguous. */
function latestStatusPerContext(statuses) {
  const latest = new Map();
  const ambiguous = new Set();
  for (const status of statuses) {
    const previous = latest.get(status.context);
    if (previous === undefined) {
      latest.set(status.context, status);
      if (!Number.isFinite(timestamp(status))) ambiguous.add(status.context);
      continue;
    }
    const previousTime = timestamp(previous);
    const currentTime = timestamp(status);
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
      ambiguous.add(status.context);
    } else if (currentTime > previousTime) {
      latest.set(status.context, status);
      ambiguous.delete(status.context);
    } else if (currentTime === previousTime) {
      ambiguous.add(status.context);
    }
  }
  return { latest, ambiguous };
}

/**
 * @returns {{state: "success"|"failure"|"pending"|"unknown", failed: string[],
 *   pending: string[], missing: string[], ambiguous: string[]}}
 */
export function classifyCommitStatus({ requiredChecks, checkRuns, statuses }) {
  const evidenceByName = new Map();
  const addEvidence = (name, evidence) => {
    const entries = evidenceByName.get(name) ?? [];
    entries.push(evidence);
    evidenceByName.set(name, entries);
  };

  for (const checkRun of checkRuns) {
    addEvidence(checkRun.name, {
      kind: "check-run",
      status: checkRun.status,
      conclusion: checkRun.conclusion,
    });
  }
  const { latest, ambiguous } = latestStatusPerContext(statuses);
  for (const [context, status] of latest) {
    addEvidence(context, { kind: "status", state: status.state });
  }

  const failed = [];
  const pending = [];
  const missing = [];
  const ambiguousNames = [];

  if (requiredChecks.length === 0) {
    return { state: "unknown", failed, pending, missing, ambiguous: [] };
  }

  for (const name of requiredChecks) {
    const evidence = evidenceByName.get(name) ?? [];
    if (ambiguous.has(name) || evidence.length > 1) {
      ambiguousNames.push(name);
      continue;
    }
    if (evidence.length === 0) {
      missing.push(name);
      continue;
    }
    const [entry] = evidence;
    if (entry.kind === "check-run") {
      if (entry.status !== "completed") {
        if (pendingStatuses.has(entry.status)) pending.push(name);
        else ambiguousNames.push(name);
      } else if (entry.conclusion === "success") {
        continue;
      } else if (typeof entry.conclusion === "string") {
        failed.push(name);
      } else {
        ambiguousNames.push(name);
      }
    } else if (entry.state === "success") {
      continue;
    } else if (entry.state === "pending") {
      pending.push(name);
    } else if (failingStatusStates.has(entry.state)) {
      failed.push(name);
    } else {
      ambiguousNames.push(name);
    }
  }

  if (failed.length > 0) {
    return {
      state: "failure",
      failed,
      pending,
      missing,
      ambiguous: ambiguousNames,
    };
  }
  if (pending.length > 0) {
    return {
      state: "pending",
      failed,
      pending,
      missing,
      ambiguous: ambiguousNames,
    };
  }
  if (missing.length > 0 || ambiguousNames.length > 0) {
    return {
      state: "unknown",
      failed,
      pending,
      missing,
      ambiguous: ambiguousNames,
    };
  }
  return { state: "success", failed, pending, missing, ambiguous: [] };
}
