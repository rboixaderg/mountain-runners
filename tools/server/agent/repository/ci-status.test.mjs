import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCommitStatus } from "./ci-status.mjs";

const requiredChecks = ["Validate", "Gitleaks"];
const success = (name) => ({
  name,
  status: "completed",
  conclusion: "success",
});
const status = (context, state, createdAt = "2026-11-14T10:00:00Z") => ({
  context,
  state,
  created_at: createdAt,
});

test("requires every configured check before reporting success", () => {
  const result = classifyCommitStatus({
    requiredChecks,
    checkRuns: [success("Validate"), success("Gitleaks")],
    statuses: [],
  });
  assert.equal(result.state, "success");
  assert.deepEqual(result.failed, []);
});

test("does not treat missing, duplicated or empty evidence as success", () => {
  const missing = classifyCommitStatus({
    requiredChecks,
    checkRuns: [success("Validate")],
    statuses: [],
  });
  assert.equal(missing.state, "unknown");
  assert.deepEqual(missing.missing, ["Gitleaks"]);

  const duplicated = classifyCommitStatus({
    requiredChecks,
    checkRuns: [success("Validate"), success("Validate"), success("Gitleaks")],
    statuses: [],
  });
  assert.equal(duplicated.state, "unknown");
  assert.deepEqual(duplicated.ambiguous, ["Validate"]);

  assert.equal(
    classifyCommitStatus({
      requiredChecks: [],
      checkRuns: [success("Validate")],
      statuses: [],
    }).state,
    "unknown",
  );
});

test("distinguishes running, failed and skipped required checks", () => {
  const running = classifyCommitStatus({
    requiredChecks,
    checkRuns: [
      { name: "Validate", status: "in_progress", conclusion: null },
      success("Gitleaks"),
    ],
    statuses: [],
  });
  assert.equal(running.state, "pending");
  assert.deepEqual(running.pending, ["Validate"]);

  const failed = classifyCommitStatus({
    requiredChecks,
    checkRuns: [
      { name: "Validate", status: "completed", conclusion: "failure" },
      success("Gitleaks"),
    ],
    statuses: [],
  });
  assert.equal(failed.state, "failure");
  assert.deepEqual(failed.failed, ["Validate"]);

  const skipped = classifyCommitStatus({
    requiredChecks,
    checkRuns: [
      { name: "Validate", status: "completed", conclusion: "skipped" },
      success("Gitleaks"),
    ],
    statuses: [],
  });
  assert.equal(skipped.state, "failure");
  assert.deepEqual(skipped.failed, ["Validate"]);

  const unknownStatus = classifyCommitStatus({
    requiredChecks,
    checkRuns: [
      { name: "Validate", status: "unexpected", conclusion: null },
      success("Gitleaks"),
    ],
    statuses: [],
  });
  assert.equal(unknownStatus.state, "unknown");
});

test("reads legacy commit statuses and keeps the newest per context", () => {
  const combined = classifyCommitStatus({
    requiredChecks: ["ci/validate"],
    checkRuns: [],
    statuses: [
      status("ci/validate", "pending", "2026-11-14T10:00:00Z"),
      status("ci/validate", "success", "2026-11-14T10:05:00Z"),
    ],
  });
  assert.equal(combined.state, "success");

  const failing = classifyCommitStatus({
    requiredChecks: ["ci/validate"],
    checkRuns: [],
    statuses: [status("ci/validate", "error")],
  });
  assert.equal(failing.state, "failure");

  const ambiguous = classifyCommitStatus({
    requiredChecks: ["ci/validate"],
    checkRuns: [],
    statuses: [
      status("ci/validate", "success", "2026-11-14T10:05:00Z"),
      status("ci/validate", "failure", "2026-11-14T10:05:00Z"),
    ],
  });
  assert.equal(ambiguous.state, "unknown");
});

test("treats an unreadable status timestamp as ambiguous, never as success", () => {
  const withoutTimestamps = classifyCommitStatus({
    requiredChecks: ["ci/validate"],
    checkRuns: [],
    statuses: [
      { context: "ci/validate", state: "success" },
      { context: "ci/validate", state: "failure" },
    ],
  });
  assert.equal(withoutTimestamps.state, "unknown");
  assert.deepEqual(withoutTimestamps.ambiguous, ["ci/validate"]);

  const oneUnreadable = classifyCommitStatus({
    requiredChecks: ["ci/validate"],
    checkRuns: [],
    statuses: [
      status("ci/validate", "success"),
      { context: "ci/validate", state: "failure" },
    ],
  });
  assert.equal(oneUnreadable.state, "unknown");
});

test("rejects a check reported both as a check run and as a status", () => {
  const result = classifyCommitStatus({
    requiredChecks: ["Validate"],
    checkRuns: [success("Validate")],
    statuses: [status("Validate", "success")],
  });
  assert.equal(result.state, "unknown");
  assert.deepEqual(result.ambiguous, ["Validate"]);
});
