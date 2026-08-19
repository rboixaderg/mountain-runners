// Deploy and rollback orchestration (phase 5, task 5.4).
//
// Covers stale-head rejection, digest verification, failure before and after
// activation, exact restoration of the displaced commit, revoked releases,
// smoke tests and the protected workflow contract without any production
// credentials.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadVerifiedArtifact, productionOrigin } from "./artifact.mjs";
import {
  createGithubHeadResolver,
  createSmokeRunner,
  deployRelease,
  rollbackRelease,
  smokeExpectsNoIndex,
} from "./operations.mjs";
import {
  assertCurrentHead,
  resolveProtectedHead,
  StaleCommitError,
} from "./protected-branch.mjs";
import {
  parseReceiveMessage,
  RemoteCommandError,
  createSshTransport,
} from "./ssh.mjs";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(toolDirectory, "../..");
const testCommit = "1f8611b283f924aab99aa98a6cff524306138a46";
const newerCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const previousCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function withArtifact(
  run,
  { origin = productionOrigin, commit = testCommit } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "mountain-deploy-artifact-"));
  try {
    const content = "<html>home</html>";
    const sourceDirectory = join(directory, "src");
    await mkdir(sourceDirectory);
    await writeFile(join(sourceDirectory, "index.html"), content);
    const archiveFileName = `mountain-runners-${commit.slice(0, 12)}.tar.gz`;
    const packed = spawnSync(
      "tar",
      [
        "-czf",
        join(directory, archiveFileName),
        "-C",
        sourceDirectory,
        "index.html",
      ],
      { encoding: "utf8" },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const manifest = {
      schemaVersion: 1,
      commit,
      origin,
      buildToday: "2026-08-18",
      workflow: "Artifact",
      limits: { maxExpandedBytes: 134_217_728, maxFileCount: 5_000 },
      totals: {
        fileCount: 1,
        expandedBytes: Buffer.byteLength(content),
      },
      files: [
        {
          path: "index.html",
          size: Buffer.byteLength(content),
          sha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
    };
    await writeFile(
      join(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return await run(directory, archiveFileName);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function createMemoryTransport({ receiveSha256, commands: scripted } = {}) {
  const commands = [];
  const received = [];
  return {
    commands,
    received,
    async receive(fileName, contents) {
      const sha256 = sha256Of(contents);
      received.push({ fileName, sha256, bytes: contents.length });
      return {
        fileName,
        sha256: receiveSha256?.[fileName] ?? sha256,
        bytes: contents.length,
      };
    },
    async run(command) {
      commands.push(command);
      const scriptedResult = scripted?.[command];
      if (typeof scriptedResult === "function") {
        return scriptedResult(command);
      }
      if (scriptedResult instanceof Error) {
        throw scriptedResult;
      }
      if (typeof scriptedResult === "string") {
        return scriptedResult;
      }
      if (command === "mountain-release list") {
        return `active   ${previousCommit} build 2026-08-18 installed 2026-08-18T00:00:00.000Z`;
      }
      if (command.startsWith("mountain-release install")) {
        return `Installed release ${testCommit} (1 files).`;
      }
      if (command.startsWith("mountain-release activate ")) {
        return `Activated release ${command.slice("mountain-release activate ".length)}.`;
      }
      if (command === "mountain-release health") {
        return "Health: OK";
      }
      if (command.startsWith("mountain-release rollback")) {
        return `Activated release ${previousCommit}.\nRolled back to release ${previousCommit}.`;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  };
}

function headSequence(values) {
  let index = 0;
  return async () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

test("loadVerifiedArtifact accepts a matching archive and rejects commit or origin drift", async () => {
  await withArtifact(async (directory) => {
    const artifact = await loadVerifiedArtifact(directory, {
      expectedCommit: testCommit,
    });
    assert.equal(artifact.manifest.commit, testCommit);
    assert.equal(artifact.archiveSha256.length, 64);
  });

  await withArtifact(
    async (directory) => {
      await assert.rejects(
        () =>
          loadVerifiedArtifact(directory, {
            expectedCommit: newerCommit,
          }),
        /does not match the candidate/,
      );
    },
    { commit: testCommit },
  );

  await withArtifact(
    async (directory) => {
      await assert.rejects(
        () =>
          loadVerifiedArtifact(directory, {
            expectedCommit: testCommit,
          }),
        /is not the production origin/,
      );
    },
    { origin: "https://example.invalid" },
  );
});

test("a stale protected head is rejected before and after staging", async () => {
  assert.throws(
    () => assertCurrentHead(testCommit, newerCommit),
    StaleCommitError,
  );

  await withArtifact(async (directory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: async () => newerCommit,
          transport,
          smoke: async () => {},
        }),
      StaleCommitError,
    );
    assert.equal(transport.received.length, 0);
    assert.equal(transport.commands.length, 0);
  });

  await withArtifact(async (directory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: headSequence([testCommit, newerCommit]),
          transport,
          smoke: async () => {},
        }),
      StaleCommitError,
    );
    assert.equal(transport.received.length, 2);
    assert.equal(
      transport.commands.some((command) =>
        command.startsWith("mountain-release activate"),
      ),
      false,
    );
  });
});

test("a digest mismatch after transfer does not install or activate", async () => {
  await withArtifact(async (directory, archiveFileName) => {
    const transport = createMemoryTransport({
      receiveSha256: { [archiveFileName]: "0".repeat(64) },
    });
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: async () => testCommit,
          transport,
          smoke: async () => {},
        }),
      /Digest mismatch/,
    );
    assert.equal(transport.commands.length, 0);
  });
});

