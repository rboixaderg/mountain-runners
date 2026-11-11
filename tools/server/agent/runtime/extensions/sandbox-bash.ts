/** The model's only tool. Filesystem access and execution use rootless Podman. */
import { Type } from "typebox";
import { buildModelCommand, readSandboxSettings } from "./arguments.mjs";
import { runSandboxedCommand } from "./commands.mjs";

export default function (pi: {
  registerTool(definition: unknown): void;
  setActiveTools(names: string[]): void;
  on(event: string, handler: (event: { toolName?: string }) => unknown): void;
}): void {
  // A resumed session must not restore a native host tool from older history.
  pi.on("session_start", () => pi.setActiveTools(["sandbox_bash"]));
  pi.on("tool_call", (event) => {
    if (event.toolName !== "sandbox_bash") {
      return { block: true, reason: "Only sandbox_bash is allowed." };
    }
  });
  pi.registerTool({
    name: "sandbox_bash",
    label: "Sandboxed Bash",
    description:
      "Read, search, edit and run checks in /work inside the isolated container. No network, credentials or host files. Consultations have a read-only worktree. Git metadata is not mounted.",
    parameters: Type.Object({
      command: Type.String({
        description: "Shell command to run inside /work",
      }),
    }),
    async execute(
      _toolCallId: string,
      parameters: { command: string },
      signal: AbortSignal | undefined,
    ) {
      const settings = readSandboxSettings(process.env);
      const result = await runSandboxedCommand({
        image: settings.image,
        workspacePath: process.cwd(),
        worktreeRoot: settings.worktreeRoot,
        command: buildModelCommand(parameters.command, settings.readOnly),
        limits: settings.limits,
        sessionIdentifier: settings.sessionIdentifier,
        timeoutMilliseconds: settings.limits.executionTimeoutMs,
        readOnly: settings.readOnly,
        signal,
      });
      return {
        content: [
          {
            type: "text",
            text: `exit code: ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
          },
        ],
        details: { exitCode: result.exitCode, timedOut: result.timedOut },
      };
    },
  });
}
