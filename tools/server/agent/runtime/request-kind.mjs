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
import { sleep } from "../repository/request-signal.mjs";
import {
  buildClassificationPrompt,
  parsePreviewAfterChange,
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

// A provider rate limit is transient and says nothing about the request, so the
// classification is asked again instead of failing the whole instruction. The
// waits stay short and every attempt draws from the same deadline.
export const classificationRetryDelaysMilliseconds = [2000, 5000];

// The provider error of a rate limit, as the transport reports it. It is the
// only failure worth asking again; any other error is the answer of the service.
const rateLimitPattern =
  /(?<![a-z0-9])(?:429|rate.?limit|too many requests)(?![a-z0-9])/iu;

function isRateLimit(errorMessage) {
  return (
    typeof errorMessage === "string" && rateLimitPattern.test(errorMessage)
  );
}

export async function classifyRequest(
  config,
  {
    instruction,
    context,
    signal,
    environment,
    retryDelaysMilliseconds = classificationRetryDelaysMilliseconds,
    runPrompt = runProjectPrompt,
    wait = sleep,
  },
) {
  const directory = join(config.paths.state, "request-classifier");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const message = buildClassificationPrompt(instruction, context);
  const deadline = Date.now() + classificationTimeoutMilliseconds(config);
  const classifyOnce = () =>
    runPrompt({
      config,
      profileDirectory: directory,
      worktreePath: directory,
      classifyOnly: true,
      environment,
      signal,
      timeoutMilliseconds: Math.max(1, deadline - Date.now()),
      message,
    });
  let result = await classifyOnce();
  for (const delayMilliseconds of retryDelaysMilliseconds) {
    if (!isRateLimit(result.errorMessage) || signal?.aborted) break;
    if (Date.now() + delayMilliseconds >= deadline) break;
    await wait(delayMilliseconds, signal);
    signal?.throwIfAborted();
    result = await classifyOnce();
  }
  // A rate limit that outlasted the retries is not an answer: reading its empty
  // text would silently turn the request into a clarification.
  if (result.timedOut || result.aborted || isRateLimit(result.errorMessage)) {
    throw new Error("The request classification did not complete.");
  }
  return {
    kind: parseRequestKind(result.text),
    previewAfterChange: parsePreviewAfterChange(result.text),
  };
}
