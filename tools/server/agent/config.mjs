// Private development agent configuration (T8.3).
//
// The trusted component reads every value once at startup and rejects an
// incomplete or unsafe configuration instead of falling back to a default.
// Secrets (Telegram bot token and GitHub token) live only in the trusted
// component environment: they are never written to the state directory, the
// session directory, the sandbox or the model prompt.
//
// Numeric resource limits are accepted here because the service needs a
// concrete value, but the ADR 0013 leaves them unproven until the VPS
// verification of T8.3. The defaults below are provisional.

import { isAbsolute } from "node:path";

export const repositoryPattern = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;
const groupIdentifierPattern = /^-\d+$/u;
const positiveIntegerPattern = /^[1-9]\d*$/u;

export const defaultLimits = {
  maxPendingInstructions: 10,
  executionTimeoutMs: 30 * 60 * 1000,
  sandboxMemoryMegabytes: 2048,
  sandboxCpuCount: 1,
  sandboxProcessLimit: 256,
};

function requiredValue(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required configuration value ${name}.`);
  }
  return value.trim();
}

function absolutePath(environment, name) {
  const value = requiredValue(environment, name);
  if (!isAbsolute(value)) {
    throw new Error(`Configuration value ${name} must be an absolute path.`);
  }
  return value;
}

function positiveInteger(environment, name, fallback) {
  const rawValue = environment[name];
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }
  if (!positiveIntegerPattern.test(rawValue)) {
    throw new Error(`Configuration value ${name} must be a positive integer.`);
  }
  return Number(rawValue);
}

function readNameList(environment, name) {
  const rawValue = environment[name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return [];
  }
  const names = rawValue.split(",").map((entry) => entry.trim());
  for (const entry of names) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(entry)) {
      throw new Error(`Configuration value ${name} contains an invalid name.`);
    }
  }
  return names;
}

export function readAgentConfig(environment = process.env) {
  const repository = requiredValue(environment, "MOUNTAIN_AGENT_REPOSITORY");
  if (!repositoryPattern.test(repository)) {
    throw new Error(
      "Configuration value MOUNTAIN_AGENT_REPOSITORY must be owner/name.",
    );
  }

  const baseBranch = environment.MOUNTAIN_AGENT_BASE_BRANCH?.trim() || "main";
  if (baseBranch !== "main") {
    throw new Error("The agent only targets the main base branch.");
  }

  const groupIdentifier = requiredValue(
    environment,
    "MOUNTAIN_AGENT_TELEGRAM_GROUP_ID",
  );
  if (!groupIdentifierPattern.test(groupIdentifier)) {
    throw new Error(
      "Configuration value MOUNTAIN_AGENT_TELEGRAM_GROUP_ID must be a negative group identifier.",
    );
  }

  const botUsername = requiredValue(
    environment,
    "MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME",
  ).replace(/^@/u, "");
  if (!/^[A-Za-z0-9_]{5,}$/u.test(botUsername)) {
    throw new Error(
      "Configuration value MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME must be a bot username.",
    );
  }

  return {
    telegram: {
      botToken: requiredValue(environment, "MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN"),
      groupIdentifier,
      botUsername,
    },
    github: {
      token: requiredValue(environment, "MOUNTAIN_AGENT_GITHUB_TOKEN"),
      repository,
      baseBranch,
    },
    model: {
      identifier:
        environment.MOUNTAIN_AGENT_MODEL?.trim() || "opencode-go/glm-5.3-flash",
      piCommand: environment.MOUNTAIN_AGENT_PI_COMMAND?.trim() || "pi",
      sandboxImage: requiredValue(environment, "MOUNTAIN_AGENT_SANDBOX_IMAGE"),
      providerEnvironmentVariables: readNameList(
        environment,
        "MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES",
      ),
    },
    paths: {
      repository: absolutePath(environment, "MOUNTAIN_AGENT_REPOSITORY_PATH"),
      worktrees: absolutePath(environment, "MOUNTAIN_AGENT_WORKTREE_PATH"),
      sessions: absolutePath(environment, "MOUNTAIN_AGENT_SESSION_PATH"),
      state: absolutePath(environment, "MOUNTAIN_AGENT_STATE_PATH"),
    },
    limits: {
      maxPendingInstructions: positiveInteger(
        environment,
        "MOUNTAIN_AGENT_MAX_PENDING_INSTRUCTIONS",
        defaultLimits.maxPendingInstructions,
      ),
      executionTimeoutMs: positiveInteger(
        environment,
        "MOUNTAIN_AGENT_EXECUTION_TIMEOUT_MS",
        defaultLimits.executionTimeoutMs,
      ),
      sandboxMemoryMegabytes: positiveInteger(
        environment,
        "MOUNTAIN_AGENT_SANDBOX_MEMORY_MEGABYTES",
        defaultLimits.sandboxMemoryMegabytes,
      ),
      sandboxCpuCount: positiveInteger(
        environment,
        "MOUNTAIN_AGENT_SANDBOX_CPU_COUNT",
        defaultLimits.sandboxCpuCount,
      ),
      sandboxProcessLimit: positiveInteger(
        environment,
        "MOUNTAIN_AGENT_SANDBOX_PROCESS_LIMIT",
        defaultLimits.sandboxProcessLimit,
      ),
    },
  };
}
