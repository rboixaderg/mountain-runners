// Validate observations from the host before using a bounded agent volume.
export function validateVolume(expected, observed) {
  if (
    observed.target !== expected.mountPath ||
    !/^\/dev\/loop[0-9]+$/u.test(observed.source) ||
    observed.filesystem !== "ext4" ||
    !["rw", "nodev", "nosuid"].every((option) =>
      observed.options.includes(option),
    ) ||
    observed.options.includes("discard") ||
    observed.backingPath !== expected.backingPath ||
    !observed.isRegularFile ||
    observed.isSymbolicLink ||
    observed.ownerUid !== 0 ||
    observed.mode !== 0o600 ||
    observed.sizeBytes !== expected.sizeBytes ||
    observed.allocatedBytes < expected.sizeBytes
  ) {
    throw new Error(`Invalid bounded agent volume: ${expected.mountPath}`);
  }
}

export function validateAgentPaths(expected, environment, canonicalPaths) {
  for (const [name, path] of Object.entries(expected)) {
    if (environment[name] !== path || canonicalPaths[name] !== path) {
      throw new Error(`Invalid agent storage path: ${name}`);
    }
  }
}

export function validatePodmanStorage(
  expectedGraphRoot,
  expectedRunRoot,
  info,
  canonicalGraphRoot,
) {
  if (
    info !== `${expectedGraphRoot};${expectedRunRoot};true` ||
    canonicalGraphRoot !== expectedGraphRoot
  ) {
    throw new Error("Invalid rootless Podman storage");
  }
}