test("install failure leaves the live pointer unchanged", async () => {
  await withArtifact(async (directory) => {
    const transport = createMemoryTransport({
      commands: {
        [`mountain-release install mountain-runners-${testCommit.slice(0, 12)}.tar.gz manifest.json`]:
          new RemoteCommandError("install exploded", {
            status: 1,
            stdout: "",
            stderr: "install exploded",
          }),
      },
    });
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: async () => testCommit,
          transport,
          smoke: async () => {
            throw new Error("smoke must not run");
          },
        }),
      /install exploded/,
    );
    assert.equal(
      transport.commands.some((command) =>
        command.startsWith("mountain-release activate"),
      ),
      false,
    );
  });
});

test("smoke failure after activation restores the displaced commit", async () => {
  await withArtifact(async (directory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: async () => testCommit,
          transport,
          smoke: async () => {
            throw new Error("smoke failed");
          },
        }),
      /verification failed; restored/,
    );
    assert.equal(
      transport.commands.at(-1),
      `mountain-release activate ${previousCommit}`,
    );
    assert.equal(
      transport.commands.includes("mountain-release rollback"),
      false,
    );
  });
});

test("smoke failure on a first release records the emergency response", async () => {
  await withArtifact(async (directory) => {
    const transport = createMemoryTransport({
      commands: {
        "mountain-release list": "No releases registered.",
      },
    });
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: async () => testCommit,
          transport,
          smoke: async () => {
            throw new Error("smoke failed");
          },
        }),
      /no previous release to restore; apply the emergency response/,
    );
    assert.equal(
      transport.commands.includes("mountain-release rollback"),
      false,
    );
    assert.equal(
      transport.commands.filter((command) =>
        command.startsWith("mountain-release activate"),
      ).length,
      1,
    );
  });
});

test("an already-active candidate is verified and not rolled back", async () => {
  await withArtifact(async (directory) => {
    const transport = createMemoryTransport({
      commands: {
        [`mountain-release activate ${testCommit}`]: new RemoteCommandError(
          `Release ${testCommit} is not eligible (active).`,
          { status: 1, stdout: "", stderr: "active" },
        ),
      },
    });
    const message = await deployRelease({
      artifactDirectory: directory,
      candidateCommit: testCommit,
      resolveHead: async () => testCommit,
      transport,
      smoke: async () => {},
    });
    assert.match(message, /already active/);
    assert.equal(
      transport.commands.includes("mountain-release rollback"),
      false,
    );
    assert.equal(
      transport.commands.includes(
        `mountain-release activate ${previousCommit}`,
      ),
      false,
    );
    assert.equal(transport.commands.includes("mountain-release health"), true);
  });
});

