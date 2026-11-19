// Interpret only the verified person's current request. This ephemeral model
// call has no history, repository context, skills, extensions or tools. It does
// not accept instructions discovered while reading repository content.
//
// The topic context (the last reply of the agent, the pending local work and the
// pull request of the topic) is data the service reads read-only: it tells the
// classifier whether the request continues the conversation, and it is never a
// request.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runProjectPrompt } from "./pi-adapter.mjs";
import {
  buildClassificationPrompt,
  parseRequestKind,
} from "../policy/development.mjs";

// The classifier is one short question. A stalled model must not hold the
// instruction queue for the full execution deadline, so its own bound is far
// shorter and never exceeds the configured one.
export const maximumClassificationTimeoutMilliseconds = 60 * 1000;

export function classificationTimeoutMilliseconds(config) {
  return Math.min(
    maximumClassificationTimeoutMilliseconds,
    config.limits.executionTimeoutMs,
  );
}

export async function classifyRequest(
  config,
  { instruction, context, signal, environment },
) {
  const directory = join(config.paths.state, "request-classifier");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const result = await runProjectPrompt({
    config,
    profileDirectory: directory,
    worktreePath: directory,
    classifyOnly: true,
    environment,
    signal,
    timeoutMilliseconds: classificationTimeoutMilliseconds(config),
    message: buildClassificationPrompt(instruction, context),
  });
  if (result.timedOut || result.aborted) {
    throw new Error("The request classification did not complete.");
  }
  return parseRequestKind(result.text);
}
