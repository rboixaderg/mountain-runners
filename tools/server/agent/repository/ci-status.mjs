import { clipText } from "../policy/development.mjs";

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

// Check output is public CI text, but it is still untrusted input for the model
// and private durable state: clip it and drop terminal colour codes.
const maximumDetailLength = 1200;
const terminalColourPattern = new RegExp(String.raw`\u001B\[[0-9;]*m`, "gu");

function withoutTerminalColour(value) {
  return typeof value === "string"
    ? value.replace(terminalColourPattern, "").trim()
    : value;
}

function clipped(value) {
  return clipText(withoutTerminalColour(value), maximumDetailLength);
}

function timestamp(entry) {
  return Date.parse(entry.created_at ?? "");
}

/** Keep the newest commit status of each context; equal times stay ambiguous. */
function latestStatusPerContext(statuses) {
  const latest = new Map();
  const ambiguous = new Set();
  // A context whose timestamps cannot be read can never become the newest one
  // with confidence: a later readable row does not recover it.
  const unreadable = new Set();
  for (const status of statuses) {
    const previous = latest.get(status.context);
    if (previous === undefined) {
      latest.set(status.context, status);
      if (!Number.isFinite(timestamp(status))) {
        unreadable.add(status.context);
        ambiguous.add(status.context);
      }
      continue;
    }
    const previousTime = timestamp(previous);
    const currentTime = timestamp(status);
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
      unreadable.add(status.context);
      ambiguous.add(status.context);
    } else if (currentTime > previousTime) {
      latest.set(status.context, status);
      if (!unreadable.has(status.context)) {
        ambiguous.delete(status.context);
      }
    } else if (currentTime === previousTime) {
      ambiguous.add(status.context);
    }
  }
  return { latest, ambiguous };
}

/**
 * A failure that can be acted on: every required check is present, finished and
 * unambiguous, and at least one failed. A repair must never start from a
 * partial picture of the CI.
 */
export function isDecisiveFailure(classification) {
  return (
    classification.failed.length > 0 &&
    classification.pending.length === 0 &&
    classification.missing.length === 0 &&
    classification.ambiguous.length === 0
  );
}

/**
 * Identify the same failure across commits: the set of failing required checks.
 * The message and the commit are evidence and attempts, not identity, so a
 * re-run or a new commit cannot reset the automatic repair budget.
 */
export function failureFingerprint(failedChecks) {
  return JSON.stringify([...failedChecks].sort());
}

/**
 * Bounded, human-readable evidence of every failing required check, taken from
 * the raw check runs and commit statuses of the exact commit.
 *
 * @returns {{name: string, detail: string}[]}
 */
export function describeFailedChecks({ failedChecks, checkRuns, statuses }) {
  const details = new Map();
  for (const checkRun of checkRuns) {
    if (!failedChecks.includes(checkRun.name) || details.has(checkRun.name)) {
      continue;
    }
    const detail = clipped(
      [checkRun.output?.title, checkRun.output?.summary]
        .filter((part) => typeof part === "string")
        .join("\n"),
    );
    if (detail !== "") {
      details.set(checkRun.name, detail);
    }
  }
  const { latest } = latestStatusPerContext(statuses);
  for (const name of failedChecks) {
    if (details.has(name)) {
      continue;
    }
    const detail = clipped(latest.get(name)?.description);
    if (detail !== "") {
      details.set(name, detail);
    }
  }
  return failedChecks.map((name) => ({
    name,
    detail: details.get(name) ?? "",
  }));
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
