// Operator command: reconcile an unknown external result (T8.5).
//
// Usage, on the VPS with the service stopped, as the service identity:
//   node commands/reconcile/cli.mjs list
//   node commands/reconcile/cli.mjs resolve --kind <kind> --update <id>
//     --resolution <value> [--commit <40-hex SHA>] [--pull-request <n>]
//
// The command reads the same configuration as the service, because it needs the
// GitHub and Telegram credentials. It never resolves a case on its own: a person
// reads GitHub, chooses the resolution and the command applies exactly that one.
// It refuses to run unless the service is stopped. `list` closes no case, but,
// like `resolve`, it first imports the separate databases of an earlier version.
// `resolve` never executes the instruction again and never pushes, comments or
// merges.
//
// The command never creates an empty database: a state directory without one has
// no case. Only the separate databases of an earlier version are migrated.

import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { TelegramApi } from "telegram-pi-bridge/telegram";
import { readAgentConfig } from "../../config.mjs";
import { reconcileResolutions } from "../../policy/development.mjs";
import { GitHubTrust } from "../../repository/github.mjs";
import { migrateLegacyState } from "../../repository/legacy-state.mjs";
import { MergeRequestStore } from "../../repository/merge-request-store.mjs";
import { PublicationStore } from "../../repository/publication-store.mjs";
import { SessionNoteStore } from "../../repository/session-note-store.mjs";
import { stateDatabasePath } from "../../repository/state-database.mjs";
import { TopicJobStore } from "../../repository/topic-job-store.mjs";
import { isStoppedServiceState, serviceState } from "../service-state.mjs";
import {
  caseKinds,
  listUncertainCases,
  resolutionsByKind,
  resolveUncertainCase,
} from "./uncertain-cases.mjs";

const usage = `Usage: node commands/reconcile/cli.mjs list
       node commands/reconcile/cli.mjs resolve --kind <kind> --update <id>
         --resolution <value> [--commit <sha>] [--pull-request <n>]

Reconcile the cases that keep the service from starting because an external
result is unknown. The service must be stopped.

Options:
  --kind <kind>           instruction or merge
  --update <id>           Telegram update printed by list for that case
  --resolution <value>    instruction: published, not_published
                          merge: merged, not_merged (checked on GitHub)
  --commit <sha>          full commit SHA, required by --resolution published
  --pull-request <n>      pull request of a published instruction; the command
                          restores the CI watch the failed registration lost`;

const commitPattern = /^[a-f0-9]{40}$/u;
const positiveIntegerPattern = /^[1-9]\d*$/u;

/** Invalid operator input: a usage error, reported before the environment. */
class ReconcileInputError extends Error {}