test("activating a revoked release fails without becoming an implicit rollback", async () => {
  await withArtifact(async (directory) => {
    const transport = createMemoryTransport({
      commands: {
        [`mountain-release activate ${testCommit}`]: new RemoteCommandError(
          `Release ${testCommit} is not eligible (revoked).`,
          { status: 1, stdout: "", stderr: "revoked" },
        ),
      },
    });
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: async () => testCommit,
          transport,
          smoke: async () => {},
        }),
      /not eligible \(revoked\)/,
    );
    assert.equal(
      transport.commands.includes("mountain-release rollback"),
      false,
    );
  });
});

test("rollback rejects a revoked target and rolls back an eligible one", async () => {
  const revoked = createMemoryTransport({
    commands: {
      [`mountain-release rollback ${testCommit}`]: new RemoteCommandError(
        `Release ${testCommit} is not eligible (revoked).`,
        { status: 1, stdout: "", stderr: "revoked" },
      ),
    },
  });
  await assert.rejects(
    () =>
      rollbackRelease({
        commit: testCommit,
        transport: revoked,
        smoke: async () => {},
      }),
    /not eligible \(revoked\)/,
  );

  const eligible = createMemoryTransport();
  const message = await rollbackRelease({
    transport: eligible,
    smoke: async () => {},
  });
  assert.match(message, /Rolled back/);
  assert.equal(eligible.commands[0], "mountain-release list");
  assert.equal(eligible.commands[1], "mountain-release rollback");
  assert.equal(eligible.commands[2], "mountain-release health");
});

test("a head change after activation restores the displaced commit", async () => {
  await withArtifact(async (directory) => {
    const transport = createMemoryTransport();
    await assert.rejects(
      () =>
        deployRelease({
          artifactDirectory: directory,
          candidateCommit: testCommit,
          resolveHead: headSequence([testCommit, testCommit, newerCommit]),
          transport,
          smoke: async () => {},
        }),
      /stale commit/,
    );
    assert.equal(
      transport.commands.at(-1),
      `mountain-release activate ${previousCommit}`,
    );
  });
});

test("rollback smoke failure restores the displaced commit", async () => {
  const transport = createMemoryTransport({
    commands: {
      "mountain-release list": `active   ${testCommit} build 2026-08-18 installed 2026-08-18T00:00:00.000Z`,
    },
  });
  await assert.rejects(
    () =>
      rollbackRelease({
        transport,
        smoke: async () => {
          throw new Error("rollback smoke failed");
        },
      }),
    /Rollback verification failed; restored/,
  );
  assert.equal(
    transport.commands.at(-1),
    `mountain-release activate ${testCommit}`,
  );
});

test("resolveProtectedHead uses the GitHub API and never puts the token in the URL", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, headers: options.headers });
    return {
      ok: true,
      json: async () => ({ sha: newerCommit }),
    };
  };
  const sha = await resolveProtectedHead({
    repository: "rboixaderg/mountain-runners",
    apiUrl: "https://api.github.com",
    token: "ghs_test-token",
    fetchImpl,
  });
  assert.equal(sha, newerCommit);
  assert.equal(seen[0].url.includes("ghs_test-token"), false);
  assert.equal(seen[0].headers.Authorization, "Bearer ghs_test-token");

  const resolver = createGithubHeadResolver({
    GITHUB_REPOSITORY: "rboixaderg/mountain-runners",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_TOKEN: "ghs_test-token",
  });
  assert.equal(typeof resolver, "function");
});

test("parseReceiveMessage requires the reported digest", () => {
  const parsed = parseReceiveMessage(
    "Received manifest.json sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bytes:12\n",
    "manifest.json",
  );
  assert.equal(parsed.bytes, 12);
  assert.throws(
    () => parseReceiveMessage("ok", "manifest.json"),
    /did not return a digest/,
  );
});

