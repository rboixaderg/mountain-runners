import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLimits, readAgentConfig } from "./config.mjs";

function validEnvironment(overrides = {}) {
  return {
    MOUNTAIN_AGENT_REPOSITORY: "rboixaderg/mountain-runners",
    MOUNTAIN_AGENT_TELEGRAM_GROUP_ID: "-1001234567890",
    MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME: "mountain_agent_bot",
    MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN: "telegram-token",
    MOUNTAIN_AGENT_GITHUB_TOKEN: "github-token",
    MOUNTAIN_AGENT_REQUIRED_CHECKS: "Validate, Gitleaks",
    MOUNTAIN_AGENT_SANDBOX_IMAGE: "mountain-agent-pi:1.5.0",
    MOUNTAIN_AGENT_REPOSITORY_PATH: "/srv/agent/repository",
    MOUNTAIN_AGENT_WORKTREE_PATH: "/srv/agent/worktrees",
    MOUNTAIN_AGENT_SESSION_PATH: "/srv/agent/sessions",
    MOUNTAIN_AGENT_STATE_PATH: "/srv/agent/state",
    ...overrides,
  };
}

test("reads a complete configuration with the provisional limits", () => {
  const config = readAgentConfig(validEnvironment());

  assert.equal(config.telegram.groupIdentifier, "-1001234567890");
  assert.equal(config.telegram.botUsername, "mountain_agent_bot");
  assert.equal(config.github.repository, "rboixaderg/mountain-runners");
  assert.equal(config.github.baseBranch, "main");
  assert.deepEqual(config.github.requiredChecks, ["Validate", "Gitleaks"]);
  assert.equal(config.model.identifier, "opencode-go/glm-5.3-flash");
  assert.equal(
    config.limits.maxPendingInstructions,
    defaultLimits.maxPendingInstructions,
  );
  assert.equal(
    config.limits.executionTimeoutMs,
    defaultLimits.executionTimeoutMs,
  );
  assert.equal(config.limits.ciPollIntervalMs, defaultLimits.ciPollIntervalMs);
  assert.equal(config.limits.ciWatchTimeoutMs, defaultLimits.ciWatchTimeoutMs);
});

test("rejects a configuration without the GitHub credential", () => {
  const environment = validEnvironment();
  delete environment.MOUNTAIN_AGENT_GITHUB_TOKEN;

  assert.throws(() => readAgentConfig(environment), {
    message: /MOUNTAIN_AGENT_GITHUB_TOKEN/u,
  });
});

test("rejects a base branch other than main", () => {
  assert.throws(
    () =>
      readAgentConfig(
        validEnvironment({ MOUNTAIN_AGENT_BASE_BRANCH: "develop" }),
      ),
    { message: /main base branch/u },
  );
});

test("rejects a positive group identifier", () => {
  assert.throws(
    () =>
      readAgentConfig(
        validEnvironment({ MOUNTAIN_AGENT_TELEGRAM_GROUP_ID: "1001234567890" }),
      ),
    { message: /negative group identifier/u },
  );
});

test("rejects a relative state path", () => {
  assert.throws(
    () =>
      readAgentConfig(validEnvironment({ MOUNTAIN_AGENT_STATE_PATH: "state" })),
    { message: /absolute path/u },
  );
});

test("rejects an empty or duplicated required check list", () => {
  for (const requiredChecks of [
    "",
    "Validate,",
    "Validate,Validate",
    "Validate,,Gitleaks",
  ]) {
    assert.throws(
      () =>
        readAgentConfig(
          validEnvironment({ MOUNTAIN_AGENT_REQUIRED_CHECKS: requiredChecks }),
        ),
      { message: /MOUNTAIN_AGENT_REQUIRED_CHECKS/u },
    );
  }
});

test("rejects a non-numeric resource limit", () => {
  assert.throws(
    () =>
      readAgentConfig(
        validEnvironment({ MOUNTAIN_AGENT_MAX_PENDING_INSTRUCTIONS: "ten" }),
      ),
    { message: /positive integer/u },
  );
});
