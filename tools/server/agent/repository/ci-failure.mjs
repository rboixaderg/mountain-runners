export const failureKinds = /** @type {const} */ ({
  cancelled: "cancelled",
  timedOut: "timed_out",
  setupFailure: "setup_failure",
  realFailure: "real_failure",
  noOutput: "no_output",
});

/** @typedef {typeof failureKinds[keyof typeof failureKinds]} FailureKind */

export const rerunOutcomes = /** @type {const} */ ({
  waiting: "waiting",
  exhausted: "exhausted",
  unconfirmed: "unconfirmed",
});

// Names are the explicit setup steps in the repository's required workflows.
// A new setup step must be added here before its failure can be rerun.
/** @type {ReadonlySet<string>} */
export const setupSteps = new Set([
  "Set up job",
  "Check out repository",
  "Check out repository history",
  "Install pnpm",
  "Set up Node.js",
  "Install dependencies",
  "Install browser dependencies",
]);

// Only these known project steps may provide evidence for an automatic repair.
/** @type {ReadonlySet<string>} */
export const projectSteps = new Set([
  "Check project",
  "Run E2E suite",
  "Verify preview-only pages",
  "Validate commit messages",
]);

/**
 * Classify a completed required check from its matching workflow job. Missing or
 * inconsistent job data never authorizes a rerun or a model repair.
 *
 * @returns {FailureKind}
 */
export function classifyCiFailureStep({ checkRun, job }) {
  if (
    checkRun?.status !== "completed" ||
    job?.status !== "completed" ||
    checkRun.conclusion !== job.conclusion ||
    !Array.isArray(job.steps)
  ) {
    return failureKinds.noOutput;
  }
  if (checkRun.conclusion === failureKinds.cancelled)
    return failureKinds.cancelled;
  if (checkRun.conclusion === failureKinds.timedOut)
    return failureKinds.timedOut;
  if (checkRun.conclusion !== "failure") return failureKinds.noOutput;
  const failedSteps = job.steps.filter((step) => step.conclusion === "failure");
  if (failedSteps.length !== 1) return failureKinds.noOutput;
  const failedStep = failedSteps[0];
  if (setupSteps.has(failedStep.name)) {
    const earlierSteps = job.steps.slice(0, job.steps.indexOf(failedStep));
    const unverifiedPriorStep = earlierSteps.some(
      (step) =>
        step.conclusion !== "skipped" &&
        (!setupSteps.has(step.name) ||
          step.status !== "completed" ||
          step.conclusion !== "success"),
    );
    return unverifiedPriorStep
      ? failureKinds.noOutput
      : failureKinds.setupFailure;
  }
  return projectSteps.has(failedStep.name)
    ? failureKinds.realFailure
    : failureKinds.noOutput;
}

export function classifyCiFailure({ checkRun, job, projectOutput }) {
  const kind = classifyCiFailureStep({ checkRun, job });
  if (kind !== failureKinds.realFailure) return kind;
  return typeof projectOutput === "string" && projectOutput.trim() !== ""
    ? failureKinds.realFailure
    : failureKinds.noOutput;
}
