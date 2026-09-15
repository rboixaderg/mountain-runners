// Tests for the trusted preview publisher (T6.3).
//
// Run with: node --test tools/preview/
//
// The suite verifies the publisher's trust chain: the pull request state is
// validated against trusted platform metadata (open, own-branch head SHA),
// the artifact built in the same workflow run is validated with the same
// validators as production, and the pull request state is revalidated
// immediately before activation. Closed pull requests, moved heads, fork
// heads, foreign manifests and the comment authorization (collaborator-only)
// are all rejected. No production credentials are involved.

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
  assertCommentAuthorized,
  publishPreview,
  resolvePullRequestState,
} from "./publish-operations.mjs";

const previewPullNumber = 99;
const previewCommit = "9".repeat(40);
const movedPreviewCommit = "7".repeat(40);

const previewFiles = [
  { path: "index.html", content: "<html>preview home</html>" },
  { path: "ca/index.html", content: "<html>hola preview</html>" },
];

const testRepository = "rboixaderg/mountain-runners";

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

// A fake GitHub API with the same trusted source the workflows use.
function createFakeFetch({
  pull = createPullResponse(),
  collaboratorStatus = 204,
} = {}) {
  return async (url) => {
    if (url.includes("/collaborators/")) {
      return {
        ok: collaboratorStatus === 204,
        status: collaboratorStatus,
        json: async () => ({}),
      };
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

function createTestPublisher(transport, artifactDirectory, { pull } = {}) {
  return publishPreview({
    artifactDirectory,
    pullNumber: previewPullNumber,
    resolvePullRequestState: async () =>
      resolvePullRequestState({
        repository: testRepository,
        pullNumber: previewPullNumber,
        fetchImpl: createFakeFetch({ pull }),
      }),
    transport,
  });
}

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

test("assertCommentAuthorized requires a repository collaborator", async () => {
  await assertCommentAuthorized({
    repository: testRepository,
    commentAuthor: "rboixaderg",
    fetchImpl: createFakeFetch({ collaboratorStatus: 204 }),
  });

  const rejections = [
    { name: "outside commenter", status: 404 },
    { name: "forbidden check", status: 403 },
  ];
  for (const { name, status } of rejections) {
    await assert.rejects(
      () =>
        assertCommentAuthorized({
          repository: testRepository,
          commentAuthor: "random-user",
          fetchImpl: createFakeFetch({ collaboratorStatus: status }),
        }),
      /not a repository collaborator/,
      `${name} must be rejected`,
    );
  }
});

test("publishPreview publishes a valid artifact end to end", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const message = await createTestPublisher(transport, artifactDirectory);
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
    await assert.rejects(
      () =>
        createTestPublisher(transport, artifactDirectory, {
          pull: createPullResponse({ state: "closed" }),
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
        () => createTestPublisher(transport, artifactDirectory),
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
        () => createTestPublisher(transport, artifactDirectory),
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
