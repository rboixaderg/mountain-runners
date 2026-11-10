// Assemble the trusted profile and run one topic turn. The workflow chooses
// the prompt and read-only mode; this module owns the Pi-specific setup.

import { join } from "node:path";
import { preparePiProfile } from "./profile.mjs";
import { runProjectPrompt } from "./pi-adapter.mjs";

export async function runAgent(config, context) {
  const profileDirectory = await preparePiProfile({
    profileRoot: join(config.paths.state, "profiles"),
    sessionIdentifier: context.sessionIdentifier,
  });
  return runProjectPrompt({
    config,
    profileDirectory,
    sessionIdentifier: context.sessionIdentifier,
    message: context.message,
    readOnly: context.readOnly,
    worktreePath: context.worktreePath,
    signal: context.signal,
  });
}
