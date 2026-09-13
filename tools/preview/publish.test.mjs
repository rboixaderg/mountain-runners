// Tests for the trusted preview publisher (T6.3).
//
// Run with: node --test tools/preview/
//
// The suite verifies the publisher's trust chain: the source workflow run is
// validated against trusted platform metadata (repository, workflow, event,
// PR binding, head SHA and conclusion), the artifact is validated with the
// same validators as production, and the pull request state is revalidated
// immediately before activation. Forks, closed pull requests, moved heads,
// foreign manifests and malicious archives are all rejected. No production
// credentials are involved.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  makeManifest,
  makeNormalArchive,
  sha256Of,
} from "../server/release/adversarial-archive.mjs";
import { previewOrigin } from "../server/preview/config.mjs";
import {
  publishPreview,
  resolvePullRequestState,
  resolveSourceRun,
} from "./publish-operations.mjs";

const previewPullNumber = 99;
const previewCommit = "9".repeat(40);
const movedPreviewCommit = "7".repeat(40);

const previewFiles = [
  { path: "index.html", content: "<html>preview home</html>" },
  { path: "ca/index.html", content: "<html>hola preview</html>" },
];

const testRepository = "rboixaderg/mountain-runners";

function createRunResponse({
  event = "pull_request",
  conclusion = "success",
  headRepository = testRepository,
  pullRequests = [previewPullNumber],
  repository = testRepository,
  path = ".github/workflows/preview-build.yml",
} = {}) {
  return {
    id: 123456,
    event,
    conclusion,
    head_sha: previewCommit,
    path,
    repository: { full_name: repository },
    head_repository: { full_name: headRepository },
    pull_requests: pullRequests.map((number) => ({ number })),
  };
}

function createPullResponse({
  state = "open",
  headSha = previewCommit,
  headRepository = testRepository,
} = {}) {
  return {
    state,
    head: { sha: headSha, repo: { full_name: headRepository } },
  };
}

// A fake GitHub API: the run and the pull request responses come from the
// same trusted source the workflows use.
function createFakeFetch({
  run = createRunResponse(),
  pull = createPullResponse(),
} = {}) {
  return async (url) => {
    if (url.includes("/actions/runs/")) {
      return { ok: true, status: 200, json: async () => run };
    }
    if (url.includes(`/pulls/${previewPullNumber}`)) {
      return { ok: true, status: 200, json: async () => pull };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function createMemoryTransport() {
  const commands = [];
  return {
    commands,
    async receive(fileName, contents) {
      const digest = sha256Of(contents);
      return { fileName, sha256: digest, bytes: contents.length };
    },
    async run(command) {
      commands.push(command);
      if (command.startsWith("mountain-preview install")) {
        return `Installed release ${previewCommit} (${previewFiles.length} files).`;
      }
      if (command.startsWith("mountain-preview activate ")) {
        return `Activated release ${command.slice(
          "mountain-preview activate ".length +
            String(previewPullNumber).length +
            1,
        )}.`;
      }
      if (command.startsWith("mountain-preview health ")) {
        return "Health: OK";
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  };
}

// Stages an intermediate preview artifact in a temporary directory. The
// manifest binds the given commit, origin and pull request number.
async function withPreviewArtifact(
  run,
  { commit, origin, pullRequestNumber } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "mountain-preview-artifact-"));
  try {
    const manifest = makeManifest({
      commit: commit ?? previewCommit,
      files: previewFiles,
      origin: origin ?? previewOrigin(previewPullNumber),
      pullRequestNumber: pullRequestNumber ?? previewPullNumber,
    });
    const archiveName = `mountain-runners-${manifest.commit.slice(0, 12)}.tar.gz`;
    await makeNormalArchive(join(directory, archiveName), previewFiles);
    await writeFile(
      join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("resolveSourceRun accepts a successful same-repository pull request run", async () => {
  const run = await resolveSourceRun({
    repository: testRepository,
    runId: 123456,
    pullNumber: previewPullNumber,
    fetchImpl: createFakeFetch({}),
  });
  assert.equal(run.event, "pull_request");
  assert.equal(run.conclusion, "success");
});

test("resolveSourceRun rejects forks, other events, failed runs and unassociated runs", async () => {
  const rejections = [
    {
      name: "fork head",
      run: createRunResponse({ headRepository: "fork-owner/mountain-runners" }),
      pattern: /head repository is not this repository/,
    },
    {
      name: "other workflow",
      run: createRunResponse({ path: ".github/workflows/quality.yml" }),
      pattern: /workflow must be/,
    },
    {
      name: "push event",
      run: createRunResponse({ event: "push" }),
      pattern: /event must be pull_request/,
    },
    {
      name: "failed conclusion",
      run: createRunResponse({ conclusion: "failure" }),
      pattern: /conclusion must be success/,
    },
    {
      name: "run bound to another pull request",
      run: createRunResponse({ pullRequests: [98] }),
      pattern: /not associated with pull request/,
    },
    {
      name: "run with no pull request binding",
      run: createRunResponse({ pullRequests: [] }),
      pattern: /not associated with pull request/,
    },
    {
      name: "run from another repository",
      run: createRunResponse({ repository: "other-owner/other-repo" }),
      pattern: /does not belong to this repository/,
    },
  ];
  for (const { name, run, pattern } of rejections) {
    await assert.rejects(
      () =>
        resolveSourceRun({
          repository: testRepository,
          runId: 123456,
          pullNumber: previewPullNumber,
          fetchImpl: createFakeFetch({ run }),
        }),
      pattern,
      `${name} must be rejected`,
    );
  }
});

test("resolvePullRequestState accepts an open own-branch pull request and rejects the rest", async () => {
  const accepted = await resolvePullRequestState({
    repository: testRepository,
    pullNumber: previewPullNumber,
    fetchImpl: createFakeFetch({}),
  });
  assert.equal(accepted.headSha, previewCommit);

  const rejections = [
    {
      name: "closed pull request",
      pull: createPullResponse({ state: "closed" }),
      pattern: /only an open pull request/,
    },
    {
      name: "fork head",
      pull: createPullResponse({
        headRepository: "fork-owner/mountain-runners",
      }),
      pattern: /head repository is not this repository/,
    },
  ];
  for (const { name, pull, pattern } of rejections) {
    await assert.rejects(
      () =>
        resolvePullRequestState({
          repository: testRepository,
          pullNumber: previewPullNumber,
          fetchImpl: createFakeFetch({ pull }),
        }),
      pattern,
      `${name} must be rejected`,
    );
  }
});

test("publishPreview publishes a valid artifact end to end", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const message = await publishPreview({
      artifactDirectory,
      pullNumber: previewPullNumber,
      resolveSourceRun: async () =>
        resolveSourceRun({
          repository: testRepository,
          runId: 123456,
          pullNumber: previewPullNumber,
          fetchImpl: createFakeFetch({}),
        }),
      resolvePullRequestState: async () =>
        resolvePullRequestState({
          repository: testRepository,
          pullNumber: previewPullNumber,
          fetchImpl: createFakeFetch({}),
        }),
      transport,
    });
    assert.match(
      message,
      /Published preview .*pr-99\.preview\.mountainrunners\.cat/,
    );
    assert.deepEqual(transport.commands, [
      `mountain-preview install mountain-runners-${previewCommit.slice(0, 12)}.tar.gz manifest.json`,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
      `mountain-preview health ${previewPullNumber}`,
    ]);
  });
});

test("publishPreview rejects a moved pull request head immediately before activation", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    let pullRequestFetches = 0;
    await assert.rejects(
      () =>
        publishPreview({
          artifactDirectory,
          pullNumber: previewPullNumber,
          resolveSourceRun: async () =>
            resolveSourceRun({
              repository: testRepository,
              runId: 123456,
              pullNumber: previewPullNumber,
              fetchImpl: createFakeFetch({}),
            }),
          resolvePullRequestState: async () => {
            pullRequestFetches += 1;
            // The head moves between the first check and the pre-activation
            // revalidation, as if the author pushed while publishing ran.
            return resolvePullRequestState({
              repository: testRepository,
              pullNumber: previewPullNumber,
              fetchImpl: createFakeFetch({
                pull: createPullResponse({
                  headSha:
                    pullRequestFetches > 1 ? movedPreviewCommit : previewCommit,
                }),
              }),
            });
          },
          transport,
        }),
      /Refusing to activate a moved pull request/,
    );
    assert.equal(
      transport.commands.some((command) =>
        command.startsWith("mountain-preview activate"),
      ),
      false,
      "the activation must not run after the head moved",
    );
  });
});

