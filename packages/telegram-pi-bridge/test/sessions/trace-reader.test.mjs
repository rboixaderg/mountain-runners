import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "../../src/sessions/queue.mjs";
import {
  parseTraceFilters,
  readTraceEntries,
  TraceQueryInputError,
} from "../../src/sessions/trace-reader.mjs";

const topicOne = "-1001234567890:7";
const topicTwo = "-1001234567890:9";
const standardEntries = [
  {
    updateIdentifier: 700,
    authorIdentifier: 42,
    sessionKey: topicOne,
    action: "instruction_admitted",
    detail: "pr #21",
  },
  {
    updateIdentifier: 701,
    authorIdentifier: 43,
    sessionKey: topicOne,
    action: "instruction_completed",
    detail: "pr #21 merged",
  },
  {
    updateIdentifier: 702,
    authorIdentifier: 44,
    sessionKey: topicTwo,
    action: "instruction_denied",
    detail: "not_a_group_member",
  },
  {
    updateIdentifier: 703,
    authorIdentifier: 45,
    sessionKey: topicTwo,
    action: "preview_requested",
    detail: "pr #215",
  },
  {
    updateIdentifier: 704,
    authorIdentifier: 46,
    sessionKey: topicOne,
    action: "ci_repair_published",
    detail: null,
  },
];

function temporaryDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), "telegram-pi-trace-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return directory;
}

// One trace entry per hour, written through the queue with an injected clock.
function createDatabase(context, entries) {
  const directory = temporaryDirectory(context);
  const path = join(directory, "admission.sqlite");
  let hour = 9;
  const queue = new AdmissionQueue(path, {
    maxPending: 10,
    now: () => new Date(Date.UTC(2026, 2, 1, hour++, 0, 0)),
  });
  for (const entry of entries) {
    queue.recordTrace(entry);
  }
  queue.close();
  return path;
}

function createTraceDatabase(context) {
  return createDatabase(context, standardEntries);
}

function sequencesOf(entries) {
  return entries.map((entry) => entry.sequence);
}

test("returns every column of each entry in ascending sequence order", (context) => {
  const path = createTraceDatabase(context);
  assert.deepEqual(readTraceEntries(path), [
    {
      sequence: 1,
      update_identifier: 700,
      author_identifier: 42,
      session_key: topicOne,
      action: "instruction_admitted",
      detail: "pr #21",
      created_at: "2026-03-01T09:00:00.000Z",
    },
    {
      sequence: 2,
      update_identifier: 701,
      author_identifier: 43,
      session_key: topicOne,
      action: "instruction_completed",
      detail: "pr #21 merged",
      created_at: "2026-03-01T10:00:00.000Z",
    },
    {
      sequence: 3,
      update_identifier: 702,
      author_identifier: 44,
      session_key: topicTwo,
      action: "instruction_denied",
      detail: "not_a_group_member",
      created_at: "2026-03-01T11:00:00.000Z",
    },
    {
      sequence: 4,
      update_identifier: 703,
      author_identifier: 45,
      session_key: topicTwo,
      action: "preview_requested",
      detail: "pr #215",
      created_at: "2026-03-01T12:00:00.000Z",
    },
    {
      sequence: 5,
      update_identifier: 704,
      author_identifier: 46,
      session_key: topicOne,
      action: "ci_repair_published",
      detail: null,
      created_at: "2026-03-01T13:00:00.000Z",
    },
  ]);
});

test("filters on an inclusive since and an exclusive until", (context) => {
  const path = createTraceDatabase(context);
  const fromTen = "2026-03-01T10:00:00.000Z";
  const fromTwelve = "2026-03-01T12:00:00.000Z";

  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { since: fromTen })),
    [2, 3, 4, 5],
  );
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { until: fromTen })),
    [1],
  );
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { since: fromTen, until: fromTwelve })),
    [2, 3],
  );
});

test("compares timestamps written in another UTC notation", (context) => {
  const path = createTraceDatabase(context);
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { since: "2026-03-01T10:00:00Z" })),
    [2, 3, 4, 5],
  );
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { until: "2026-03-01T10:00:00Z" })),
    [1],
  );
});

test("accepts a leap day, milliseconds and an explicit offset", () => {
  assert.equal(
    parseTraceFilters({ since: "2028-02-29" }).since,
    "2028-02-29T00:00:00.000Z",
  );
  assert.equal(
    parseTraceFilters({ since: "2028-02-29T10:00:00.123Z" }).since,
    "2028-02-29T10:00:00.123Z",
  );
  assert.equal(
    parseTraceFilters({ until: "2028-02-29T10:00:00+02:00" }).until,
    "2028-02-29T08:00:00.000Z",
  );
});

