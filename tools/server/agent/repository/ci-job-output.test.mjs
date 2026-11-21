import assert from "node:assert/strict";
import { test } from "node:test";
import { projectOutputFromJobLog } from "./ci-job-output.mjs";

const job = {
  steps: [
    {
      name: "Check project",
      conclusion: "failure",
      started_at: "2026-11-21T10:00:00Z",
      completed_at: "2026-11-21T10:00:05Z",
    },
  ],
};
const log = [
  "2026-11-21T09:59:59.0000000Z previous step output",
  "2026-11-21T10:00:00.0000000Z ##[group]Run pnpm check",
  "2026-11-21T10:00:00.2000000Z pnpm check",
  "2026-11-21T10:00:01.0000000Z ##[endgroup]",
  "2026-11-21T10:00:02.0000000Z src/example.ts: test failed",
  "2026-11-21T10:00:04.0000000Z ##[error]Process completed with exit code 1.",
  "2026-11-21T10:00:05.0000000Z next step output",
].join("\n");

test("extracts only ungrouped output inside the failed project step", () => {
  assert.equal(
    projectOutputFromJobLog({ job, log }),
    "src/example.ts: test failed",
  );
});

test("rejects missing, ambiguous and non-project step evidence", () => {
  assert.equal(projectOutputFromJobLog({ job: { steps: [] }, log }), "");
  assert.equal(
    projectOutputFromJobLog({
      job: { steps: [...job.steps, ...job.steps] },
      log,
    }),
    "",
  );
  assert.equal(
    projectOutputFromJobLog({
      job: { steps: [{ ...job.steps[0], name: "Install pnpm" }] },
      log,
    }),
    "",
  );
  assert.equal(
    projectOutputFromJobLog({
      job: { steps: [{ ...job.steps[0], completed_at: null }] },
      log,
    }),
    "",
  );
});

test("rejects command text, metadata and malformed group boundaries", () => {
  assert.equal(
    projectOutputFromJobLog({
      job,
      log: log.replace("src/example.ts: test failed", "##[error]failure"),
    }),
    "",
  );
  assert.equal(
    projectOutputFromJobLog({
      job,
      log: log.replace("##[endgroup]", "##[group]nested"),
    }),
    "",
  );
  assert.equal(
    projectOutputFromJobLog({
      job,
      log: "2026-11-21T10:00:02.0000000Z ##[endgroup]",
    }),
    "",
  );
});
