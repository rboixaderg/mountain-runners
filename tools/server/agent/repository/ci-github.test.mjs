import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubTrust } from "./github.mjs";

const commit = "a".repeat(40);

function pageOf(url) {
  return new URL(url).searchParams.get("page");
}

test("reads every page of check runs pinned to the exact commit", async () => {
  const requested = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({
          total_count: 101,
          check_runs:
            pageOf(url) === "1"
              ? Array.from({ length: 100 }, (_, index) => ({ id: index }))
              : [{ id: 100 }],
        }),
      };
    },
  });
  assert.equal((await github.getCommitCheckRuns({ commit })).length, 101);
  assert.equal(requested.length, 2);
  assert.deepEqual(
    requested.map((url) => {
      const parsed = new URL(url);
      return {
        path: parsed.pathname,
        filter: parsed.searchParams.get("filter"),
        perPage: parsed.searchParams.get("per_page"),
        page: parsed.searchParams.get("page"),
      };
    }),
    [1, 2].map((page) => ({
      path: `/repos/example/project/commits/${commit}/check-runs`,
      filter: "latest",
      perPage: "100",
      page: String(page),
    })),
  );
});

test("reads every page of legacy commit statuses pinned to the commit", async () => {
  const requested = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () =>
          pageOf(url) === "1"
            ? Array.from({ length: 100 }, (_, index) => ({ id: index }))
            : [{ id: 100 }],
      };
    },
  });
  assert.equal((await github.getCommitStatuses({ commit })).length, 101);
  assert.equal(requested.length, 2);
  assert.deepEqual(
    requested.map((url) => {
      const parsed = new URL(url);
      return {
        path: parsed.pathname,
        perPage: parsed.searchParams.get("per_page"),
        page: parsed.searchParams.get("page"),
      };
    }),
    [1, 2].map((page) => ({
      path: `/repos/example/project/commits/${commit}/statuses`,
      perPage: "100",
      page: String(page),
    })),
  );
});

test("rejects unpinned references and invalid API responses", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  for (const unpinned of ["main", "a".repeat(7), ""]) {
    await assert.rejects(
      github.getCommitCheckRuns({ commit: unpinned }),
      /full commit SHA/u,
    );
    await assert.rejects(
      github.getCommitStatuses({ commit: unpinned }),
      /full commit SHA/u,
    );
  }
  await assert.rejects(
    github.getCommitCheckRuns({ commit }),
    /invalid check-runs/u,
  );
  await assert.rejects(
    github.getCommitStatuses({ commit }),
    /invalid commit statuses/u,
  );
});

test("fails closed when pagination exceeds the bounded number of pages", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => ({
      ok: true,
      json: async () =>
        new URL(url).pathname.endsWith("/statuses")
          ? Array.from({ length: 100 }, (_, index) => ({ id: index }))
          : {
              total_count: 2000,
              check_runs: Array.from({ length: 100 }, (_, index) => ({
                id: index,
              })),
            },
    }),
  });
  await assert.rejects(
    github.getCommitCheckRuns({ commit }),
    /pagination limit exceeded/u,
  );
  await assert.rejects(
    github.getCommitStatuses({ commit }),
    /pagination limit exceeded/u,
  );
});

test("reads one pull request to pin the reported commit to its head", async () => {
  const requested = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({
          number: 123,
          state: "open",
          head: { sha: commit },
          merged_at: null,
          html_url: "https://github.com/example/project/pull/123",
        }),
      };
    },
  });
  assert.deepEqual(await github.getPullRequest({ number: 123 }), {
    state: "open",
    headSha: commit,
  });
  assert.equal(requested.length, 1);
  assert.ok(new URL(requested[0]).pathname.endsWith("/pulls/123"));
});

test("rejects an invalid pull request number or response", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({ ok: true, json: async () => ({ number: 123 }) }),
  });
  for (const number of [0, -1, 1.5, "123", undefined]) {
    await assert.rejects(
      github.getPullRequest({ number }),
      /positive pull request number/u,
    );
  }
  await assert.rejects(
    github.getPullRequest({ number: 123 }),
    /invalid pull request response/u,
  );
});
