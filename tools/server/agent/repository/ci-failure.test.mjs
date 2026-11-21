import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCiFailure } from "./ci-failure.mjs";

function classify(conclusion, steps, projectOutput = "") {
  return classifyCiFailure({
    checkRun: { status: "completed", conclusion },
    job: { status: "completed", conclusion, steps },
    projectOutput,
  });
}

const failedStep = (name) => ({
  name,
  status: "completed",
  conclusion: "failure",
});

test("classifies cancellations and timeouts", () => {
  assert.equal(classify("cancelled", []), "cancelled");
  assert.equal(classify("timed_out", []), "timed_out");
});

test("only reruns a setup failure before a project step", () => {
  assert.equal(
    classify("failure", [failedStep("Install browser dependencies")]),
    "setup_failure",
  );
  assert.equal(
    classify("failure", [
      { name: "Check project", status: "completed", conclusion: "success" },
      failedStep("Install dependencies"),
    ]),
    "no_output",
  );
  assert.equal(
    classify("failure", [
      { name: "Unrecognized step", status: "completed", conclusion: "success" },
      failedStep("Install dependencies"),
    ]),
    "no_output",
  );
});

test("requires known project output to allow a repair", () => {
  assert.equal(
    classify("failure", [failedStep("Check project")], "test failed"),
    "real_failure",
  );
  assert.equal(classify("failure", [failedStep("Check project")]), "no_output");
  assert.equal(
    classify("failure", [failedStep("Unknown step")], "failure"),
    "no_output",
  );
});

test("rejects missing, inconsistent and ambiguous job evidence", () => {
  assert.equal(
    classifyCiFailure({
      checkRun: { status: "completed", conclusion: "cancelled" },
      job: null,
    }),
    "no_output",
  );
  assert.equal(
    classifyCiFailure({
      checkRun: { status: "completed", conclusion: "cancelled" },
      job: { status: "completed", conclusion: "failure", steps: [] },
    }),
    "no_output",
  );
  assert.equal(
    classify(
      "failure",
      [failedStep("Check project"), failedStep("Install pnpm")],
      "error",
    ),
    "no_output",
  );
});
