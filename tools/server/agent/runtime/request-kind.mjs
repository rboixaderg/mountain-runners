// Interpret only the verified person's current request. This ephemeral model
// call has no history, repository context, skills, extensions or tools. It does
// not accept instructions discovered while reading repository content.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runProjectPrompt } from "./pi-adapter.mjs";
import {
  buildClassificationPrompt,
  parseRequestKind,
} from "../policy/development.mjs";

export async function classifyRequest(
  config,
  { instruction, signal, environment },
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
    message: buildClassificationPrompt(instruction),
  });
  if (result.timedOut || result.aborted) {
    throw new Error("The request classification did not complete.");
  }
  return parseRequestKind(result.text);
}
