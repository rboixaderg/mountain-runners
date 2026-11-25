import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GitHubResponseError,
  GitHubTrust,
  isDefiniteRejection,
} from "./github.mjs";

const commit = "a".repeat(40);
const baseCommit = "b".repeat(40);

function pullRequestResponse(overrides = {}) {
  return {
    state: "open",
    draft: false,
    merged: false,
    mergeable_state: "clean",
    labels: [],
    head: {
      sha: commit,
      ref: "feat/example",
      repo: { full_name: "example/project" },
    },
    base: { ref: "main", sha: baseCommit },
    html_url: "https://github.com/example/project/pull/123",
    ...overrides,
  };
}

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
        json: async () =>
          pullRequestResponse({
            number: 123,
            html_url: "https://github.com/example/project/pull/123",
          }),
      };
    },
  });
  assert.deepEqual(await github.getPullRequest({ number: 123 }), {
    state: "open",
    htmlUrl: "https://github.com/example/project/pull/123",
    headSha: commit,
    headRef: "feat/example",
    headRepository: "example/project",
    draft: false,
    previewLabeled: false,
    previewRevoked: false,
    baseRef: "main",
    mergeableState: "clean",
    merged: false,
    mergeCommitSha: null,
  });
  assert.equal(requested.length, 1);
  assert.ok(new URL(requested[0]).pathname.endsWith("/pulls/123"));
});

test("reads a pull request without a review URL instead of failing", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        const response = pullRequestResponse();
        delete response.html_url;
        return response;
      },
    }),
  });

  const pullRequest = await github.getPullRequest({ number: 123 });

  assert.equal(pullRequest.state, "open");
  assert.equal(
    pullRequest.htmlUrl,
    undefined,
    "the review link is optional; the caller drops only that line",
  );
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

test("rejects a pull request response without a head branch", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({
      ok: true,
      json: async () => pullRequestResponse({ head: { sha: commit } }),
    }),
  });
  await assert.rejects(
    github.getPullRequest({ number: 123 }),
    /invalid pull request response/u,
  );
});

test("reports a pull request without head repository as having none", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({
      ok: true,
      json: async () =>
        pullRequestResponse({
          head: { sha: commit, ref: "feat/example", repo: null },
        }),
    }),
  });
  assert.equal(
    (await github.getPullRequest({ number: 123 })).headRepository,
    null,
  );
});

test("reads the merge commit of a merged pull request and rejects one without it", async () => {
  const mergeCommit = "b".repeat(40);
  let response = pullRequestResponse({
    state: "closed",
    merged: true,
    merge_commit_sha: mergeCommit,
  });
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({ ok: true, json: async () => response }),
  });
  const merged = await github.getPullRequest({ number: 123 });
  assert.equal(merged.merged, true);
  assert.equal(merged.mergeCommitSha, mergeCommit);

  response = pullRequestResponse({ state: "closed", merged: true });
  await assert.rejects(
    github.getPullRequest({ number: 123 }),
    /invalid pull request response/u,
  );
});

test("rejects a pull request response without draft, base or merged flags", async () => {
  for (const missing of ["draft", "base", "merged"]) {
    const response = pullRequestResponse();
    delete response[missing];
    const github = new GitHubTrust({
      token: "synthetic",
      repository: "example/project",
      fetchImpl: async () => ({ ok: true, json: async () => response }),
    });
    await assert.rejects(
      github.getPullRequest({ number: 123 }),
      /invalid pull request response/u,
    );
  }
});

function compareClient(response) {
  const requests = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => response };
    },
  });
  return { github, requests };
}

test("reads the changed paths of the pinned commit against main, with both names of a rename", async () => {
  const { github, requests } = compareClient({
    files: [
      { filename: "a.yaml" },
      { filename: "new.yaml", previous_filename: "old.mjs" },
      { filename: "gone.yaml", status: "removed" },
    ],
  });

  assert.deepEqual(await github.getChangedPaths({ commit }), {
    paths: ["a.yaml", "new.yaml", "old.mjs", "gone.yaml"],
    presentPaths: ["a.yaml", "new.yaml"],
  });
  assert.deepEqual(
    requests.map((url) => new URL(url).pathname),
    [`/repos/example/project/compare/main...${commit}`],
  );
});

test("accepts the longest changed file list that is surely complete", async () => {
  const { github } = compareClient({
    files: Array.from({ length: 299 }, (_, index) => ({
      filename: `${index}`,
    })),
  });

  const { paths } = await github.getChangedPaths({ commit });

  assert.equal(paths.length, 299);
});