test("receive reports ssh stderr when the remote closes during upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mountain-ssh-epipe-"));
  const fakeSsh = join(directory, "ssh");
  try {
    await writeFile(
      fakeSsh,
      `#!/bin/sh\nprintf '%s\\n' "Host key verification failed." >&2\nexit 255\n`,
      { mode: 0o755 },
    );
    const transport = createSshTransport({
      host: "203.0.113.10",
      privateKey: "test-key\n",
      knownHosts: "203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest\n",
      sshCommand: fakeSsh,
    });
    await assert.rejects(
      () => transport.receive("manifest.json", Buffer.alloc(64 * 1024, 1)),
      (error) => {
        assert.equal(error instanceof RemoteCommandError, true);
        assert.match(error.message, /Host key verification failed/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the production workflows pin actions, restrict main and keep secrets off the build jobs", async () => {
  const artifactWorkflow = await readFile(
    join(repositoryRoot, ".github/workflows/artifact.yml"),
    "utf8",
  );
  const rollbackWorkflow = await readFile(
    join(repositoryRoot, ".github/workflows/rollback.yml"),
    "utf8",
  );
  const [buildJobs, deployJob] = artifactWorkflow.split("\n  deploy:\n");

  assert.match(artifactWorkflow, /permissions:\n {2}contents: read\n/);
  assert.doesNotMatch(buildJobs, /secrets\./);
  assert.doesNotMatch(buildJobs, /environment:/);
  assert.match(deployJob, /environment:\n {6}name: production/);
  assert.match(deployJob, /group: production-release/);
  assert.match(deployJob, /cancel-in-progress: false/);
  assert.match(
    deployJob,
    /github.ref == 'refs\/heads\/main' && github.event.repository.fork == false/,
  );
  assert.match(deployJob, /secrets\.DEPLOY_SSH_PRIVATE_KEY/);
  assert.match(
    deployJob,
    /uses: actions\/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131/,
  );
  assert.match(
    deployJob,
    /SMOKE_EXPECT_NOINDEX: "\$\{\{ vars\.SMOKE_EXPECT_NOINDEX \}\}"/,
  );
  assert.doesNotMatch(artifactWorkflow, /uses: [^\s]+@v\d/);

  assert.match(rollbackWorkflow, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(rollbackWorkflow, /pull_request/);
  assert.doesNotMatch(rollbackWorkflow, /\n {2}push:/);
  assert.match(rollbackWorkflow, /group: production-release/);
  assert.match(rollbackWorkflow, /cancel-in-progress: false/);
  assert.match(rollbackWorkflow, /environment:\n {6}name: production-rollback/);
  assert.doesNotMatch(rollbackWorkflow, /environment:\n {6}name: production\n/);
  assert.match(
    rollbackWorkflow,
    /SMOKE_EXPECT_NOINDEX: "\$\{\{ vars\.SMOKE_EXPECT_NOINDEX \}\}"/,
  );
  assert.match(
    rollbackWorkflow,
    /github.ref == 'refs\/heads\/main' && github.event.repository.fork == false/,
  );
});

test("createSmokeRunner uses --expect-noindex until the apex cut", () => {
  const calls = [];
  const smoke = createSmokeRunner({
    baseUrl: "https://validate.mountainrunners.cat",
    spawnSyncImpl: (...args) => {
      calls.push(args);
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });
  smoke();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].includes("--expect-noindex"), true);
  assert.equal(calls[0][1].includes("--expect-indexable"), false);
});

test("createSmokeRunner uses --expect-indexable after the apex cut", () => {
  const calls = [];
  const smoke = createSmokeRunner({
    baseUrl: "https://mountainrunners.cat",
    expectNoIndex: false,
    spawnSyncImpl: (...args) => {
      calls.push(args);
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });
  smoke();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].includes("--expect-indexable"), true);
  assert.equal(calls[0][1].includes("--expect-noindex"), false);
});

test("smokeExpectsNoIndex is true unless the env value is exactly false", () => {
  assert.equal(smokeExpectsNoIndex(undefined), true);
  assert.equal(smokeExpectsNoIndex(""), true);
  assert.equal(smokeExpectsNoIndex("true"), true);
  assert.equal(smokeExpectsNoIndex("false"), false);
});
