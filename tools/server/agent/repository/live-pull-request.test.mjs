import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubTrust, readLivePullRequest } from "./github.mjs";

const commit = "a".repeat(40);

function client({ move = false, fail = false } = {}) {
  let pullReads = 0;
  return new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => {
      if (fail) throw new Error("network unavailable");
      let body;
      if (url.includes("/pulls/")) {
        pullReads += 1;
        body = {
          state: "open",
          merged: false,
          draft: false,
          head: {
            sha: move && pullReads > 1 ? "b".repeat(40) : commit,
            ref: "feat/test",
          },
          base: { ref: "main" },
        };
      } else if (url.includes("check-runs")) {
        body = {
          check_runs: [
            { name: "green", status: "completed", conclusion: "success" },
            { name: "cancelled", status: "completed", conclusion: "cancelled" },
            { name: "timeout", status: "completed", conclusion: "timed_out" },
            { name: "pending", status: "in_progress", conclusion: null },
          ],
        };
      } else {
        body = [];
      }
      return { ok: true, json: async () => body };
    },
  });
}

test("reads required checks for the confirmed current head", async () => {
  const result = await readLivePullRequest({
    github: client(),
    number: 42,
    requiredChecks: ["green", "cancelled", "timeout", "pending", "missing"],
  });
  assert.equal(result.pullRequest.headSha, commit);
  assert.equal(result.pullRequest.state, "open");
  assert.deepEqual(result.classification.failed, ["cancelled", "timeout"]);
  assert.deepEqual(result.classification.pending, ["pending"]);
  assert.deepEqual(result.classification.missing, ["missing"]);
  assert.notEqual(result.classification.state, "success");
});

test("fails closed on a moving head or unreadable GitHub", async () => {
  for (const github of [client({ move: true }), client({ fail: true })]) {
    await assert.rejects(
      readLivePullRequest({ github, number: 42, requiredChecks: ["green"] }),
    );
  }
});