test("reads the modes of the tree of the pinned commit", async () => {
  const { github, requests } = compareClient({
    truncated: false,
    tree: [
      { path: "a.yaml", mode: "100644" },
      { path: "link.yaml", mode: "120000" },
    ],
  });

  assert.deepEqual(
    await github.getTreeModes({ commit }),
    new Map([
      ["a.yaml", "100644"],
      ["link.yaml", "120000"],
    ]),
  );
  assert.deepEqual(
    requests.map((url) => {
      const { pathname, search } = new URL(url);
      return `${pathname}${search}`;
    }),
    [`/repos/example/project/git/trees/${commit}?recursive=1`],
  );
});

test("rejects a commit tree that is invalid or truncated", async () => {
  for (const response of [
    {},
    { truncated: true, tree: [] },
    { truncated: false },
  ]) {
    const { github } = compareClient(response);
    await assert.rejects(github.getTreeModes({ commit }), /commit tree/u);
  }
});

test("rejects a changed file list that is invalid or may be truncated", async () => {
  for (const response of [
    {},
    { files: [{}] },
    {
      files: Array.from({ length: 300 }, (_, index) => ({
        filename: `${index}`,
      })),
    },
  ]) {
    const { github } = compareClient(response);
    await assert.rejects(github.getChangedPaths({ commit }), /changed files/u);
  }
});

test("merges with a PUT whose body is exactly the pinned commit and the squash method", async () => {
  const mergeCommit = "b".repeat(40);
  const requests = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ merged: true, sha: mergeCommit, message: "ok" }),
      };
    },
  });
  assert.deepEqual(
    await github.mergePullRequest({ number: 123, sha: commit }),
    { mergeCommitSha: mergeCommit },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "PUT");
  assert.equal(
    new URL(requests[0].url).pathname,
    "/repos/example/project/pulls/123/merge",
  );
  assert.equal(
    requests[0].options.body,
    JSON.stringify({ sha: commit, merge_method: "squash" }),
  );
});

test("refuses a merge without a valid pull request number or full commit before calling GitHub", async () => {
  const requests = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => ({}) };
    },
  });
  await assert.rejects(
    github.mergePullRequest({ number: 0, sha: commit }),
    /positive pull request number/u,
  );
  await assert.rejects(
    github.mergePullRequest({ number: 123, sha: "abc123" }),
    /full commit SHA/u,
  );
  assert.deepEqual(requests, []);
});

test("treats a merge response that does not confirm the merge as invalid", async () => {
  for (const response of [
    { merged: false, sha: commit },
    { merged: true },
    {},
  ]) {
    const github = new GitHubTrust({
      token: "synthetic",
      repository: "example/project",
      fetchImpl: async () => ({ ok: true, json: async () => response }),
    });
    await assert.rejects(
      github.mergePullRequest({ number: 123, sha: commit }),
      /invalid merge response/u,
    );
  }
});

test("reports a refused merge as a GitHub response error that carries only the status", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({}) }),
  });
  await assert.rejects(
    github.mergePullRequest({ number: 123, sha: commit }),
    (error) => {
      assert.ok(error instanceof GitHubResponseError);
      assert.equal(error.status, 409);
      assert.equal(isDefiniteRejection(error), true);
      return true;
    },
  );
});

test("a definite rejection is a client error other than a timeout or a rate limit", () => {
  const rejection = (status) =>
    isDefiniteRejection(new GitHubResponseError("PUT", "/path", status));
  assert.equal(rejection(405), true);
  assert.equal(rejection(422), true);
  assert.equal(rejection(408), false);
  assert.equal(rejection(429), false);
  assert.equal(rejection(500), false);
  assert.equal(isDefiniteRejection(new Error("network")), false);
});

function labelsComponent(handler) {
  const requests = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return handler(requests.length, options.method);
    },
  });
  return { github, requests };
}

const unknownResult = () => {
  throw new TypeError("fetch failed");
};

test("sets exactly the preview label on the pull request", async () => {
  const { github, requests } = labelsComponent(() => ({
    ok: true,
    json: async () => [{ name: "preview" }],
  }));
  await github.addPreviewLabel({ number: 123 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "POST");
  assert.ok(new URL(requests[0].url).pathname.endsWith("/issues/123/labels"));
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    labels: ["preview"],
  });
});

test("refuses an invalid pull request number before calling GitHub", async () => {
  const { github, requests } = labelsComponent(() => ({ ok: true }));
  await assert.rejects(
    github.addPreviewLabel({ number: 0 }),
    /positive pull request number/u,
  );
  assert.deepEqual(requests, []);
});

test("reads the labels before repeating after an unknown result and does not duplicate", async () => {
  const { github, requests } = labelsComponent((count) => {
    if (count === 1) return unknownResult();
    return { ok: true, json: async () => [{ name: "preview" }] };
  });
  await github.addPreviewLabel({ number: 123 });
  assert.deepEqual(
    requests.map((request) => request.options.method),
    ["POST", "GET"],
  );
});

