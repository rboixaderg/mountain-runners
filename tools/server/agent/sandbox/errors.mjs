// A failed cleanup is not a normal local failure: untrusted code may still run.
export class SandboxCleanupError extends Error {
  constructor(options) {
    super("Could not confirm that the sandbox containers stopped.", options);
    this.name = "SandboxCleanupError";
  }
}