function readPositiveInteger(text, name) {
  if (!positiveIntegerPattern.test(text ?? "")) {
    throw new ReconcileInputError(`${name} must be a positive integer.`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new ReconcileInputError(`${name} must be a positive integer.`);
  }
  return value;
}

function readCommit(text, name) {
  if (!commitPattern.test(text ?? "")) {
    throw new ReconcileInputError(
      `${name} must be a full 40-character lowercase commit SHA.`,
    );
  }
  return text;
}

function parseResolve(values) {
  if (!Object.hasOwn(caseKinds, values.kind ?? "")) {
    throw new ReconcileInputError(
      `--kind must be one of ${Object.keys(caseKinds).join(", ")}.`,
    );
  }
  const kind = values.kind;
  const updateIdentifier = readPositiveInteger(values.update, "--update");
  const resolutions = resolutionsByKind[kind];
  if (!resolutions.includes(values.resolution)) {
    throw new ReconcileInputError(
      `--resolution for ${kind} must be one of ${resolutions.join(", ")}.`,
    );
  }
  const resolution = values.resolution;
  let commit;
  if (resolution === reconcileResolutions.published) {
    commit = readCommit(values.commit, "--commit");
  } else if (values.commit !== undefined) {
    throw new ReconcileInputError(
      "--commit is only accepted with --resolution published.",
    );
  }
  // A published instruction needs the pull request of the confirmed
  // publication: the command follows that commit again before unblocking.
  const followPublishedInstruction =
    kind === caseKinds.instruction &&
    resolution === reconcileResolutions.published;
  if (!followPublishedInstruction && values["pull-request"] !== undefined) {
    throw new ReconcileInputError(
      "--pull-request is only accepted with --kind instruction and --resolution published.",
    );
  }
  const pullRequestNumber = followPublishedInstruction
    ? readPositiveInteger(values["pull-request"], "--pull-request")
    : null;
  return {
    command: "resolve",
    kind,
    updateIdentifier,
    resolution,
    commit,
    pullRequestNumber,
  };
}

/** Parse the command line without reading the environment or any store. */
function parseCommandArguments(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        kind: { type: "string" },
        update: { type: "string" },
        resolution: { type: "string" },
        commit: { type: "string" },
        "pull-request": { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new ReconcileInputError(error.message);
  }
  const [command, ...extra] = parsed.positionals;
  if (extra.length > 0) {
    throw new ReconcileInputError("Only one command is accepted.");
  }
  if (command === "list") {
    if (Object.values(parsed.values).some((value) => value !== undefined)) {
      throw new ReconcileInputError("list takes no options.");
    }
    return { command: "list" };
  }
  if (command === "resolve") {
    return parseResolve(parsed.values);
  }
  throw new ReconcileInputError("Expected the list or resolve command.");
}

// A state directory without a database has no case and none is created. The
// separate databases of an earlier version, as a restored backup holds, are
// imported first. A store that cannot be opened closes the ones already open, so
// a failed command never leaves the database locked.
function openStores(config, command, warn) {
  const stores = {
    instructions: null,
    publications: null,
    notes: null,
    topicJobs: null,
    merges: null,
  };
  migrateLegacyState(config.paths.state, {
    logger: (event, detail) => warn(`${event} ${detail}`),
  });
  const path = stateDatabasePath(config.paths.state);
  if (!existsSync(path)) {
    return stores;
  }
  try {
    stores.instructions = new AdmissionQueue(path, {
      maxPending: config.limits.maxPendingInstructions,
    });
    stores.publications = new PublicationStore(path);
    // Listing reads no note: opening the store would recover the claims of a
    // previous turn and mutate it, which a read-only command never does.
    stores.notes =
      command.command === "resolve" ? new SessionNoteStore(path) : null;
    stores.merges = new MergeRequestStore(path);
    stores.topicJobs = new TopicJobStore(path);
  } catch (error) {
    closeStores(stores);
    throw error;
  }
  return stores;
}

function closeStores(stores) {
  stores.merges?.close();
  stores.topicJobs?.close();
  stores.notes?.close();
  stores.publications?.close();
  stores.instructions?.close();
}

function resolvedJson(resolved) {
  return {
    kind: resolved.kind,
    update_identifier: resolved.updateIdentifier,
    session_key: resolved.sessionKey,
    resolution: resolved.resolution,
    pull_request_number: resolved.pullRequestNumber,
    commit: resolved.commit ?? null,
  };
}

/**
 * Run the command and return its exit code. The GitHub and Telegram clients are
 * injectable so a test can run it in-process without network access.
 */
export async function runReconcileCommand({
  argv = process.argv.slice(2),
  environment = process.env,
  github: githubOverride,
  telegram: telegramOverride,
  readServiceState = serviceState,
  write = (text) => process.stdout.write(text),
  warn = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  let command;
  try {
    command = parseCommandArguments(argv);
  } catch (error) {
    warn(`${error.message}\n\n${usage}`);
    return 2;
  }

  let config;
  try {
    config = readAgentConfig(environment);
  } catch (error) {
    warn(error.message);
    return 1;
  }

  if (!existsSync(config.paths.state)) {
    warn(`The state directory ${config.paths.state} does not exist.`);
    return 1;
  }

  const state = readServiceState();
  if (!isStoppedServiceState(state)) {
    warn(
      `Refusing to run while systemctl is-active mountain-agent reports ${JSON.stringify(state)}. Stop mountain-agent.service first.`,
    );
    return 1;
  }

  let stores;
  try {
    stores = openStores(config, command, warn);
  } catch (error) {
    warn(error instanceof Error ? error.message : "unknown error");
    return 1;
  }
  try {
    const github =
      githubOverride ??
      new GitHubTrust({
        token: config.github.token,
        repository: config.github.repository,
      });
    if (command.command === "list") {
      const cases = await listUncertainCases({ config, stores, github });
      for (const facts of cases) {
        write(`${JSON.stringify(facts)}\n`);
      }
      return 0;
    }
    // A resolution applies the decision the person already checked on GitHub. A
    // merge reads the pull request again to refuse a wrong decision, and the
    // first publication of a topic reads it to restore its label and binding.
    const resolved = await resolveUncertainCase({
      config,
      stores,
      telegram:
        telegramOverride ??
        new TelegramApi({ botToken: config.telegram.botToken }),
      github,
      kind: command.kind,
      updateIdentifier: command.updateIdentifier,
      resolution: command.resolution,
      commit: command.commit,
      pullRequestNumber: command.pullRequestNumber,
      warn,
    });
    write(`${JSON.stringify(resolvedJson(resolved))}\n`);
    return 0;
  } catch (error) {
    warn(error instanceof Error ? error.message : "unknown error");
    return 1;
  } finally {
    closeStores(stores);
  }
}
