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
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  makeManifest,
  makeNormalArchive,
  sha256Of,
} from "../server/release/adversarial-archive.mjs";
import { previewOrigin } from "../server/preview/config.mjs";
import { withPreviewAuthorization } from "../server/preview/test-authorization.mjs";
import {
  assertCommentAuthorized,
  assertDispatchActorAuthorized,
  publishPreview,
  resolvePullRequestState,
} from "./publish-operations.mjs";

const previewPullNumber = 99;
const previewCommit = "9".repeat(40);
const movedPreviewCommit = "7".repeat(40);
const authorizationKeys = generateKeyPairSync("ed25519");

const previewFiles = [
  { path: "index.html", content: "<html>preview home</html>" },
  { path: "ca/index.html", content: "<html>hola preview</html>" },
];

const testRepository = "rboixaderg/mountain-runners";
const gatePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../server/preview/gate.mjs",
);

function createPullResponse({
  state = "open",
  headSha = previewCommit,
  headRepository = testRepository,
  labels = [],
} = {}) {
  return {
    state,
    labels,
    head: { sha: headSha, repo: { full_name: headRepository } },
  };
}

// A fake GitHub API with the same trusted source the workflows use.
function createFakeFetch({
  pull = createPullResponse(),
  collaboratorStatus = 204,
  collaboratorPermissionStatus = 200,
  collaboratorPermission = "write",
} = {}) {
  return async (url) => {
    if (url.endsWith("/permission")) {
      return {
        ok: collaboratorPermissionStatus === 200,
        status: collaboratorPermissionStatus,
        json: async () => ({ permission: collaboratorPermission }),
      };
    }
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
    async receive(fileName, contents, pullNumber) {
      commands.push(`mountain-preview receive ${pullNumber} ${fileName}`);
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
      if (command.startsWith("mountain-preview site-enable ")) {
        return "Enabled preview site.";
      }
      if (command.startsWith("mountain-preview authorize ")) {
        return "Authorized preview.";
      }
      if (command.startsWith("mountain-preview list ")) {
        return "No releases registered.";
      }
      if (
        command.startsWith("mountain-preview retire ") ||
        command.startsWith("mountain-preview site-disable ")
      ) {
        return "Retired preview.";
      }
      if (command.startsWith("mountain-preview prune ")) {
        return "Pruned inactive preview releases and uploads.";
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

function createTestPublisher(
  transport,
  artifactDirectory,
  {
    pull,
    revalidateCommentAuthorization,
    revalidateDispatchAuthorization,
    verifyPreview = async () => {},
  } = {},
) {
  return publishPreview({
    artifactDirectory,
    pullNumber: previewPullNumber,
    authorizedBy: "maintainer",
    authorizationPrivateKey: authorizationKeys.privateKey,
    resolvePullRequestState: async () =>
      resolvePullRequestState({
        repository: testRepository,
        pullNumber: previewPullNumber,
        fetchImpl: createFakeFetch({ pull }),
      }),
    revalidateCommentAuthorization,
    revalidateDispatchAuthorization,
    transport,
    verifyPreview,
  });
}

function createGateTransport(root) {
  const commands = [];
  function runGate(command, contents) {
    commands.push(command);
    const result = spawnSync(process.execPath, [gatePath], {
      encoding: "utf8",
      input: contents,
      env: {
        ...process.env,
        MOUNTAIN_PREVIEW_ROOT: root,
        MOUNTAIN_PREVIEW_SITE_SOCKET: join(root, "site.sock"),
        SSH_ORIGINAL_COMMAND: command,
      },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim());
    }
    return result.stdout.trim();
  }
  return {
    commands,
    async receive(fileName, contents, pullNumber) {
      const output = runGate(
        `mountain-preview receive ${pullNumber} ${fileName}`,
        contents,
      );
      const match = /^Received (\S+) sha256:([0-9a-f]{64}) bytes:(\d+)$/u.exec(
        output,
      );
      assert.ok(match, output);
      return {
        fileName: match[1],
        sha256: match[2],
        bytes: Number(match[3]),
      };
    },
    async run(command, contents) {
      if (command.startsWith("mountain-preview site-enable ")) {
        commands.push(command);
        return "Enabled preview site.";
      }
      return runGate(command, contents);
    },
  };
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
      name: "revoked preview",
      pull: createPullResponse({ labels: [{ name: "preview-revoked" }] }),
      pattern: /revoked preview/,
    },
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

test("assertDispatchActorAuthorized requires current write permission", async () => {
  for (const permission of ["write", "admin"]) {
    await assertDispatchActorAuthorized({
      repository: testRepository,
      actor: "rboixaderg",
      fetchImpl: createFakeFetch({ collaboratorPermission: permission }),
    });
  }

  const rejections = [
    {
      name: "removed actor",
      options: { collaboratorPermissionStatus: 404 },
      pattern: /does not have current repository write permission/,
    },
    {
      name: "forbidden permission check",
      options: { collaboratorPermissionStatus: 403 },
      pattern: /does not have current repository write permission/,
    },
    {
      name: "read-only actor",
      options: { collaboratorPermission: "read" },
      pattern: /no longer has repository write permission/,
    },
    {
      name: "actor with no write permission",
      options: { collaboratorPermission: "none" },
      pattern: /no longer has repository write permission/,
    },
  ];
  for (const { name, options, pattern } of rejections) {
    await assert.rejects(
      () =>
        assertDispatchActorAuthorized({
          repository: testRepository,
          actor: "rboixaderg",
          fetchImpl: createFakeFetch(options),
        }),
      pattern,
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
      `mountain-preview receive ${previewPullNumber} mountain-runners-${previewCommit.slice(0, 12)}.tar.gz`,
      `mountain-preview receive ${previewPullNumber} manifest.json`,
      `mountain-preview install ${previewPullNumber} mountain-runners-${previewCommit.slice(0, 12)}.tar.gz manifest.json`,
      `mountain-preview authorize ${previewPullNumber} ${previewCommit} maintainer`,
      `mountain-preview list ${previewPullNumber}`,
      `mountain-preview site-enable ${previewPullNumber}`,
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
      `mountain-preview health ${previewPullNumber}`,
      `mountain-preview prune ${previewPullNumber}`,
    ]);
  });
});

test("publishPreview uses the real gate protocol in an isolated namespace", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "mountain-preview-publisher-gate-"),
  );
  try {
    await mkdir(join(root, "namespaces"), { recursive: true });
    await withPreviewAuthorization(
      root,
      async () => {
        await withPreviewArtifact(async (artifactDirectory) => {
          const transport = createGateTransport(root);
          await createTestPublisher(transport, artifactDirectory);
          assert.deepEqual(transport.commands, [
            `mountain-preview receive ${previewPullNumber} mountain-runners-${previewCommit.slice(0, 12)}.tar.gz`,
            `mountain-preview receive ${previewPullNumber} manifest.json`,
            `mountain-preview install ${previewPullNumber} mountain-runners-${previewCommit.slice(0, 12)}.tar.gz manifest.json`,
            `mountain-preview authorize ${previewPullNumber} ${previewCommit} maintainer`,
            `mountain-preview list ${previewPullNumber}`,
            `mountain-preview site-enable ${previewPullNumber}`,
            `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
            `mountain-preview health ${previewPullNumber}`,
            `mountain-preview prune ${previewPullNumber}`,
          ]);
        });
      },
      authorizationKeys,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a preview TLS or smoke failure removes a first publication", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      createTestPublisher(transport, artifactDirectory, {
        verifyPreview: async () => {
          throw new Error("TLS failed");
        },
      }),
      /TLS failed/,
    );
    assert.deepEqual(transport.commands.slice(-2), [
      `mountain-preview retire ${previewPullNumber}`,
      `mountain-preview site-disable ${previewPullNumber}`,
    ]);
  });
});

test("a failed update restores the previous active commit", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const oldRun = transport.run;
    transport.run = (command) => {
      if (command === `mountain-preview list ${previewPullNumber}`) {
        transport.commands.push(command);
        return `active   ${movedPreviewCommit} build 2026-09-01 installed 2026-09-01`;
      }
      return oldRun(command);
    };
    await assert.rejects(
      createTestPublisher(transport, artifactDirectory, {
        verifyPreview: async () => {
          throw new Error("smoke failed");
        },
      }),
      /smoke failed/,
    );
    assert.equal(
      transport.commands.at(-1),
      `mountain-preview activate ${previewPullNumber} ${movedPreviewCommit}`,
    );
  });
});

test("a prune failure does not report a published release as failed", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const originalRun = transport.run;
    transport.run = (command, stdin) => {
      if (command === `mountain-preview list ${previewPullNumber}`) {
        transport.commands.push(command);
        return `active   ${movedPreviewCommit} build 2026-09-01 installed 2026-09-01`;
      }
      if (command === `mountain-preview prune ${previewPullNumber}`) {
        transport.commands.push(command);
        throw new Error("prune failed");
      }
      return originalRun(command, stdin);
    };
    const message = await createTestPublisher(transport, artifactDirectory);
    assert.match(message, /Published preview/);
    assert.equal(
      transport.commands.at(-1),
      `mountain-preview prune ${previewPullNumber}`,
    );
  });
});

test("publishPreview does not activate after the requesting collaborator loses permission", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      () =>
        createTestPublisher(transport, artifactDirectory, {
          revalidateCommentAuthorization: () =>
            assertCommentAuthorized({
              repository: testRepository,
              commentAuthor: "rboixaderg",
              fetchImpl: createFakeFetch({ collaboratorStatus: 404 }),
            }),
        }),
      /not a repository collaborator/,
    );
    assert.equal(
      transport.commands.some((command) =>
        command.startsWith("mountain-preview activate"),
      ),
      false,
    );
  });
});

test("publishPreview revalidates dispatch write permission before successful activation", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    await createTestPublisher(transport, artifactDirectory, {
      revalidateDispatchAuthorization: () =>
        assertDispatchActorAuthorized({
          repository: testRepository,
          actor: "rboixaderg",
          fetchImpl: createFakeFetch({ collaboratorPermission: "write" }),
        }),
    });
    assert.equal(
      transport.commands.some((command) =>
        command.startsWith("mountain-preview activate"),
      ),
      true,
    );
  });
});

test("publishPreview does not activate after dispatch actor write permission is withdrawn", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      () =>
        createTestPublisher(transport, artifactDirectory, {
          revalidateDispatchAuthorization: () =>
            assertDispatchActorAuthorized({
              repository: testRepository,
              actor: "rboixaderg",
              fetchImpl: createFakeFetch({ collaboratorPermissionStatus: 404 }),
            }),
        }),
      /does not have current repository write permission/,
    );
    assert.equal(
      transport.commands.some((command) =>
        command.startsWith("mountain-preview activate"),
      ),
      false,
    );
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
