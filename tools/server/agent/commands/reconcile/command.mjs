// Operator command: reconcile an unknown external result (T8.5).
//
// Usage, on the VPS with the service stopped, as the service identity:
//   node commands/reconcile/cli.mjs list
//   node commands/reconcile/cli.mjs resolve --kind <kind> --update <id>
//     --resolution <value> [--commit <40-hex SHA>] [--pull-request <n>]
//     [--sequence <id> --failed-commit <40-hex SHA>]
//
// The command reads the same configuration as the service, because it needs the
// GitHub and Telegram credentials. It never resolves a case on its own: a person
// reads GitHub, chooses the resolution and the command applies exactly that one.
// `list` only reads; `resolve` never executes the instruction again and never
// pushes, comments or merges.
//
// The command never creates a database: a missing state database has no case of
// its kind.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { TelegramApi } from "telegram-pi-bridge/telegram";
import { readAgentConfig } from "../../config.mjs";
import { reconcileResolutions } from "../../policy/development.mjs";
import { CiWatchStore } from "../../repository/ci-watch-store.mjs";
import { GitHubTrust } from "../../repository/github.mjs";
import { PreviewRequestStore } from "../../repository/preview-request-store.mjs";
import { SessionNoteStore } from "../../repository/session-note-store.mjs";
import {
  caseKinds,
  listUncertainCases,
  resolutionsByKind,
  resolveUncertainCase,
} from "./uncertain-cases.mjs";

const usage = `Usage: node commands/reconcile/cli.mjs list
       node commands/reconcile/cli.mjs resolve --kind <kind> --update <id>
         --resolution <value> [--commit <sha>] [--pull-request <n>]
         [--sequence <id> --failed-commit <sha>]

Reconcile the cases that keep the service from starting because an external
result is unknown. The service must be stopped.

Options:
  --kind <kind>           instruction, repair, preview or notice
  --update <id>           Telegram update printed by list for that case
  --resolution <value>    instruction and repair: published, not_published
                          preview: commented, not_commented
                          notice: delivered, resend
  --commit <sha>          full commit SHA, required by --resolution published
  --pull-request <n>      pull request of a published instruction; the command
                          restores the CI watch the failed registration lost
  --sequence <id>         repair row sequence printed by list
  --failed-commit <sha>   failed commit printed by list, required for a repair`;

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
  if (kind === caseKinds.repair) {
    return {
      command: "resolve",
      kind,
      updateIdentifier,
      sequence: readPositiveInteger(values.sequence, "--sequence"),
      failedCommit: readCommit(values["failed-commit"], "--failed-commit"),
      resolution,
      commit,
    };
  }
  if (values.sequence !== undefined || values["failed-commit"] !== undefined) {
    throw new ReconcileInputError(
      "--sequence and --failed-commit are only accepted with --kind repair.",
    );
  }
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
        sequence: { type: "string" },
        "failed-commit": { type: "string" },
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

// A missing database has no case of its kind and is never created.
function openStores(config) {
  const databasePath = (fileName) => join(config.paths.state, fileName);
  const admissionPath = databasePath("admission.sqlite");
  const ciWatchPath = databasePath("ci-watch.sqlite");
  const previewPath = databasePath("preview-request.sqlite");
  const sessionNotesPath = databasePath("session-notes.sqlite");
  return {
    instructions: existsSync(admissionPath)
      ? new AdmissionQueue(admissionPath, {
          maxPending: config.limits.maxPendingInstructions,
        })
      : null,
    repairs: existsSync(ciWatchPath) ? new CiWatchStore(ciWatchPath) : null,
    previews: existsSync(previewPath)
      ? new PreviewRequestStore(previewPath)
      : null,
    notes: existsSync(sessionNotesPath)
      ? new SessionNoteStore(sessionNotesPath)
      : null,
  };
}

function closeStores(stores) {
  stores.notes?.close();
  stores.previews?.close();
  stores.repairs?.close();
  stores.instructions?.close();
}

function resolvedJson(resolved) {
  const output = {
    kind: resolved.kind,
    update_identifier: resolved.updateIdentifier,
    session_key: resolved.sessionKey,
    resolution: resolved.resolution,
    pull_request_number: resolved.pullRequestNumber,
    commit: resolved.commit ?? null,
  };
  if (resolved.kind === caseKinds.repair) {
    output.sequence = resolved.sequence;
  }
  return output;
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

  const stores = openStores(config);
  const github =
    githubOverride ??
    new GitHubTrust({
      token: config.github.token,
      repository: config.github.repository,
    });
  try {
    if (command.command === "list") {
      const cases = await listUncertainCases({ config, stores, github });
      for (const facts of cases) {
        write(`${JSON.stringify(facts)}\n`);
      }
      return 0;
    }
    const resolved = await resolveUncertainCase({
      config,
      stores,
      telegram:
        telegramOverride ??
        new TelegramApi({ botToken: config.telegram.botToken }),
      kind: command.kind,
      updateIdentifier: command.updateIdentifier,
      sequence: command.sequence,
      failedCommit: command.failedCommit,
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
