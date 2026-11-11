import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateAgentPaths,
  validatePodmanStorage,
  validateVolume,
} from "./volume-validation.mjs";

const expected = {
  mountPath: "/var/lib/mountain-runners-agent",
  backingPath: "/var/lib/mountain-runners-agent-volumes/work.ext4",
  sizeBytes: 11 * 1024 ** 3,
};

function validObservation() {
  return {
    target: expected.mountPath,
    source: "/dev/loop0",
    filesystem: "ext4",
    options: ["rw", "nodev", "nosuid"],
    backingPath: expected.backingPath,
    isRegularFile: true,
    isSymbolicLink: false,
    ownerUid: 0,
    mode: 0o600,
    sizeBytes: expected.sizeBytes,
    allocatedBytes: expected.sizeBytes,
  };
}

test("rejects overridden or symlinked configured paths", () => {
  const paths = { HOME: "/bounded", TMPDIR: "/bounded/tmp" };
  assert.doesNotThrow(() => validateAgentPaths(paths, paths, paths));
  assert.throws(() =>
    validateAgentPaths(paths, { ...paths, TMPDIR: "/tmp" }, paths),
  );
  assert.throws(() =>
    validateAgentPaths(paths, paths, { ...paths, TMPDIR: "/tmp" }),
  );
});

test("requires rootless Podman storage at the verified paths", () => {
  assert.doesNotThrow(() =>
    validatePodmanStorage(
      "/bounded/store",
      "/run/agent/containers",
      "/bounded/store;/run/agent/containers;true",
      "/bounded/store",
    ),
  );
  assert.throws(() =>
    validatePodmanStorage(
      "/bounded/store",
      "/run/agent/containers",
      "/outside;/run/agent/containers;true",
      "/bounded/store",
    ),
  );
  assert.throws(() =>
    validatePodmanStorage(
      "/bounded/store",
      "/run/agent/containers",
      "/bounded/store;/run/agent/containers;false",
      "/bounded/store",
    ),
  );
  assert.throws(() =>
    validatePodmanStorage(
      "/bounded/store",
      "/run/agent/containers",
      "/bounded/store;/run/agent/containers;true",
      "/outside",
    ),
  );
});

test("accepts the expected allocated root-owned loop filesystem", () => {
  assert.doesNotThrow(() => validateVolume(expected, validObservation()));
});

test("rejects the wrong mount, filesystem, backing file or sparse allocation", () => {
  for (const change of [
    { target: "/" },
    { source: "/dev/sda1" },
    { filesystem: "xfs" },
    { options: ["rw", "nodev"] },
    { options: ["rw", "nodev", "nosuid", "discard"] },
    { backingPath: "/tmp/untrusted.ext4" },
    { isSymbolicLink: true },
    { isRegularFile: false },
    { ownerUid: 1000 },
    { mode: 0o666 },
    { sizeBytes: expected.sizeBytes - 1 },
    { allocatedBytes: expected.sizeBytes - 512 },
  ]) {
    assert.throws(() =>
      validateVolume(expected, { ...validObservation(), ...change }),
    );
  }
});