test("repeats once when the unknown result left no label and fails if that fails", async () => {
  const repeated = labelsComponent((count) => {
    if (count === 1) return unknownResult();
    return { ok: true, json: async () => (count === 2 ? [] : [{}]) };
  });
  await repeated.github.addPreviewLabel({ number: 123 });
  assert.deepEqual(
    repeated.requests.map((request) => request.options.method),
    ["POST", "GET", "POST"],
  );

  const failing = labelsComponent((count) => {
    if (count === 2) return { ok: true, json: async () => [] };
    return unknownResult();
  });
  await assert.rejects(failing.github.addPreviewLabel({ number: 123 }), {
    name: "TypeError",
  });
  assert.equal(failing.requests.length, 3);
});

test("a server error or a rate limit on the post is an unknown result, settled by a read", async () => {
  for (const status of [429, 503]) {
    const { github, requests } = labelsComponent((count) =>
      count === 1
        ? { ok: false, status }
        : { ok: true, json: async () => [{ name: "preview" }] },
    );
    await github.addPreviewLabel({ number: 123 });
    assert.deepEqual(
      requests.map((request) => request.options.method),
      ["POST", "GET"],
    );
  }
});

test("an unreadable or invalid label read after an unknown result never repeats the post", async () => {
  const unreadable = labelsComponent((count) => {
    if (count === 1) return unknownResult();
    return { ok: false, status: 502 };
  });
  await assert.rejects(unreadable.github.addPreviewLabel({ number: 123 }), {
    status: 502,
  });
  assert.deepEqual(
    unreadable.requests.map((request) => request.options.method),
    ["POST", "GET"],
  );

  const invalid = labelsComponent((count) => {
    if (count === 1) return unknownResult();
    return { ok: true, json: async () => ({ name: "preview" }) };
  });
  await assert.rejects(
    invalid.github.addPreviewLabel({ number: 123 }),
    /invalid labels response/u,
  );
  assert.equal(invalid.requests.length, 2);
});

test("a stop during an unknown label result reads nothing more", async () => {
  const controller = new AbortController();
  const { github, requests } = labelsComponent(() => {
    controller.abort();
    return unknownResult();
  });
  await assert.rejects(
    github.addPreviewLabel({ number: 123, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(requests.length, 1);
});

test("a definite rejection is never repeated and exposes only the status", async () => {
  const { github, requests } = labelsComponent(() => ({
    ok: false,
    status: 403,
  }));
  await assert.rejects(
    github.addPreviewLabel({ number: 123 }),
    (error) => error.status === 403 && !error.message.includes("synthetic"),
  );
  assert.equal(requests.length, 1);
});

test("reads the preview label and its revocation of a pull request", async () => {
  for (const [labels, expected] of [
    [[{ name: "preview" }], { previewLabeled: true, previewRevoked: false }],
    [
      [{ name: "preview-revoked" }],
      { previewLabeled: false, previewRevoked: true },
    ],
    [
      [{ name: "preview" }, { name: "preview-revoked" }],
      { previewLabeled: true, previewRevoked: true },
    ],
    [[], { previewLabeled: false, previewRevoked: false }],
  ]) {
    const github = new GitHubTrust({
      token: "synthetic",
      repository: "example/project",
      fetchImpl: async () => ({
        ok: true,
        json: async () => pullRequestResponse({ labels }),
      }),
    });
    const { previewLabeled, previewRevoked } = await github.getPullRequest({
      number: 1,
    });
    assert.deepEqual({ previewLabeled, previewRevoked }, expected);
  }
});

test("refuses a pull request response without its labels", async () => {
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({
      ok: true,
      json: async () => pullRequestResponse({ labels: undefined }),
    }),
  });
  await assert.rejects(
    github.getPullRequest({ number: 1 }),
    /invalid pull request response/u,
  );
});

test("reads every page of pull request comments and fails closed past the limit", async () => {
  const requested = [];
  const github = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async (url) => ({
      ok: true,
      json: async () => {
        requested.push(url);
        return pageOf(url) === "1"
          ? Array.from({ length: 100 }, (_, index) => ({ id: index }))
          : [{ id: 100 }];
      },
    }),
  });
  assert.equal((await github.listIssueComments({ number: 123 })).length, 101);
  for (const url of requested) {
    assert.equal(new URL(url).searchParams.has("since"), false);
  }

  const endless = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({
      ok: true,
      json: async () =>
        Array.from({ length: 100 }, (_, index) => ({ id: index })),
    }),
  });
  await assert.rejects(
    endless.listIssueComments({ number: 123 }),
    /pagination limit exceeded/u,
  );

  const invalid = new GitHubTrust({
    token: "synthetic",
    repository: "example/project",
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(
    invalid.listIssueComments({ number: 123 }),
    /invalid comments response/u,
  );
});
