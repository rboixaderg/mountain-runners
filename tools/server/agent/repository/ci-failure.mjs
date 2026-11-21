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
 * @returns {"cancelled"|"timed_out"|"setup_failure"|"real_failure"|"no_output"}
 */
export function classifyCiFailure({ checkRun, job, projectOutput }) {
  if (
    checkRun?.status !== "completed" ||
    job?.status !== "completed" ||
    checkRun.conclusion !== job.conclusion ||
    !Array.isArray(job.steps)
  ) {
    return "no_output";
  }
  if (checkRun.conclusion === "cancelled") return "cancelled";
  if (checkRun.conclusion === "timed_out") return "timed_out";
  if (checkRun.conclusion !== "failure") return "no_output";
  const failedSteps = job.steps.filter((step) => step.conclusion === "failure");
  if (failedSteps.length !== 1) return "no_output";
  const failedStep = failedSteps[0];
  if (setupSteps.has(failedStep.name)) {
    const projectStarted = job.steps.some(
      (step) =>
        projectSteps.has(step.name) &&
        step.status !== "skipped" &&
        step.conclusion !== "skipped",
    );
    return projectStarted ? "no_output" : "setup_failure";
  }
  if (
    projectSteps.has(failedStep.name) &&
    typeof projectOutput === "string" &&
    projectOutput.trim() !== ""
  ) {
    return "real_failure";
  }
  return "no_output";
}
