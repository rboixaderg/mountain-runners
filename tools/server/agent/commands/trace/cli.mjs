// Operator command: read the private trace of the Telegram bridge.
//
// Usage, as the service identity, started by root on the VPS:
//   node commands/trace/cli.mjs [--since <ISO>] [--until <ISO>]
//     [--topic=<session_key>] [--update <integer>] [--action <name>]
//     [--pull-request <integer>] [--limit <integer>]
//
// The trace keeps Telegram identifiers as stored: the reader is the operator.
// Only MOUNTAIN_AGENT_STATE_PATH is needed, so the command works without the
// bot and GitHub credentials of the service.

import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  parseTraceFilters,
  readTraceEntries,
  TraceQueryInputError,
} from "telegram-pi-bridge/sessions";

const usage = `Usage: node commands/trace/cli.mjs [options]

Print the private trace as JSON Lines, oldest entry first.

Options:
  --since <ISO>            entries created at or after the timestamp
  --until <ISO>            entries created before the timestamp
  --topic=<session_key>    entries of one topic; the key starts with '-', so
                           it needs the equals sign
  --update <integer>       entries of one Telegram update
  --action <name>          entries of one action
  --pull-request <integer> entries whose detail mentions #<integer>
  --limit <integer>        newest entries to print (default 100, max 10000)
`;

const optionDefinitions = {
  since: { type: "string" },
  until: { type: "string" },
  topic: { type: "string" },
  update: { type: "string" },
  action: { type: "string" },
  "pull-request": { type: "string" },
  limit: { type: "string" },
};

const integerPattern = /^\d+$/u;

function readIntegerArgument(text) {
  if (text === undefined) {
    return undefined;
  }
  // Only a decimal integer is an integer here: hexadecimal, scientific
  // notation and surrounding whitespace are reported as misuse.
  if (!integerPattern.test(text)) {
    throw new TraceQueryInputError(
      "An integer argument must be a decimal integer.",
    );
  }
  return Number(text);
}

function filtersOf(values) {
  return {
    since: values.since,
    until: values.until,
    topicKey: values.topic,
    updateIdentifier: readIntegerArgument(values.update),
    action: values.action,
    pullRequest: readIntegerArgument(values["pull-request"]),
    limit: readIntegerArgument(values.limit),
  };
}

function main() {
  let values;
  try {
    values = parseArgs({ options: optionDefinitions, strict: true }).values;
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}`);
    return 2;
  }

  // Misuse is reported before the environment is read.
  let filters;
  try {
    filters = parseTraceFilters(filtersOf(values));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage}`);
    return 2;
  }

  const statePath = process.env.MOUNTAIN_AGENT_STATE_PATH;
  if (!statePath) {
    process.stderr.write("MOUNTAIN_AGENT_STATE_PATH is not set.\n");
    return 1;
  }

  let entries;
  try {
    entries = readTraceEntries(join(statePath, "admission.sqlite"), filters);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  for (const entry of entries) {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
  return 0;
}

process.exitCode = main();
