// Telegram bridge process for the private agent (T8.3).
//
// Wires the trusted components together: Telegram transport, durable admission,
// Git/GitHub operations and the Pi runner. It never starts the model, the
// sandbox or the repository with the production services of phase 5 and 6.
//
// Startup refuses to continue when the previous execution left an unknown
// external result: an operator must inspect the real state first.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { AgentBridge, TelegramApi } from "telegram-pi-bridge/telegram";
import { bridgeMessages } from "../../policy/development.mjs";
import { readAgentConfig } from "../../config.mjs";
import { GitHubTrust } from "../../repository/github.mjs";
import { createProjectRunner } from "../../workflow/project-runner.mjs";
import { stopAllSandboxedCommands } from "../../sandbox/commands.mjs";

function defaultLogger(event, detail) {
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), event, detail: detail ?? null })}\n`,
  );
}

export async function startService({
  environment = process.env,
  signal,
  logger = defaultLogger,
  telegram: telegramOverride,
  github: githubOverride,
  runner: runnerOverride,
}) {
  const config = readAgentConfig(environment);
  for (const directory of [
    config.paths.state,
    config.paths.sessions,
    config.paths.worktrees,
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  const queue = new AdmissionQueue(
    join(config.paths.state, "admission.sqlite"),
    { maxPending: config.limits.maxPendingInstructions },
  );

  const recovered = queue.recover();
  if (recovered > 0) {
    queue.recordTrace({
      action: "startup_refused_uncertain",
      detail: String(recovered),
    });
    queue.close();
    throw new Error(
      `Refusing to start: ${recovered} interrupted instruction(s) have an unknown external result.`,
    );
  }

  const telegram =
    telegramOverride ?? new TelegramApi({ botToken: config.telegram.botToken });
  const identity = await telegram.getMe({ signal });
  if (
    typeof identity?.username !== "string" ||
    identity.username.toLowerCase() !==
      config.telegram.botUsername.toLowerCase()
  ) {
    queue.close();
    throw new Error(
      "The configured bot token does not match the bot username.",
    );
  }

  const github =
    githubOverride ??
    new GitHubTrust({
      token: config.github.token,
      repository: config.github.repository,
    });
  const runner =
    runnerOverride ??
    createProjectRunner({ config, github, environment, logger });

  const bridge = new AgentBridge({
    groupIdentifier: config.telegram.groupIdentifier,
    botUsername: config.telegram.botUsername,
    messages: bridgeMessages,
    telegram,
    queue,
    runInstruction: runner,
    botIdentifier: identity.id,
    logger,
  });

  return { config, queue, bridge, telegram, github, logger };
}

export async function main({ environment = process.env } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const { queue, bridge, logger } = await startService({
    environment,
    signal: controller.signal,
  });

  try {
    await bridge.run({ signal: controller.signal });
  } finally {
    await stopAllSandboxedCommands();
    queue.close();
    logger("service_stopped");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    defaultLogger(
      "service_failed",
      error instanceof Error ? error.message : "unknown",
    );
    process.exitCode = 1;
  });
}
