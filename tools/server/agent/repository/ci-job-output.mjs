import { projectSteps } from "./ci-failure.mjs";

// GitHub job steps have second-resolution boundaries. Exclude both boundary
// seconds so output cannot be attributed to either neighbouring step by guess.
const timestampedLine =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s(.*)$/u;

/** Extract ungrouped output strictly inside the one failed project step. */
export function projectOutputFromJobLog({ job, log }) {
  if (!Array.isArray(job?.steps) || typeof log !== "string") return "";
  const failed = job.steps.filter((step) => step.conclusion === "failure");
  if (failed.length !== 1 || !projectSteps.has(failed[0].name)) return "";
  const start = Date.parse(failed[0].started_at ?? "");
  const end = Date.parse(failed[0].completed_at ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return "";
  let groupDepth = 0;
  let commandGroupSeen = false;
  let commandGroupClosed = false;
  const output = [];
  for (const line of log.split("\n")) {
    const match = timestampedLine.exec(line);
    if (!match) continue;
    const instant = Date.parse(match[1]);
    if (!(instant >= start && instant < end)) continue;
    const message = match[2];
    if (message.startsWith("##[group]")) {
      groupDepth += 1;
      commandGroupSeen = true;
      continue;
    }
    if (message.startsWith("##[endgroup]")) {
      if (groupDepth === 0) return "";
      groupDepth -= 1;
      if (commandGroupSeen && groupDepth === 0) commandGroupClosed = true;
      continue;
    }
    if (
      instant > start &&
      commandGroupClosed &&
      groupDepth === 0 &&
      !message.startsWith("##[") &&
      message.trim() !== ""
    ) {
      output.push(message);
    }
  }
  if (groupDepth !== 0 || !commandGroupClosed) return "";
  return output.join("\n");
}
