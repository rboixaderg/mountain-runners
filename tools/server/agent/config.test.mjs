import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentSecrets,
  defaultLimits,
  readAgentConfig,
  removeAgentCredentials,
} from "./config.mjs";

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
  assert.equal(config.webResearch, null);
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

const webEnvironment = {
  MOUNTAIN_AGENT_BRAVE_SEARCH_TOKEN: "synthetic-brave-token",
  MOUNTAIN_AGENT_WEB_EXCLUDED_HOSTNAMES: "production.example",
  MOUNTAIN_AGENT_WEB_EXCLUDED_NETWORKS: "203.0.113.1, 2001:db8::/32",
  MOUNTAIN_AGENT_WEB_DNS_RECIPIENT: "Configured resolver",
  MOUNTAIN_AGENT_WEB_PUBLIC_QUERIES: '["Calendari, Berguedà"]',
  MOUNTAIN_AGENT_WEB_PUBLIC_URLS: '["https://club.example/calendar"]',
};

test("enables web research only with a credential, verified inventory settings and DNS disclosure label", () => {
  const environment = validEnvironment(webEnvironment);
  const config = readAgentConfig(environment);
  assert.deepEqual(config.webResearch.publicQueries, ["Calendari, Berguedà"]);
  assert.deepEqual(config.webResearch.exclusions.networks, [
    "203.0.113.1",
    "2001:db8::/32",
  ]);
  assert.ok(
    agentSecrets(config).includes(
      webEnvironment.MOUNTAIN_AGENT_BRAVE_SEARCH_TOKEN,
    ),
  );
  assert.throws(
    () =>
      readAgentConfig(
        validEnvironment({
          ...webEnvironment,
          MOUNTAIN_AGENT_WEB_DNS_RECIPIENT: "",
        }),
      ),
    /MOUNTAIN_AGENT_WEB_DNS_RECIPIENT/u,
  );
  assert.throws(
    () =>
      readAgentConfig(
        validEnvironment({
          ...webEnvironment,
          MOUNTAIN_AGENT_WEB_PUBLIC_URLS: '["https://production.example/"]',
        }),
      ),
    /exclusions or public URLs/u,
  );
});

test("refuses to pass the Brave credential to Pi by alias", () => {
  assert.throws(
    () =>
      readAgentConfig(
        validEnvironment({
          ...webEnvironment,
          MODEL_TOKEN: webEnvironment.MOUNTAIN_AGENT_BRAVE_SEARCH_TOKEN,
          MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES: "MODEL_TOKEN",
        }),
      ),
    /cannot be passed to Pi/u,
  );
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

test("rejects a resource limit that is not a plain decimal integer", () => {
  for (const value of ["1e3", "0x10", "1.5", "+1", "0", "9007199254740993"]) {
    assert.throws(
      () =>
        readAgentConfig(
          validEnvironment({ MOUNTAIN_AGENT_MAX_PENDING_INSTRUCTIONS: value }),
        ),
      { message: /positive integer/u },
      value,
    );
  }
});

test("trims the surrounding whitespace of a resource limit", () => {
  const config = readAgentConfig(
    validEnvironment({ MOUNTAIN_AGENT_MAX_PENDING_INSTRUCTIONS: " 12 " }),
  );

  assert.equal(config.limits.maxPendingInstructions, 12);
});

test("refuses provider variable names that belong to the service", () => {
  for (const name of [
    "MOUNTAIN_AGENT_GITHUB_TOKEN",
    "MOUNTAIN_AGENT_REPOSITORY",
    "MR_AGENT_SANDBOX_IMAGE",
    "PATH",
    "HOME",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
  ]) {
    assert.throws(
      () =>
        readAgentConfig(
          validEnvironment({
            MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES: `PROVIDER_KEY,${name}`,
          }),
        ),
      /cannot name service variables/u,
    );
  }
});

test("keeps the credentials in the config and removes them from the environment", () => {
  const environment = validEnvironment({
    ...webEnvironment,
    MOUNTAIN_AGENT_PROVIDER_ENVIRONMENT_VARIABLES: "PROVIDER_KEY",
    PROVIDER_KEY: "synthetic-provider",
    PATH: "/usr/bin",
  });
  const config = readAgentConfig(environment);
  removeAgentCredentials(config, environment);

  assert.deepEqual(config.model.providerEnvironment, {
    PROVIDER_KEY: "synthetic-provider",
  });
  assert.deepEqual(agentSecrets(config), [
    "telegram-token",
    "github-token",
    "synthetic-brave-token",
    "synthetic-provider",
  ]);
  for (const name of [
    "MOUNTAIN_AGENT_GITHUB_TOKEN",
    "MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN",
    "MOUNTAIN_AGENT_BRAVE_SEARCH_TOKEN",
    "PROVIDER_KEY",
  ]) {
    assert.equal(environment[name], undefined, name);
  }
  assert.equal(environment.PATH, "/usr/bin");
});
