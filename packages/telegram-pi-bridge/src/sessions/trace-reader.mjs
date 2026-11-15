// Read-only queries over the private trace of the bridge.
//
// The trace keeps the verified author, topic and action of each decision so an
// operator with root access to the VPS can investigate an incident. It is never
// exposed through Telegram. This module only reads the database: it opens it
// read-only and a missing file is an error, never a new database. Telegram
// identifiers come back as stored because the reader is the operator.

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * Invalid operator input: a value the reader refuses before touching the
 * database. Callers can report it as a usage error.
 */
export class TraceQueryInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "TraceQueryInputError";
  }
}

const defaultLimit = 100;
const maximumLimit = 10000;
const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// Date-only, millisecond precision at most, UTC or explicit offset.
const isoTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

function invalidInput(message) {
  return new TraceQueryInputError(message);
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCalendarDay(year, month, day) {
  if (month < 1 || month > 12) {
    return false;
  }
  const lastDay =
    month === 2 && isLeapYear(year) ? 29 : daysPerMonth[month - 1];
  return day >= 1 && day <= lastDay;
}

// `Date.parse` normalises an impossible date instead of refusing it, so every
// component is checked before it is used.
function readTimestamp(name, value) {
  const match = typeof value === "string" ? isoTimePattern.exec(value) : null;
  if (match === null) {
    throw invalidInput(`${name} must be an ISO 8601 timestamp.`);
  }
  const [, year, month, day, hour, minute, second] = match;
  if (!isCalendarDay(Number(year), Number(month), Number(day))) {
    throw invalidInput(`${name} is not a real calendar day.`);
  }
  if (
    (hour !== undefined && Number(hour) > 23) ||
    (minute !== undefined && Number(minute) > 59) ||
    (second !== undefined && Number(second) > 59)
  ) {
    throw invalidInput(`${name} has an impossible clock time.`);
  }

  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw invalidInput(`${name} must be an ISO 8601 timestamp.`);
  }
  // The trace stores UTC ISO strings, so comparisons use the same form.
  return new Date(milliseconds).toISOString();
}

function readText(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidInput(`${name} must be a non-empty string.`);
  }
  return value;
}

function readIdentifier(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumLimit) {
    throw invalidInput(
      `limit must be an integer between 1 and ${maximumLimit}.`,
    );
  }
  return value;
}

/**
 * Validate and normalise operator filters without touching the file system, so
 * a caller can report misuse before it needs the state directory. An absent
 * filter stays undefined; timestamps become UTC ISO strings.
 */
export function parseTraceFilters(filters = {}) {
  const {
    since,
    until,
    topicKey,
    updateIdentifier,
    action,
    pullRequest,
    limit = defaultLimit,
  } = filters;
  const parsed = {};

  if (since !== undefined) {
    parsed.since = readTimestamp("since", since);
  }
  if (until !== undefined) {
    parsed.until = readTimestamp("until", until);
  }
  if (topicKey !== undefined) {
    parsed.topicKey = readText("topic", topicKey);
  }
  if (updateIdentifier !== undefined) {
    parsed.updateIdentifier = readIdentifier("update", updateIdentifier);
  }
  if (action !== undefined) {
    parsed.action = readText("action", action);
  }
  if (pullRequest !== undefined) {
    parsed.pullRequest = readIdentifier("pull-request", pullRequest);
  }
  parsed.limit = readLimit(limit);

  return parsed;
}

/**
 * Read trace entries ordered by sequence, oldest first. The limit (100 by
 * default) keeps the newest matching entries, still in ascending order. Filters
 * are bound as SQL parameters.
 */
export function readTraceEntries(databasePath, filters = {}) {
  const {
    since,
    until,
    topicKey,
    updateIdentifier,
    action,
    pullRequest,
    limit,
  } = parseTraceFilters(filters);

  const conditions = [];
  const parameters = [];

  if (since !== undefined) {
    conditions.push("created_at >= ?");
    parameters.push(since);
  }
  if (until !== undefined) {
    conditions.push("created_at < ?");
    parameters.push(until);
  }
  if (topicKey !== undefined) {
    conditions.push("session_key = ?");
    parameters.push(topicKey);
  }
  if (updateIdentifier !== undefined) {
    conditions.push("update_identifier = ?");
    parameters.push(updateIdentifier);
  }
  if (action !== undefined) {
    conditions.push("action = ?");
    parameters.push(action);
  }
  if (pullRequest !== undefined) {
    // A right boundary needs one character after the number, so the sentinel
    // gives one to a token that ends the detail. The class keeps `#21abc`,
    // `#21_` and `#215` out while spaces, punctuation and the end still match.
    conditions.push("(detail || ' ') GLOB ?");
    parameters.push(`*#${pullRequest}[^0-9A-Za-z_]*`);
  }

  if (!existsSync(databasePath)) {
    throw new Error(`Trace database not found: ${databasePath}`);
  }

  const where =
    conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `SELECT sequence, update_identifier, author_identifier, session_key,
                action, detail, created_at
         FROM trace
         ${where}
         ORDER BY sequence DESC
         LIMIT ?`,
      )
      .all(...parameters, limit);
    return rows.reverse().map((row) => ({ ...row }));
  } finally {
    database.close();
  }
}
