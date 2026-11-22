// Tests for the trusted preview publisher (T6.3).
//
// Run with: node --test tools/preview/
//
// The suite verifies the publisher's trust chain: the pull request state is
// validated against trusted platform metadata (open, own-branch head SHA),
// the artifact built in the same workflow run is validated with the same
// validators as production, and the pull request state is revalidated
// immediately before activation. Closed pull requests, moved heads, fork
// heads, foreign manifests and lost authorization
// are all rejected. No production credentials are involved.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RemoteCommandError } from "../deploy/ssh.mjs";
import {
  makeManifest,
  makeNormalArchive,
  sha256Of,
} from "../server/release/adversarial-archive.mjs";
import { previewOrigin } from "../server/preview/config.mjs";
import { withPreviewAuthorization } from "../server/preview/test-authorization.mjs";
import {
  assertActorWritePermission,
  preparePublishedPreviewComment,
  publishPreview,
  resolvePullRequestState,
} from "./publish-operations.mjs";
import { publishRequestOf } from "./publish.mjs";

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
  "../server/preview/commands/mountain-preview/cli.mjs",
);

function createPullResponse({
  state = "open",
  headSha = previewCommit,
  headRepository = testRepository,
  labels = [{ name: "preview" }],
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
    authorizedSha = previewCommit,
    request = {
      authorizedBy: "maintainer",
      revalidateActorAuthorization: async () => {},
    },
    revalidateActorAuthorization = request.revalidateActorAuthorization,
    verifyPreview = async () => {},
    onPublished = async () => {},
    prepareComment = async (publication) => () => onPublished(publication),
    markRetired,
    resolveState,
  } = {},
) {
  return publishPreview({
    artifactDirectory,
    pullNumber: previewPullNumber,
    authorizedSha,
    authorizedBy: request.authorizedBy,
    authorizationPrivateKey: authorizationKeys.privateKey,
    resolvePullRequestState:
      resolveState ??
      (() =>
        resolvePullRequestState({
          repository: testRepository,
          pullNumber: previewPullNumber,
          fetchImpl: createFakeFetch({ pull }),
        })),
    revalidateActorAuthorization,
    transport,
    markRetired,
    verifyPreview,
    prepareComment,
  });
}

test("preview comment is created with trusted URL and SHA and updated only when owned by the publisher", async () => {
  const writes = [];
  const fetchImpl = async (url, options) => {
    if (options.method) {
      writes.push({ url, ...options });
      return { ok: true };
    }
    return {
      ok: true,
      json: async () => [
        {
          id: 1,
          user: { login: "another-user" },
          body: "<!-- mountain-runners-preview -->",
        },
        {
          id: 2,
          user: { login: "github-actions[bot]" },
          body: "Unrelated comment",
        },
      ],
    };
  };
  const args = {
    repository: testRepository,
    pullNumber: previewPullNumber,
    headSha: previewCommit,
    origin: previewOrigin(previewPullNumber),
    fetchImpl,
  };
  await (
    await preparePublishedPreviewComment(args)
  )();
  assert.equal(writes[0].method, "POST");
  assert.match(writes[0].url, /\/issues\/99\/comments$/);
  assert.match(JSON.parse(writes[0].body).body, /pr-99.*9{40}/s);

  const ownedFetch = async (url, options) => {
    if (options.method) {
      writes.push({ url, ...options });
      return { ok: true };
    }
    return {
      ok: true,
      json: async () => [
        {
          id: 3,
          user: { login: "github-actions[bot]" },
          body: "<!-- mountain-runners-preview -->\nOld preview",
        },
      ],
    };
  };
  await (
    await preparePublishedPreviewComment({ ...args, fetchImpl: ownedFetch })
  )();
  assert.equal(writes[1].method, "PATCH");
  assert.match(writes[1].url, /\/issues\/comments\/3$/);
  assert.equal(writes[0].body, writes[1].body);
});

