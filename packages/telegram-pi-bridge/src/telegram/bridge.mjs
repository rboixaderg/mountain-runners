// Trusted bridge loop.
//
// The bridge owns the Telegram token, the admission queue and the report back
// to the topic. It never gives those credentials to the model, the sandbox or
// the repository scripts. Every instruction is classified, verified against the
// configured group and admitted before the Telegram offset advances.

import { classifyInstruction, verifyMembership } from "./attribution.mjs";
import { parseSessionKey } from "../sessions/identity.mjs";

export const defaultBridgeMessages = {
  queueFull:
    "The queue is full. This instruction was not accepted; try again after the current work finishes.",
  unknownResult:
    "The result is unknown. Execution is blocked until an operator checks the actual state.",
};
export const maximumReportLength = 4000;

function limitReport(report) {
  const text = report.trim();
  if (text.length <= maximumReportLength) {
    return text;
  }
  return `${text.slice(0, maximumReportLength - 1)}…`;
}

function sleep(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export class AgentBridge {
  #groupIdentifier;
  #botUsername;
  #messages;
  #telegram;
  #queue;
  #runInstruction;
  #logger;
  #botIdentifier;
  #pollTimeoutSeconds;
  #backoffMilliseconds;

  constructor({
    groupIdentifier,
    botUsername,
    messages = defaultBridgeMessages,
    telegram,
    queue,
    runInstruction,
    botIdentifier,
    logger = () => {},
    pollTimeoutSeconds = 25,
    backoffMilliseconds = 5000,
  }) {
    if (!Number.isSafeInteger(botIdentifier)) {
      throw new Error("The bot identifier is required.");
    }
    this.#groupIdentifier = groupIdentifier;
    this.#botUsername = botUsername;
    this.#messages = messages;
    this.#telegram = telegram;
    this.#queue = queue;
    this.#runInstruction = runInstruction;
    this.#botIdentifier = botIdentifier;
    this.#logger = logger;
    this.#pollTimeoutSeconds = pollTimeoutSeconds;
    this.#backoffMilliseconds = backoffMilliseconds;
  }

  async #reply(sessionKey, text, { signal } = {}) {
    const { chatIdentifier, threadIdentifier } = parseSessionKey(sessionKey);
    try {
      await this.#telegram.sendMessage({
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text: limitReport(text),
        signal,
      });
    } catch (error) {
      this.#logger(
        "reply_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }

  #traceAdmission(admission, classification) {
    const action =
      admission === "accepted"
        ? "instruction_accepted"
        : `instruction_${admission}`;
    this.#queue.recordTrace({
      updateIdentifier: classification.updateIdentifier,
      authorIdentifier: classification.authorIdentifier,
      sessionKey: classification.sessionKey,
      action,
    });
  }

  /**
   * Read one Telegram batch, verify and admit each instruction, and advance the
   * durable offset only after the instruction is recorded. Returns how many
   * updates were consumed.
   */
  async pollOnce({ signal } = {}) {
    const offset = this.#queue.readOffset();
    const updates = await this.#telegram.getUpdates({
      offset,
      timeoutSeconds: this.#pollTimeoutSeconds,
      signal,
    });

    for (const update of updates) {
      const nextOffset = update.update_id + 1;
      const classification = classifyInstruction(update, {
        groupIdentifier: this.#groupIdentifier,
        botUsername: this.#botUsername,
        botIdentifier: this.#botIdentifier,
      });

      if (classification.decision === "instruction") {
        const membership = await verifyMembership({
          telegram: this.#telegram,
          groupIdentifier: this.#groupIdentifier,
          authorIdentifier: classification.authorIdentifier,
        });

        if (!membership.verified) {
          this.#queue.recordTrace({
            updateIdentifier: classification.updateIdentifier,
            authorIdentifier: classification.authorIdentifier,
            sessionKey: classification.sessionKey,
            action: "instruction_denied",
            detail: membership.reason,
          });
        } else {
          const admission = this.#queue.admit({
            updateIdentifier: classification.updateIdentifier,
            messageIdentifier: classification.messageIdentifier,
            sessionKey: classification.sessionKey,
            authorIdentifier: classification.authorIdentifier,
            instruction: classification.text,
          });
          this.#traceAdmission(admission, classification);
          if (admission === "rejected_full") {
            await this.#reply(
              classification.sessionKey,
              this.#messages.queueFull,
              {
                signal,
              },
            );
          }
        }
      }

      this.#queue.writeOffset(nextOffset);
    }

    return updates.length;
  }

  /**
   * Execute the next admitted instruction. Returns the executed request, or
   * null when the queue is empty or blocked by an uncertain run.
   */
  async executeNext({ signal } = {}) {
    const request = this.#queue.next();
    if (!request) {
      return null;
    }

    let result;
    try {
      result = await this.#runInstruction(request, { signal });
    } catch (error) {
      this.#queue.markUncertain(request.updateIdentifier, "execution_failed");
      this.#queue.recordTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: "instruction_failed",
        detail: error instanceof Error ? error.name : "unknown",
      });
      await this.#reply(request.sessionKey, this.#messages.unknownResult, {
        signal,
      });
      return request;
    }

    if (result.outcome === "uncertain") {
      this.#queue.markUncertain(request.updateIdentifier, result.outcome);
      await this.#reply(
        request.sessionKey,
        result.report || this.#messages.unknownResult,
        {
          signal,
        },
      );
      return request;
    }

    this.#queue.complete(request.updateIdentifier, result.outcome);
    this.#queue.recordTrace({
      updateIdentifier: request.updateIdentifier,
      authorIdentifier: request.authorIdentifier,
      sessionKey: request.sessionKey,
      action: "instruction_completed",
      detail: result.outcome,
    });
    if (result.report) {
      await this.#reply(request.sessionKey, result.report, { signal });
    }
    return request;
  }

  async #drain({ signal } = {}) {
    while (!signal?.aborted) {
      const executed = await this.executeNext({ signal });
      if (executed === null) {
        return;
      }
    }
  }

  /** Long-polling service loop. It returns only when the signal is aborted. */
  async run({ signal } = {}) {
    while (!signal?.aborted) {
      try {
        await this.pollOnce({ signal });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        this.#logger(
          "poll_failed",
          error instanceof Error ? error.name : "unknown",
        );
        await sleep(this.#backoffMilliseconds, signal);
      }
      await this.#drain({ signal });
    }
  }
}
