// A conversation-only service. No repository, GitHub, Docker or model tools.
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdmissionQueue, sessionIdentifier } from "telegram-pi-bridge/sessions";
import { AgentBridge, TelegramApi } from "telegram-pi-bridge/telegram";
import { runPiPrompt } from "telegram-pi-bridge/pi";

function required(environment, name) {
  const value = environment[name];
  if (!value?.trim()) {
    throw new Error(`Missing environment variable ${name}.`);
  }
  return value.trim();
}

export async function main(environment = process.env) {
  const stateDirectory = resolve(
    required(environment, "BRIDGE_STATE_DIRECTORY"),
  );
  const botUsername = required(environment, "TELEGRAM_BOT_USERNAME").replace(
    /^@/u,
    "",
  );
  const groupIdentifier = required(environment, "TELEGRAM_GROUP_ID");
  const model = required(environment, "PI_MODEL");
  const modelEnvironment = { PATH: environment.PATH, HOME: stateDirectory };
  const variableNames = (environment.MODEL_ENVIRONMENT_VARIABLES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of variableNames) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(name) || name.startsWith("TELEGRAM_")) {
      throw new Error(
        "Model environment names must not include Telegram credentials.",
      );
    }
    if (environment[name] !== undefined)
      modelEnvironment[name] = environment[name];
  }
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const queue = new AdmissionQueue(join(stateDirectory, "queue.sqlite"), {
    maxPending: 10,
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (queue.recover() > 0) {
      throw new Error(
        "An interrupted instruction needs operator reconciliation before execution resumes.",
      );
    }
    const telegram = new TelegramApi({
      botToken: required(environment, "TELEGRAM_BOT_TOKEN"),
    });
    const identity = await telegram.getMe({ signal: controller.signal });
    if (identity.username?.toLowerCase() !== botUsername.toLowerCase()) {
      throw new Error("The token does not match the configured bot username.");
    }
    const bridge = new AgentBridge({
      groupIdentifier,
      botUsername,
      botIdentifier: identity.id,
      telegram,
      queue,
      async runInstruction(request, { signal }) {
        const identifier = sessionIdentifier(request.sessionKey);
        const cwd = join(stateDirectory, "workspaces", identifier);
        const profileDirectory = join(stateDirectory, "profiles", identifier);
        const sessionDirectory = join(stateDirectory, "sessions");
        for (const directory of [cwd, profileDirectory, sessionDirectory])
          mkdirSync(directory, { recursive: true, mode: 0o700 });
        const result = await runPiPrompt({
          command: environment.PI_COMMAND || "pi",
          model,
          cwd,
          profileDirectory,
          sessionIdentifier: identifier,
          sessionDirectory,
          environment: modelEnvironment,
          message: `Answer the following conversation message. No tools or external actions are available.\n${request.instruction}`,
          signal,
        });
        if (result.timedOut || result.aborted) {
          return {
            outcome: "uncertain",
            report: "The request did not complete. No retry was started.",
          };
        }
        return {
          outcome: "answered",
          report: result.text || "The request produced no answer.",
        };
      },
    });
    await bridge.run({ signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    queue.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Do not log request bodies, provider responses or credentials.
    process.stderr.write(`${error.name}\n`);
    process.exitCode = 1;
  });
}