test("filters on topic, update and action", (context) => {
  const path = createTraceDatabase(context);
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { topicKey: topicTwo })),
    [3, 4],
  );
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { updateIdentifier: 703 })),
    [4],
  );
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { action: "instruction_admitted" })),
    [1],
  );
});

test("combines several filters", (context) => {
  const path = createTraceDatabase(context);
  assert.deepEqual(
    sequencesOf(
      readTraceEntries(path, {
        topicKey: topicOne,
        action: "instruction_completed",
      }),
    ),
    [2],
  );
  assert.deepEqual(
    sequencesOf(
      readTraceEntries(path, {
        topicKey: topicOne,
        since: "2026-03-01T10:00:00.000Z",
      }),
    ),
    [2, 5],
  );
});

test("matches the pull request number as a whole token in the detail", (context) => {
  const path = createDatabase(context, [
    { action: "instruction_admitted", detail: "pr #21" },
    { action: "instruction_admitted", detail: "pr #21 merged" },
    { action: "instruction_admitted", detail: "pr #21, then #215" },
    { action: "instruction_admitted", detail: "pr #215" },
    { action: "instruction_admitted", detail: "pr #21abc" },
    { action: "instruction_admitted", detail: "pr #21_retry" },
    { action: "instruction_admitted", detail: null },
  ]);

  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { pullRequest: 21 })),
    [1, 2, 3],
  );
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { pullRequest: 215 })),
    [3, 4],
  );
  assert.deepEqual(sequencesOf(readTraceEntries(path, { pullRequest: 1 })), []);
});

test("returns the newest entries in ascending order when the limit truncates", (context) => {
  const path = createTraceDatabase(context);
  assert.deepEqual(sequencesOf(readTraceEntries(path, { limit: 2 })), [4, 5]);
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { topicKey: topicOne, limit: 1 })),
    [5],
  );
  assert.deepEqual(
    sequencesOf(readTraceEntries(path, { limit: 5 })),
    [1, 2, 3, 4, 5],
  );
});

test("returns the newest 100 entries by default and accepts the maximum limit", (context) => {
  const entries = Array.from({ length: 101 }, (unused, index) => ({
    action: "instruction_admitted",
    detail: `entry ${index + 1}`,
  }));
  const path = createDatabase(context, entries);

  assert.deepEqual(
    sequencesOf(readTraceEntries(path)),
    Array.from({ length: 100 }, (unused, index) => index + 2),
  );
  assert.equal(readTraceEntries(path, { limit: 10000 }).length, 101);
});

test("rejects an invalid filter before opening the database", (context) => {
  const directory = temporaryDirectory(context);
  const path = join(directory, "missing.sqlite");
  const invalidFilters = [
    { limit: 0 },
    { limit: -1 },
    { limit: 10001 },
    { limit: 1.5 },
    { updateIdentifier: -1 },
    { updateIdentifier: 1.5 },
    { updateIdentifier: "703" },
    { pullRequest: -21 },
    { pullRequest: 21.5 },
  ];

  for (const filters of invalidFilters) {
    assert.throws(
      () => readTraceEntries(path, filters),
      TraceQueryInputError,
      JSON.stringify(filters),
    );
  }
});

test("rejects a timestamp that is not a real date or clock time", (context) => {
  const directory = temporaryDirectory(context);
  const path = join(directory, "missing.sqlite");
  const invalidTimestamps = [
    "yesterday",
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-03-01T24:00:00Z",
    "2026-03-01T25:00:00.000Z",
    "2026-03-01T10:60:00Z",
    "2026-03-01T10:00:60Z",
    "2026-03-01T10:00:00.1234Z",
  ];

  for (const value of invalidTimestamps) {
    assert.throws(
      () => readTraceEntries(path, { since: value }),
      TraceQueryInputError,
      value,
    );
  }
});

test("rejects an empty topic or action before touching the file system", (context) => {
  const directory = temporaryDirectory(context);
  const path = join(directory, "missing.sqlite");
  const invalidFilters = [
    { topicKey: "" },
    { topicKey: 42 },
    { action: "" },
    { action: null },
  ];

  for (const filters of invalidFilters) {
    assert.throws(
      () => readTraceEntries(path, filters),
      TraceQueryInputError,
      JSON.stringify(filters),
    );
  }
});

test("refuses a missing database and never creates it", (context) => {
  const directory = temporaryDirectory(context);
  const path = join(directory, "admission.sqlite");

  assert.throws(() => readTraceEntries(path), /Trace database not found/u);
  assert.equal(existsSync(path), false);
});

test("reads a database file the caller cannot write", (context) => {
  const path = createTraceDatabase(context);
  // A writable open is refused for this file; the reader only reads.
  chmodSync(path, 0o444);
  assert.deepEqual(sequencesOf(readTraceEntries(path)), [1, 2, 3, 4, 5]);
});
