// Trusted bridge loop.
//
// The bridge owns the Telegram token, the admission queue and the report back
// to the topic. It never gives those credentials to the model, the sandbox or
// the repository scripts. Every instruction is classified, verified against the
// configured group and admitted before the Telegram offset advances.

import { classifyInstruction, verifyMembership } from "./attribution.mjs";
import {
  attachmentMegabytes,
  attachmentRefusalDetail,
  attachmentRefusalReasons,
} from "./attachments.mjs";
import { parseSessionKey } from "../sessions/identity.mjs";

export const defaultBridgeMessages = {
  acknowledgement: (excerpt) =>
    `Instruction received. Working on "${excerpt}". The result will arrive in this topic.`,
  queueFull:
    "The queue is full. This instruction was not accepted; try again after the current work finishes.",
  queueBlocked:
    "Execution is blocked by an uncertain result. This instruction was not accepted; an operator must reconcile the state before you retry.",
  membershipUnavailable:
    "Group membership could not be verified. This instruction was not accepted; please retry.",
  unknownResult:
    "The result is unknown. Execution is blocked until an operator checks the actual state.",
  attachmentPhoto:
    "A compressed photo cannot be accepted. Send the image again as a file, with the instruction as its caption or as a reply to this message.",
  attachmentUnsupported:
    "Only JPEG, PNG and WebP images sent as a file are accepted. This attachment was not accepted.",
  attachmentTooLarge: (megabytes) =>
    `The image is ${megabytes} MB; the limit is 2 MB and 2400 px on the long side. Export it again within those limits and send it as a file. This instruction was not accepted.`,
};
export const maximumReportLength = 4000;
export const maximumAcknowledgementExcerptLength = 120;

// A Telegram API that never answers must not hold the single global execution.
// The admission read combines the stop signal of the service with its own
// deadline, like every other bounded request of the project.
export const defaultMembershipTimeoutMilliseconds = 30 * 1000;

