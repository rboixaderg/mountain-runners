// Assemble the trusted profile and run one topic turn. The workflow chooses
// the prompt; this module owns the Pi-specific setup.

import { join } from "node:path";
import { preparePiProfile } from "./profile.mjs";
import { runProjectPrompt } from "./pi-adapter.mjs";

export async function runAgent(config, context) {
  // The profile directory reaches Pi as PI_CODING_AGENT_DIR, so it carries the
  // opaque name. The private session identifier stays only in the history file.
  const profileDirectory = await preparePiProfile({
    profileRoot: join(config.paths.state, "profiles"),
    profileIdentifier: context.sandboxIdentifier,
  });
  // Pi receives the prompt immediately after this point. The effects the topic
  // has not been told yet are claimed here, at the last moment, so anything that
  // failed before it (sandbox preparation, profile preparation, an abort) leaves
  // them undelivered. Once claimed, the caller returns them only when the prompt
  // was never written: `onPromptSent` is that fact.
  context.signal?.throwIfAborted();
  const serviceNotes = context.claimServiceNotes();
  return runProjectPrompt({
    config,
    profileDirectory,
    sessionIdentifier: context.sessionIdentifier,
    sandboxIdentifier: context.sandboxIdentifier,
    message: context.buildMessage(serviceNotes),
    images: context.images ?? [],
    attachments: context.attachments ?? [],
    environment: context.environment,
    onPromptSent: context.onPromptSent,
    stopCommands: context.stopCommands,
    worktreePath: context.worktreePath,
    signal: context.signal,
    webResearch: context.webResearch,
  });
}
