// Deploy and rollback orchestration (phase 5, task 5.4).
//
// Verifies the local artifact, rejects a stale protected-branch head, stages
// the archive through the deploy identity, installs, activates atomically and
// runs smoke tests. A failure before activation leaves the live pointer
// untouched. A failure after activation restores the commit that was active
// before this job, never an unrelated eligible release.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadVerifiedArtifact, productionOrigin } from "./artifact.mjs";
import {
  assertCurrentHead,
  resolveProtectedHead,
} from "./protected-branch.mjs";
import { RemoteCommandError } from "./ssh.mjs";

const verifySitePath = fileURLToPath(
  new URL("../server/verify/verify-site.mjs", import.meta.url),
);

export async function deployRelease({
  artifactDirectory,
  candidateCommit,
  expectedOrigin = productionOrigin,
  resolveHead,
  transport,
  smoke,
}) {
  await rejectIfStale(candidateCommit, resolveHead);

  const artifact = await loadVerifiedArtifact(artifactDirectory, {
    expectedCommit: candidateCommit,
    expectedOrigin,
  });

  await transferAndVerify(
    transport,
    artifact.archiveFileName,
    artifact.archiveBuffer,
    artifact.archiveSha256,
  );
  await transferAndVerify(
    transport,
    "manifest.json",
    artifact.manifestBuffer,
    artifact.manifestSha256,
  );

  await installRelease(transport, artifact.archiveFileName, candidateCommit);
  await rejectIfStale(candidateCommit, resolveHead);

  const displacedCommit = await readActiveCommit(transport);
  const activated = await activateRelease(transport, candidateCommit);
  if (!activated.changedPointer) {
    await verifyLiveRelease(transport, smoke);
    return `Release ${candidateCommit} is already active.`;
  }

  try {
    await rejectIfStale(candidateCommit, resolveHead);
    await verifyLiveRelease(transport, smoke);
    await rejectIfStale(candidateCommit, resolveHead);
  } catch (error) {
    const restoreSummary = await restoreDisplacedRelease(
      transport,
      displacedCommit,
    );
    throw new Error(
      `Activation succeeded but verification failed; ${restoreSummary} ${error.message}`,
      { cause: error },
    );
  }

  return `Deployed release ${candidateCommit}.`;
}

export async function rollbackRelease({ commit, transport, smoke }) {
  const argument = commit === undefined ? "" : ` ${commit}`;
  const displacedCommit = await readActiveCommit(transport);
  let changedPointer = false;
  try {
    const message = await transport.run(`mountain-release rollback${argument}`);
    changedPointer = true;
    await verifyLiveRelease(transport, smoke);
    return message;
  } catch (error) {
    if (error instanceof RemoteCommandError && error.noEligible) {
      throw new Error(
        `${error.message} Apply the emergency response defined in the runbook.`,
        { cause: error },
      );
    }
    if (!changedPointer) {
      throw error;
    }
    const restoreSummary = await restoreDisplacedRelease(
      transport,
      displacedCommit,
    );
    throw new Error(
      `Rollback verification failed; ${restoreSummary} ${error.message}`,
      { cause: error },
    );
  }
}

export function createSmokeRunner({
  baseUrl,
  expectNoIndex = true,
  spawnSyncImpl = spawnSync,
}) {
  if (baseUrl === undefined || !baseUrl.startsWith("https://")) {
    throw new Error("SMOKE_BASE_URL must be an https URL.");
  }
  return () => {
    const args = [verifySitePath, "--base-url", baseUrl];
    if (expectNoIndex) {
      args.push("--expect-noindex");
    }
    const result = spawnSyncImpl(process.execPath, args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        result.stderr?.trim() || result.stdout?.trim() || "Smoke tests failed.",
      );
    }
  };
}

export function createGithubHeadResolver(environment) {
  return () =>
    resolveProtectedHead({
      repository: environment.GITHUB_REPOSITORY,
      apiUrl: environment.GITHUB_API_URL,
      token: environment.GITHUB_TOKEN,
    });
}

async function rejectIfStale(candidateCommit, resolveHead) {
  const protectedHead = await resolveHead();
  assertCurrentHead(candidateCommit, protectedHead);
}

async function transferAndVerify(
  transport,
  fileName,
  contents,
  expectedSha256,
) {
  const received = await transport.receive(fileName, contents);
  if (received.sha256 !== expectedSha256) {
    throw new Error(
      `Digest mismatch after transferring ${fileName}: got ${received.sha256}, expected ${expectedSha256}.`,
    );
  }
}

async function installRelease(transport, archiveFileName, candidateCommit) {
  try {
    return await transport.run(
      `mountain-release install ${archiveFileName} manifest.json`,
    );
  } catch (error) {
    if (
      error instanceof RemoteCommandError &&
      error.message.includes(
        `Release ${candidateCommit} is already registered.`,
      )
    ) {
      return error.message;
    }
    throw error;
  }
}

async function activateRelease(transport, candidateCommit) {
  try {
    const message = await transport.run(
      `mountain-release activate ${candidateCommit}`,
    );
    return { changedPointer: true, message };
  } catch (error) {
    if (
      error instanceof RemoteCommandError &&
      error.message.includes(
        `Release ${candidateCommit} is not eligible (active)`,
      )
    ) {
      return { changedPointer: false, message: error.message };
    }
    throw error;
  }
}

async function verifyLiveRelease(transport, smoke) {
  const health = await transport.run("mountain-release health");
  if (!health.startsWith("Health: OK")) {
    throw new Error(health);
  }
  await smoke();
}

async function readActiveCommit(transport) {
  const listing = await transport.run("mountain-release list");
  const match = /^active\s+([0-9a-f]{40})\b/mu.exec(listing);
  return match?.[1];
}

async function restoreDisplacedRelease(transport, displacedCommit) {
  if (displacedCommit === undefined) {
    return "no previous release to restore; apply the emergency response defined in the runbook.";
  }
  try {
    const message = await transport.run(
      `mountain-release activate ${displacedCommit}`,
    );
    return `restored ${displacedCommit} (${message}).`;
  } catch (error) {
    return `restore of ${displacedCommit} failed: ${error.message}`;
  }
}
