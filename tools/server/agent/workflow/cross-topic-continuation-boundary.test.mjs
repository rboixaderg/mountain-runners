import assert from "node:assert/strict";
import { test } from "node:test";
import { createCrossTopicContinuation } from "./cross-topic-continuation.mjs";

const repositoryName = "example/project";
const request = {
  updateIdentifier: 7,
  sessionKey: "-100123:7",
  instruction: "Continua la PR #42",
};
const validPullRequest = {
  state: "open",
  draft: false,
  baseRef: "main",
  headRepository: repositoryName,
  headRef: "feat/agent-synthetic",
  headSha: "a".repeat(40),
};

test("refuses an ineligible pull request before looking up its owner or touching worktrees", async () => {
  for (const override of [
    { state: "closed" },
    { draft: true },
    { baseRef: "other" },
    { headRepository: "another/fork" },
    { headRef: "main" },
  ]) {
    const continuation = createCrossTopicContinuation({
      repositoryPath: "/unavailable",
      worktreeRoot: "/unavailable",
      identifiers: {},
      repositoryName,
      readPullRequest: async () => ({ ...validPullRequest, ...override }),
      findOwner: () =>
        assert.fail("an ineligible pull request has no owner lookup"),
    });
    const result = await continuation(request);
    assert.equal(typeof result.report, "string", JSON.stringify(override));
    assert.equal(result.resume, undefined);
  }
});

test("refuses a pull request without a service publication", async () => {
  const continuation = createCrossTopicContinuation({
    repositoryPath: "/unavailable",
    worktreeRoot: "/unavailable",
    identifiers: {},
    repositoryName,
    readPullRequest: async () => validPullRequest,
    findOwner: () => undefined,
  });
  const result = await continuation(request);
  assert.match(result.report, /no la va preparar aquest servei/u);
  assert.equal(result.resume, undefined);
});

test("refuses an ambiguous request without reading GitHub", async () => {
  const continuation = createCrossTopicContinuation({
    repositoryPath: "/unavailable",
    worktreeRoot: "/unavailable",
    identifiers: {},
    repositoryName,
    readPullRequest: async () =>
      assert.fail("ambiguous requests must not read GitHub"),
  });
  const result = await continuation({
    ...request,
    instruction: "Continua #42 i #43",
  });
  assert.match(result.report, /més d'una proposta/u);
  assert.equal(result.resume, undefined);
});

test("refuses a pull request whose GitHub state cannot be read", async () => {
  const continuation = createCrossTopicContinuation({
    repositoryPath: "/unavailable",
    worktreeRoot: "/unavailable",
    identifiers: {},
    repositoryName,
    readPullRequest: async () => {
      throw new Error("Synthetic GitHub failure.");
    },
    findOwner: () =>
      assert.fail("an unreadable pull request has no owner lookup"),
  });
  const result = await continuation(request);
  assert.match(result.report, /No he pogut llegir/u);
  assert.equal(result.resume, undefined);
});