test("preview comment searches later pages before creating a new one and fails closed on API errors", async () => {
  let page = 0;
  const writes = [];
  const args = {
    repository: testRepository,
    pullNumber: previewPullNumber,
    headSha: previewCommit,
    origin: previewOrigin(previewPullNumber),
  };
  const writeComment = await preparePublishedPreviewComment({
    ...args,
    fetchImpl: async (url, options) => {
      if (options.method) {
        writes.push({ url, method: options.method });
        return { ok: true };
      }
      page += 1;
      return {
        ok: true,
        json: async () =>
          page === 1
            ? Array.from({ length: 100 }, () => ({ user: { login: "reader" } }))
            : [
                {
                  id: 42,
                  user: { login: "github-actions[bot]" },
                  body: "<!-- mountain-runners-preview -->",
                },
              ],
      };
    },
  });
  await writeComment();
  assert.equal(page, 2);
  assert.deepEqual(
    writes.map(({ method }) => method),
    ["PATCH"],
  );
  await assert.rejects(
    () =>
      preparePublishedPreviewComment({
        ...args,
        fetchImpl: async () => ({ ok: false, status: 403 }),
      }),
    /Cannot list preview comments/,
  );
});

test("a successful activation notifies only after smoke and renewed authorization", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const notifications = [];
    let authorizationChecks = 0;
    let smokePassed = false;
    await createTestPublisher(transport, artifactDirectory, {
      revalidateActorAuthorization: async () => {
        authorizationChecks += 1;
      },
      verifyPreview: async () => {
        smokePassed = true;
      },
      onPublished: async (publication) => {
        notifications.push(publication);
        assert.equal(transport.commands.at(-1), "mountain-preview health 99");
        assert.equal(authorizationChecks, 4);
        assert.equal(smokePassed, true);
      },
    });
    assert.deepEqual(notifications, [
      { origin: previewOrigin(previewPullNumber), headSha: previewCommit },
    ]);
  });
});

test("no notification follows a failed activation, smoke, or changed PR after activation", async () => {
  for (const failure of ["activation", "smoke", "closed", "fork", "moved"]) {
    await withPreviewArtifact(async (artifactDirectory) => {
      const transport = createMemoryTransport();
      const run = transport.run;
      if (failure === "activation") {
        transport.run = (command, contents) => {
          if (command.startsWith("mountain-preview activate "))
            throw new Error("activation failed");
          return run(command, contents);
        };
      }
      let pull = createPullResponse();
      let notified = false;
      await assert.rejects(
        () =>
          createTestPublisher(transport, artifactDirectory, {
            resolveState: async () => {
              return resolvePullRequestState({
                repository: testRepository,
                pullNumber: previewPullNumber,
                fetchImpl: createFakeFetch({ pull }),
              });
            },
            verifyPreview: async () => {
              if (failure === "smoke") throw new Error("smoke failed");
              pull = createPullResponse({
                state: failure === "closed" ? "closed" : "open",
                headRepository:
                  failure === "fork" ? "someone/fork" : testRepository,
                headSha:
                  failure === "moved" ? movedPreviewCommit : previewCommit,
              });
            },
            onPublished: async () => {
              notified = true;
            },
          }),
        undefined,
        failure,
      );
      assert.equal(notified, false, failure);
    });
  }
});

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

