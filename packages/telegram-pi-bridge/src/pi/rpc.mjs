// One Pi RPC turn. Transport only: no repository, sandbox or application policy.
// The caller provides a dedicated profile and an explicit child environment.
// Tools and automatic resource loading are disabled unless explicitly selected.

import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

const maximumOutputBytes = 1024 * 1024;

export class PiRunError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

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
    .filter(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

// A settled Pi may keep its RPC process alive. The next turn of the same session
// must not overlap it on the session file, so stdin is closed and the process is
// required to exit within a short bounded wait.
async function waitForChildExit(child, milliseconds = 2000) {
  if (child.exitCode != null || child.signalCode != null) {
    return;
  }
  await new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off("close", onClose);
      child.kill("SIGKILL");
      resolve();
    }, milliseconds);
    child.once("close", onClose);
  });
}

/**
 * Return completed assistant text after agent_settled.
 * `onPromptSent` runs once, immediately before the prompt is written: when it
 * is not called, no prompt reached Pi.
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
  onPromptSent,
  onInterrupted,
  spawnImpl = spawn,
  message,
  images = [],
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
  // The provider error of a turn that ended without an answer, such as a rate
  // limit. The transport reports it; only the caller decides what it means.
  let errorMessage = null;
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
      // A timed-out run never becomes a settled one, even when a last line was
      // already in flight: its result is unknown and cleanup must still run.
      if (finished || outputLimitExceeded || aborted || timedOut) return false;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maximumOutputBytes) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return false;
      }
      return true;
    };

    const handleLine = (rawLine) => {
      const line = rawLine.replace(/\r$/u, "");
      if (line.trim() === "") {
        return;
      }
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        return;
      }
      if (record === null || typeof record !== "object") {
        return;
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
          finish(() => resolvePromise({ text, handled: true, aborted: false }));
        }
      } else if (record.type === "message_end") {
        const answer = assistantText(record.message);
        if (answer !== "") {
          if (text !== "") text += "\n\n";
          text += answer;
          // An answer that arrived after a failed attempt is the turn's result.
          errorMessage = null;
        } else if (
          record.message?.role === "assistant" &&
          typeof record.message.errorMessage === "string"
        ) {
          errorMessage = record.message.errorMessage;
        }
      } else if (record.type === "agent_settled") {
        settled = true;
        finish(() =>
          resolvePromise({ text, aborted: record.aborted === true }),
        );
      }
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
        const line = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 1);
        handleLine(line);
      }
    });
    // The last record may arrive without a trailing newline; the end of the
    // stream is still a complete line boundary.
    child.stdout.on("end", () => {
      if (finished || aborted || timedOut || outputLimitExceeded) return;
      const trailing = buffer;
      buffer = "";
      handleLine(trailing);
    });

    // The child emits `spawn` once the process exists. The prompt is written
    // only then, and only while the turn is still wanted.
    child.on("spawn", () => sendPrompt());
    child.on("error", (error) => finish(() => rejectPromise(error)));
    child.on("close", (exitCode, closeSignal) => {
      if (settled) {
        return;
      }
      finish(() => {
        if (outputLimitExceeded) {
          rejectPromise(
            new PiRunError("The Pi run exceeded the output limit.", {
              reason: "output_limit",
            }),
          );
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
          new PiRunError(`Pi exited with code ${exitCode} before settling.`, {
            reason: "premature_exit",
            exitCode,
            signal: closeSignal,
          }),
        );
      });
    });

    child.stdin.on("error", (error) => finish(() => rejectPromise(error)));
    function sendPrompt() {
      // A process that is already gone, or a turn that is no longer wanted,
      // cannot receive the prompt: the close or abort handler reports why it
      // ended. The caller hears about the prompt only here.
      if (finished || aborted || timedOut) return;
      try {
        onPromptSent?.();
        const prompt = { id: "prompt-1", type: "prompt", message };
        // Images are already cleaned and bounded by the caller; the transport
        // only forwards them in the format the RPC accepts.
        if (images.length > 0) {
          prompt.images = images;
        }
        child.stdin.write(`${JSON.stringify(prompt)}\n`);
      } catch (error) {
        finish(() => rejectPromise(error));
      }
    }
  });

  try {
    const result = await settle;
    return { ...result, timedOut, errorMessage, stderr: stderr.join("") };
  } finally {
    if (!settled) child.kill("SIGKILL");
    child.stdin.end();
    if (settled) {
      await waitForChildExit(child);
    }
    if (!settled || signal?.aborted) {
      await onInterrupted?.();
    }
  }
}
