// One Pi RPC turn. Transport only: no repository, sandbox or application policy.
// The caller provides a dedicated profile and an explicit child environment.
// Tools and automatic resource loading are disabled unless explicitly selected.

import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

const maximumOutputBytes = 1024 * 1024;

export function buildPiArguments({
  model,
  sessionIdentifier,
  sessionDirectory,
  tools = [],
  extensions = [],
}) {
  const argumentsList = [
    "--mode",
    "rpc",
    "--model",
    model,
    "--no-approve",
    "--no-context-files",
    "--no-skills",
    "--no-extensions",
    "--no-mcp",
    "--no-prompt-templates",
  ];
  if (sessionIdentifier) {
    if (!sessionDirectory) {
      throw new Error(
        "Persistent Pi sessions require an explicit sessionDirectory.",
      );
    }
    argumentsList.push(
      "--session-id",
      sessionIdentifier,
      "--session-dir",
      sessionDirectory,
    );
  } else {
    argumentsList.push("--no-session");
  }
  for (const tool of tools) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(tool)) {
      throw new Error(
        "Tools must be explicit names, not patterns or default-tool modifiers.",
      );
    }
  }
  if (tools.length === 0) {
    argumentsList.push("--no-tools");
  } else {
    argumentsList.push("--tools", tools.join(","));
  }
  for (const extension of extensions) {
    if (!isAbsolute(extension)) {
      throw new Error("Trusted extension paths must be absolute.");
    }
    argumentsList.push("--extension", extension);
  }
  return argumentsList;
}

function assistantText(message) {
  if (
    !message ||
    message.role !== "assistant" ||
    !Array.isArray(message.content)
  ) {
    return "";
  }
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Return completed assistant text after agent_settled.
 * onInterrupted lets the caller stop its own external execution resources;
 * killing Pi alone cannot stop containers, remote jobs or other descendants.
 */
export async function runPiPrompt({
  command = "pi",
  model,
  cwd,
  profileDirectory,
  sessionIdentifier,
  sessionDirectory,
  tools = [],
  extensions = [],
  environment = {},
  timeoutMilliseconds = 30 * 60 * 1000,
  signal,
  onInterrupted,
  spawnImpl = spawn,
  message,
}) {
  signal?.throwIfAborted();
  if (!isAbsolute(profileDirectory)) {
    throw new Error("A dedicated absolute Pi profileDirectory is required.");
  }
  const child = spawnImpl(
    command,
    buildPiArguments({
      model,
      sessionIdentifier,
      sessionDirectory,
      tools,
      extensions,
    }),
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        ...environment,
        PI_CODING_AGENT_DIR: profileDirectory,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let text = "";
  let timedOut = false;
  let settled = false;
  let aborted = false;
  let outputLimitExceeded = false;
  let outputBytes = 0;

  const stderr = [];
  let buffer = "";

  const settle = new Promise((resolvePromise, rejectPromise) => {
    const abortHandler = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMilliseconds);

    let finished = false;
    const finish = (callback) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortHandler);
      callback();
    };

    const acceptOutput = (chunk) => {
      if (finished || outputLimitExceeded || aborted) return false;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maximumOutputBytes) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return false;
      }
      return true;
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (acceptOutput(chunk)) stderr.push(chunk);
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (!acceptOutput(chunk)) return;
      buffer += chunk;
      let separator;
      while (!finished && (separator = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, separator).replace(/\r$/u, "");
        buffer = buffer.slice(separator + 1);
        if (line.trim() === "") {
          continue;
        }
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (record.type === "response" && record.command === "prompt") {
          if (record.success === false) {
            finish(() =>
              rejectPromise(
                new Error(
                  `Pi rejected the prompt: ${record.error ?? "unknown error"}`,
                ),
              ),
            );
          } else if (record.data?.disposition === "handled") {
            settled = true;
            finish(() =>
              resolvePromise({ text, handled: true, aborted: false }),
            );
          }
        } else if (record.type === "message_end") {
          const answer = assistantText(record.message);
          if (answer !== "") {
            if (text !== "") text += "\n\n";
            text += answer;
          }
        } else if (record.type === "agent_settled") {
          settled = true;
          finish(() =>
            resolvePromise({ text, aborted: record.aborted === true }),
          );
        }
      }
    });

    child.on("error", (error) => finish(() => rejectPromise(error)));
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      finish(() => {
        if (outputLimitExceeded) {
          rejectPromise(new Error("The Pi run exceeded the output limit."));
          return;
        }
        if (aborted) {
          rejectPromise(new Error("The Pi run was aborted."));
          return;
        }
        if (timedOut) {
          resolvePromise({ text, timedOut: true });
          return;
        }

        rejectPromise(
          new Error(`Pi exited with code ${exitCode} before settling.`),
        );
      });
    });

    child.stdin.on("error", (error) => finish(() => rejectPromise(error)));
    child.stdin.write(
      `${JSON.stringify({ id: "prompt-1", type: "prompt", message })}\n`,
    );
  });

  try {
    const result = await settle;
    return { ...result, timedOut, stderr: stderr.join("") };
  } finally {
    if (!settled) child.kill("SIGKILL");
    child.stdin.end();
    if (!settled || signal?.aborted) {
      await onInterrupted?.();
    }
  }
}