test("assertActorWritePermission requires current write permission", async () => {
  for (const permission of ["write", "admin"]) {
    await assertActorWritePermission({
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
        assertActorWritePermission({
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
      `mountain-preview list ${previewPullNumber}`,
      `mountain-preview authorize ${previewPullNumber} ${previewCommit} maintainer`,
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
            `mountain-preview list ${previewPullNumber}`,
            `mountain-preview authorize ${previewPullNumber} ${previewCommit} maintainer`,
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

test("a failure before activation keeps the previous commit and the original error", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const originalRun = transport.run;
    transport.run = (command, stdin) => {
      if (command === `mountain-preview list ${previewPullNumber}`) {
        transport.commands.push(command);
        return `active   ${movedPreviewCommit} build 2026-09-01 installed 2026-09-01`;
      }
      return originalRun(command, stdin);
    };
    let authorizationChecks = 0;
    await assert.rejects(
      createTestPublisher(transport, artifactDirectory, {
        revalidateActorAuthorization: () => {
          authorizationChecks += 1;
          if (authorizationChecks === 3)
            throw new Error("Permission withdrawn");
        },
      }),
      /Permission withdrawn/,
    );
    assert.equal(transport.commands.at(-1), "mountain-preview site-enable 99");
    assert.equal(
      transport.commands.some((command) =>
        command.startsWith("mountain-preview activate"),
      ),
      false,
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

test("a comment write failure leaves the preview active and still prunes", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      createTestPublisher(transport, artifactDirectory, {
        onPublished: async () => {
          throw new Error("Comment unavailable");
        },
      }),
      /Comment unavailable/,
    );
    assert.deepEqual(transport.commands.slice(-3), [
      `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
      `mountain-preview health ${previewPullNumber}`,
      `mountain-preview prune ${previewPullNumber}`,
    ]);
  });
});

test("a transient PR API failure before activation preserves the existing preview", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const run = transport.run;
    transport.run = (command) => {
      if (command === `mountain-preview list ${previewPullNumber}`) {
        return `active ${movedPreviewCommit}`;
      }
      return run(command);
    };
    await assert.rejects(
      createTestPublisher(transport, artifactDirectory, {
        resolveState: () =>
          resolvePullRequestState({
            repository: testRepository,
            pullNumber: previewPullNumber,
            fetchImpl: async () => {
              if (
                transport.commands.includes(
                  `mountain-preview site-enable ${previewPullNumber}`,
                )
              ) {
                return { ok: false, status: 503 };
              }
              return { ok: true, json: async () => createPullResponse() };
            },
          }),
      }),
      /Cannot read pull request 99 \(503\)/,
    );
    assert.equal(
      transport.commands.at(-1),
      `mountain-preview site-enable ${previewPullNumber}`,
    );
  });
});

for (const rollbackFails of [false, true]) {
  test(`an update ${rollbackFails ? "withdraws if rollback fails" : "rolls back"} when the actor loses write access after smoke`, async () => {
    await withPreviewArtifact(async (artifactDirectory) => {
      const transport = createMemoryTransport();
      const run = transport.run;
      transport.run = (command) => {
        if (command === `mountain-preview list ${previewPullNumber}`) {
          return `active ${movedPreviewCommit}`;
        }
        if (
          rollbackFails &&
          command ===
            `mountain-preview activate ${previewPullNumber} ${movedPreviewCommit}`
        ) {
          transport.commands.push(command);
          throw new Error("Previous authorization expired");
        }
        return run(command);
      };
      let actorCanWrite = true;
      const comments = [];
      const retired = [];
      await assert.rejects(
        createTestPublisher(transport, artifactDirectory, {
          revalidateActorAuthorization: async () => {
            if (!actorCanWrite) throw new Error("Permission withdrawn");
          },
          verifyPreview: async () => {
            actorCanWrite = false;
          },
          onPublished: async (comment) => comments.push(comment),
          markRetired: async (pullNumber) => retired.push(pullNumber),
        }),
        rollbackFails
          ? /Permission withdrawn.*Rollback failed: Previous authorization expired/
          : /Permission withdrawn/,
      );
      const expectedTail = [
        `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
        `mountain-preview health ${previewPullNumber}`,
        `mountain-preview activate ${previewPullNumber} ${movedPreviewCommit}`,
      ];
      if (rollbackFails)
        expectedTail.push(
          `mountain-preview retire ${previewPullNumber}`,
          `mountain-preview site-disable ${previewPullNumber}`,
        );
      assert.deepEqual(
        transport.commands.slice(-expectedTail.length),
        expectedTail,
      );
      assert.deepEqual(retired, rollbackFails ? [previewPullNumber] : []);
      assert.deepEqual(comments, []);
    });
  });
}

test("the comment lookup completes before final authorization and PR checks, with no URL write after revocation", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    const checks = [];
    const writes = [];
    const retired = [];
    let labels = [{ name: "preview" }];
    let smokePassed = false;
    await assert.rejects(
      createTestPublisher(transport, artifactDirectory, {
        verifyPreview: async () => {
          smokePassed = true;
        },
        revalidateActorAuthorization: async () => {
          checks.push("actor");
        },
        resolveState: () => {
          checks.push("PR");
          return resolvePullRequestState({
            repository: testRepository,
            pullNumber: previewPullNumber,
            fetchImpl: createFakeFetch({
              pull: createPullResponse({ labels }),
            }),
          });
        },
        prepareComment: (publication) =>
          preparePublishedPreviewComment({
            ...publication,
            repository: testRepository,
            pullNumber: previewPullNumber,
            fetchImpl: async (url, options) => {
              if (options.method) {
                writes.push(options.method);
                return { ok: true };
              }
              assert.equal(smokePassed, true);
              checks.push("lookup");
              labels = [...labels, { name: "preview-revoked" }];
              return { ok: true, json: async () => [] };
            },
          }),
        markRetired: async (pullNumber) => retired.push(pullNumber),
      }),
      /revoked preview/,
    );
    assert.deepEqual(checks, [
      "actor",
      "PR",
      "actor",
      "PR",
      "actor",
      "PR",
      "lookup",
      "actor",
      "PR",
    ]);
    assert.deepEqual(writes, []);
    assert.deepEqual(retired, [previewPullNumber]);
  });
});

for (const [eventName, actor] of [
  ["pull_request_target", "label-sender"],
  ["workflow_dispatch", "workflow-actor"],
]) {
  test(`${eventName} revalidates both labels and its actor before authorize, activate and comment`, async () => {
    await withPreviewArtifact(async (artifactDirectory) => {
      for (const { labels, permissionDenied, reason } of [
        { labels: [], reason: /no longer has the preview label/ },
        {
          labels: [{ name: "preview" }, { name: "preview-revoked" }],
          reason: /revoked preview/,
        },
        {
          permissionDenied: true,
          reason: /no longer has repository write permission/,
        },
        {
          labels: [],
          permissionDenied: true,
          reason: /no longer has the preview label/,
        },
        {
          labels: [{ name: "preview" }, { name: "preview-revoked" }],
          permissionDenied: true,
          reason: /revoked preview/,
        },
      ]) {
        const prIneligible = labels !== undefined;
        // The first read precedes the transfer. The remaining reads precede
        // authorization, activation and the publisher's URL comment.
        for (const failedRead of [1, 2, 3, 4]) {
          const transport = createMemoryTransport();
          let eligibilityLost = failedRead === 1;
          const run = transport.run;
          transport.run = (command, contents) => {
            if (
              failedRead === 2 &&
              command.startsWith("mountain-preview install ")
            ) {
              eligibilityLost = true;
            }
            if (
              failedRead === 3 &&
              command.startsWith("mountain-preview site-enable ")
            ) {
              eligibilityLost = true;
            }
            if (
              prIneligible &&
              command === `mountain-preview list ${previewPullNumber}`
            ) {
              return `active ${movedPreviewCommit}`;
            }
            return run(command, contents);
          };
          const retired = [];
          const comments = [];
          const request = publishRequestOf({
            eventName,
            event: { sender: { login: "label-sender" } },
            workflowActor: "workflow-actor",
            repository: testRepository,
            fetchImpl: async (url) => {
              assert.equal(
                new URL(url).pathname,
                `/repos/${testRepository}/collaborators/${actor}/permission`,
              );
              return createFakeFetch({
                collaboratorPermission:
                  permissionDenied && eligibilityLost ? "read" : "write",
              })(url);
            },
          });
          assert.equal(request.authorizedBy, actor);
          await assert.rejects(
            createTestPublisher(transport, artifactDirectory, {
              request,
              markRetired: async (pullNumber) => retired.push(pullNumber),
              onPublished: async (publication) => comments.push(publication),
              verifyPreview: async () => {
                if (failedRead === 4) eligibilityLost = true;
              },
              resolveState: () => {
                return resolvePullRequestState({
                  repository: testRepository,
                  pullNumber: previewPullNumber,
                  fetchImpl: createFakeFetch({
                    pull: createPullResponse({
                      labels: eligibilityLost ? labels : undefined,
                    }),
                  }),
                });
              },
            }),
            reason,
            `eligibility changed at read ${failedRead}`,
          );
          assert.deepEqual(comments, []);
          assert.equal(
            transport.commands.includes(
              `mountain-preview authorize ${previewPullNumber} ${previewCommit} ${actor}`,
            ),
            failedRead > 2,
          );
          assert.equal(
            transport.commands.includes(
              `mountain-preview activate ${previewPullNumber} ${previewCommit}`,
            ),
            failedRead === 4,
          );
          if (prIneligible || failedRead >= 3) {
            assert.deepEqual(transport.commands.slice(-2), [
              `mountain-preview retire ${previewPullNumber}`,
              `mountain-preview site-disable ${previewPullNumber}`,
            ]);
            assert.deepEqual(retired, [previewPullNumber]);
          }
        }
      }
    });
  });
}

test("publishPreview rejects a moved pull request head immediately before activation", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    let pullRequestFetches = 0;
    await assert.rejects(
      () =>
        createTestPublisher(transport, artifactDirectory, {
          resolveState: async () => {
            pullRequestFetches += 1;
            // The head moves between the first check and the pre-activation
            // revalidation, as if the author pushed while publishing ran.
            return resolvePullRequestState({
              repository: testRepository,
              pullNumber: previewPullNumber,
              fetchImpl: createFakeFetch({
                pull: createPullResponse({
                  headSha:
                    pullRequestFetches > 2 ? movedPreviewCommit : previewCommit,
                }),
              }),
            });
          },
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

for (const labelRemoved of [true, false]) {
  test(`a failed comment lookup still ${labelRemoved ? "withdraws after label removal" : "rolls back after actor denial"} without pruning`, async () => {
    await withPreviewArtifact(async (artifactDirectory) => {
      const transport = createMemoryTransport();
      const run = transport.run;
      transport.run = (command, contents) => {
        if (command === `mountain-preview list ${previewPullNumber}`)
          return `active ${movedPreviewCommit}`;
        return run(command, contents);
      };
      let lookupFailed = false;
      const retired = [];
      await assert.rejects(
        createTestPublisher(transport, artifactDirectory, {
          prepareComment: async () => {
            lookupFailed = true;
            throw new Error("Cannot list preview comments");
          },
          revalidateActorAuthorization: async () => {
            if (lookupFailed && !labelRemoved)
              throw new Error("Permission withdrawn");
          },
          resolveState: () =>
            resolvePullRequestState({
              repository: testRepository,
              pullNumber: previewPullNumber,
              fetchImpl: createFakeFetch({
                pull: createPullResponse({
                  labels: lookupFailed && labelRemoved ? [] : undefined,
                }),
              }),
            }),
          markRetired: async (pullNumber) => retired.push(pullNumber),
        }),
        labelRemoved
          ? /no longer has the preview label/
          : /Permission withdrawn/,
      );
      assert.equal(
        transport.commands.includes(
          `mountain-preview prune ${previewPullNumber}`,
        ),
        false,
      );
      assert.equal(
        transport.commands.at(-1),
        labelRemoved
          ? `mountain-preview site-disable ${previewPullNumber}`
          : `mountain-preview activate ${previewPullNumber} ${movedPreviewCommit}`,
      );
      assert.deepEqual(retired, labelRemoved ? [previewPullNumber] : []);
    });
  });
}

for (const { failedCommand, failure, withdraw } of [
  {
    failedCommand: "authorize",
    failure: new RemoteCommandError(
      "Invalid preview authorization signature.",
      {
        status: 1,
      },
    ),
    withdraw: false,
  },
  {
    failedCommand: "authorize",
    failure: new RemoteCommandError("Preview site manager timed out.", {
      status: 1,
    }),
    withdraw: true,
  },
  {
    failedCommand: "authorize",
    failure: new RemoteCommandError("SSH outcome unknown (255)", {
      status: 255,
    }),
    withdraw: true,
  },
  {
    failedCommand: "authorize",
    failure: new Error("Transport timeout"),
    withdraw: true,
  },
  {
    failedCommand: "site-enable",
    failure: new Error("Response lost after authorization"),
    withdraw: true,
  },
]) {
  test(`a same-SHA retry ${withdraw ? "withdraws" : "preserves the preview"} when ${failedCommand} fails: ${failure.message}`, async () => {
    await withPreviewArtifact(async (artifactDirectory) => {
      const transport = createMemoryTransport();
      const run = transport.run;
      let failedOperation;
      transport.run = (command, contents) => {
        if (command === `mountain-preview list ${previewPullNumber}`)
          return `active ${previewCommit}`;
        if (command.startsWith(`mountain-preview ${failedCommand} `)) {
          failedOperation = command;
          transport.commands.push(command);
          throw failure;
        }
        return run(command, contents);
      };
      const retired = [];
      await assert.rejects(
        createTestPublisher(transport, artifactDirectory, {
          markRetired: async (pullNumber) => retired.push(pullNumber),
        }),
        (error) => error === failure,
      );
      assert.ok(failedOperation);
      assert.deepEqual(
        transport.commands.slice(
          transport.commands.indexOf(failedOperation) + 1,
        ),
        withdraw
          ? [
              `mountain-preview retire ${previewPullNumber}`,
              `mountain-preview site-disable ${previewPullNumber}`,
            ]
          : [],
      );
      assert.deepEqual(retired, withdraw ? [previewPullNumber] : []);
    });
  });
}

for (const { outcome, health, rollbackFailure } of [
  { outcome: "restores the previous release" },
  {
    outcome: "withdraws if rollback fails",
    rollbackFailure: "Previous release expired",
  },
  {
    outcome: "preserves the healthy release when the pointer never switched",
    health: "Health: OK",
  },
  {
    outcome: "withdraws when the unchanged pointer is unhealthy",
    health: "Health: DEGRADED",
    rollbackFailure: "Health: DEGRADED",
  },
]) {
  test(`an unknown activation result ${outcome}`, async () => {
    await withPreviewArtifact(async (artifactDirectory) => {
      const transport = createMemoryTransport();
      const run = transport.run;
      const activation = `mountain-preview activate ${previewPullNumber} ${previewCommit}`;
      const rollback = `mountain-preview activate ${previewPullNumber} ${movedPreviewCommit}`;
      const checkHealth = `mountain-preview health ${previewPullNumber}`;
      transport.run = (command, contents) => {
        if (command === `mountain-preview list ${previewPullNumber}`)
          return `active ${movedPreviewCommit}`;
        if (command === activation) {
          transport.commands.push(command);
          throw new Error("Activation result unknown");
        }
        if (command === rollback && health) {
          transport.commands.push(command);
          throw new RemoteCommandError(
            `Release ${movedPreviewCommit} is not eligible (active)`,
            { status: 1 },
          );
        }
        if (command === rollback && rollbackFailure) {
          transport.commands.push(command);
          throw new Error(rollbackFailure);
        }
        if (command === checkHealth && health) {
          transport.commands.push(command);
          return health;
        }
        return run(command, contents);
      };
      const retired = [];
      await assert.rejects(
        createTestPublisher(transport, artifactDirectory, {
          markRetired: async (pullNumber) => retired.push(pullNumber),
        }),
        rollbackFailure
          ? {
              name: "AggregateError",
              message: `Activation result unknown Rollback failed: ${rollbackFailure}`,
            }
          : { name: "Error", message: "Activation result unknown" },
      );
      const expectedTail = [activation, rollback];
      if (health) expectedTail.push(checkHealth);
      if (rollbackFailure)
        expectedTail.push(
          `mountain-preview retire ${previewPullNumber}`,
          `mountain-preview site-disable ${previewPullNumber}`,
        );
      assert.deepEqual(
        transport.commands.slice(-expectedTail.length),
        expectedTail,
      );
      assert.deepEqual(retired, rollbackFailure ? [previewPullNumber] : []);
    });
  });
}

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
    assert.deepEqual(transport.commands, [
      `mountain-preview retire ${previewPullNumber}`,
      `mountain-preview site-disable ${previewPullNumber}`,
    ]);
  });
});

test("publishPreview rejects a manifest whose commit differs from the authorized SHA", async () => {
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

test("publishPreview rejects a manifest matching the live head when that head was not authorized", async () => {
  await withPreviewArtifact(async (artifactDirectory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      createTestPublisher(transport, artifactDirectory, {
        authorizedSha: movedPreviewCommit,
      }),
      /live head .* does not match authorized SHA/,
    );
    assert.deepEqual(transport.commands, []);
  });
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

test("a comment event cannot authorize publication", () => {
  assert.throws(
    () =>
      publishRequestOf({
        eventName: "issue_comment",
        event: { comment: { body: "/preview", user: { login: "maintainer" } } },
        workflowActor: "maintainer",
        repository: testRepository,
      }),
    /Unsupported preview event/,
  );
});