test("publishPreview rejects a closed pull request", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const closedPullRequestFetch = createFakeFetch({
      pull: createPullResponse({ state: "closed" }),
    });
    await assert.rejects(
      () =>
        publishPreview({
          artifactDirectory,
          pullNumber: previewPullNumber,
          resolveSourceRun: async () =>
            resolveSourceRun({
              repository: testRepository,
              runId: 123456,
              pullNumber: previewPullNumber,
              fetchImpl: createFakeFetch({}),
            }),
          resolvePullRequestState: async () =>
            resolvePullRequestState({
              repository: testRepository,
              pullNumber: previewPullNumber,
              fetchImpl: closedPullRequestFetch,
            }),
          transport,
        }),
      /only an open pull request/,
    );
    assert.equal(transport.commands.length, 0);
  });
});

test("publishPreview rejects a manifest whose commit differs from the pull request head", async () => {
  await withPreviewArtifact(
    async (artifactDirectory) => {
      const transport = createMemoryTransport();
      await assert.rejects(
        () =>
          publishPreview({
            artifactDirectory,
            pullNumber: previewPullNumber,
            resolveSourceRun: async () =>
              resolveSourceRun({
                repository: testRepository,
                runId: 123456,
                pullNumber: previewPullNumber,
                fetchImpl: createFakeFetch({}),
              }),
            resolvePullRequestState: async () =>
              resolvePullRequestState({
                repository: testRepository,
                pullNumber: previewPullNumber,
                fetchImpl: createFakeFetch({}),
              }),
            transport,
          }),
        /does not match the candidate/,
      );
      assert.equal(transport.commands.length, 0);
    },
    { commit: movedPreviewCommit },
  );
});

test("publishPreview rejects a manifest built for another pull request", async () => {
  await withPreviewArtifact(
    async (artifactDirectory) => {
      const transport = createMemoryTransport();
      await assert.rejects(
        () =>
          publishPreview({
            artifactDirectory,
            pullNumber: previewPullNumber,
            resolveSourceRun: async () =>
              resolveSourceRun({
                repository: testRepository,
                runId: 123456,
                pullNumber: previewPullNumber,
                fetchImpl: createFakeFetch({}),
              }),
            resolvePullRequestState: async () =>
              resolvePullRequestState({
                repository: testRepository,
                pullNumber: previewPullNumber,
                fetchImpl: createFakeFetch({}),
              }),
            transport,
          }),
        /is not the production origin|does not match namespace/,
      );
      assert.equal(transport.commands.length, 0);
    },
    {
      commit: previewCommit,
      pullRequestNumber: 98,
      origin: previewOrigin(98),
    },
  );
});