function boundedSignal(signal, milliseconds) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** One public, single-line excerpt of the instruction for the acknowledgement. */
export function instructionExcerpt(
  instruction,
  maximumLength = maximumAcknowledgementExcerptLength,
) {
  const text = instruction.replace(/\s+/gu, " ").trim();
  if (text.length <= maximumLength) {
    return text;
  }
  return `${text.slice(0, maximumLength - 1).trimEnd()}…`;
}

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
  #runWhenIdle;
  #logger;
  #botIdentifier;
  #pollTimeoutSeconds;
  #backoffMilliseconds;
  #membershipTimeoutMilliseconds;

  constructor({
    groupIdentifier,
    botUsername,
    messages = defaultBridgeMessages,
    telegram,
    queue,
    runInstruction,
    runWhenIdle = async () => false,
    botIdentifier,
    logger = () => {},
    pollTimeoutSeconds = 25,
    backoffMilliseconds = 5000,
    membershipTimeoutMilliseconds = defaultMembershipTimeoutMilliseconds,
  }) {
    if (!Number.isSafeInteger(botIdentifier)) {
      throw new Error("The bot identifier is required.");
    }
    this.#groupIdentifier = groupIdentifier;
    this.#botUsername = botUsername;
    this.#messages = { ...defaultBridgeMessages, ...messages };
    this.#telegram = telegram;
    this.#queue = queue;
    this.#runInstruction = runInstruction;
    this.#runWhenIdle = runWhenIdle;
    this.#botIdentifier = botIdentifier;
    this.#logger = logger;
    this.#pollTimeoutSeconds = pollTimeoutSeconds;
    this.#backoffMilliseconds = backoffMilliseconds;
    this.#membershipTimeoutMilliseconds = membershipTimeoutMilliseconds;
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

  // A refused attachment is answered when it arrives: it is never queued. The
  // report names the reason, never the original file name.
  async #refuseAttachment(classification, { signal } = {}) {
    this.#queue.recordTrace({
      updateIdentifier: classification.updateIdentifier,
      authorIdentifier: classification.authorIdentifier,
      sessionKey: classification.sessionKey,
      action: "attachment_refused",
      detail: attachmentRefusalDetail(classification),
    });
    await this.#reply(
      classification.sessionKey,
      this.#attachmentRefusalText(classification),
      { signal },
    );
  }

  #attachmentRefusalText(classification) {
    if (classification.reason === attachmentRefusalReasons.photo) {
      return this.#messages.attachmentPhoto;
    }
    if (
      classification.reason === attachmentRefusalReasons.unsupportedDocument
    ) {
      return this.#messages.attachmentUnsupported;
    }
    return this.#messages.attachmentTooLarge(
      attachmentMegabytes(classification.bytes),
    );
  }

  /**
   * Read one Telegram batch, verify and admit each instruction, and advance the
   * durable offset only after the instruction is recorded. Returns how many
   * updates were consumed. A service stop leaves the batch update unconsumed, so
   * the same offset is read again on the next start.
   */
  async pollOnce({ signal } = {}) {
    const offset = this.#queue.readOffset();
    const updates = await this.#telegram.getUpdates({
      offset,
      timeoutSeconds: this.#pollTimeoutSeconds,
      signal,
    });

    let consumed = 0;
    for (const update of updates) {
      if (signal?.aborted) {
        return consumed;
      }
      const nextOffset = update.update_id + 1;
      const classification = classifyInstruction(update, {
        groupIdentifier: this.#groupIdentifier,
        botUsername: this.#botUsername,
        botIdentifier: this.#botIdentifier,
      });

      if (
        classification.decision === "instruction" ||
        classification.decision === "refuse"
      ) {
        const membership = await verifyMembership({
          telegram: this.#telegram,
          groupIdentifier: this.#groupIdentifier,
          authorIdentifier: classification.authorIdentifier,
          signal: boundedSignal(signal, this.#membershipTimeoutMilliseconds),
        });

        // The service is stopping: the update was not consumed, so it is read
        // again on the next start instead of being recorded as a denial.
        if (signal?.aborted) {
          return consumed;
        }

        if (!membership.verified) {
          this.#queue.recordTrace({
            updateIdentifier: classification.updateIdentifier,
            authorIdentifier: classification.authorIdentifier,
            sessionKey: classification.sessionKey,
            action: "instruction_denied",
            detail: membership.reason,
          });
          if (membership.reason === "membership_check_failed") {
            await this.#reply(
              classification.sessionKey,
              this.#messages.membershipUnavailable,
              { signal },
            );
          }
        } else if (classification.decision === "refuse") {
          await this.#refuseAttachment(classification, { signal });
        } else {
          const admission = this.#queue.admit({
            updateIdentifier: classification.updateIdentifier,
            messageIdentifier: classification.messageIdentifier,
            sessionKey: classification.sessionKey,
            authorIdentifier: classification.authorIdentifier,
            instruction: classification.text,
            attachment: classification.attachment,
          });
          this.#traceAdmission(admission, classification);
          if (admission === "accepted") {
            await this.#reply(
              classification.sessionKey,
              this.#messages.acknowledgement(
                instructionExcerpt(classification.text),
              ),
              { signal },
            );
          }
          if (admission === "rejected_blocked") {
            await this.#reply(
              classification.sessionKey,
              this.#messages.queueBlocked,
              { signal },
            );
          }
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
      consumed += 1;
    }

    return consumed;
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

  /**
   * Run one unit of the service's own durable background work. It is called only
   * when no admitted instruction is running, so the single global execution is
   * preserved, and it must return whether it did something. A defect is logged
   * and never stops the bridge.
   */
  async #runIdleWork({ signal } = {}) {
    try {
      return (await this.#runWhenIdle({ signal })) === true;
    } catch (error) {
      this.#logger(
        "idle_work_failed",
        error instanceof Error ? error.name : "unknown",
      );
      return false;
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
      while (!signal?.aborted) {
        await this.#drain({ signal });
        if (!(await this.#runIdleWork({ signal }))) {
          break;
        }
      }
    }
  }
}
