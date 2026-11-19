// Trusted bridge loop.
//
// The bridge owns the Telegram token, the admission queue and the report back
// to the topic. It never gives those credentials to the model, the sandbox or
// the repository scripts. Every instruction is classified, verified against the
// configured group and admitted before the Telegram offset advances.

import {
  classifyAlbum,
  classifyInstruction,
  isAlbumMember,
  verifyMembership,
} from "./attribution.mjs";
import { AlbumCollector } from "./albums.mjs";
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
  attachmentUnsupported:
    "That kind of file cannot be used. Send a JPEG, PNG or WebP image.",
  attachmentInvalidPhoto:
    "That photo cannot be read. Nothing was saved; send it again.",
  attachmentTooLarge: (megabytes) =>
    `The image is ${megabytes} MB; the limit is 20 MB. Nothing was saved; send a smaller copy.`,
  attachmentTooManyImages: (count) =>
    `One message can carry at most 5 images and this one carried ${count}. Nothing was saved; send at most 5.`,
};
export const maximumReportLength = 4000;
export const maximumAcknowledgementExcerptLength = 120;

// A Telegram API that never answers must not hold the single global execution.
// The admission read combines the stop signal of the service with its own
// deadline, like every other bounded request of the project.
export const defaultMembershipTimeoutMilliseconds = 30 * 1000;

// How long an album waits for the images that Telegram has not delivered yet.
export const defaultAlbumWaitMilliseconds = 1000;

// The number of already processed update identifiers kept in memory while the
// offset waits for an unfinished album. A re-read of the same range skips them.
const maximumRememberedUpdates = 500;

// The deferred map is memory only, like `#processed`. An album wait bounds it in
// practice; the cap keeps a pathological burst from growing without limit. When
// it is reached the oldest entry is dropped and the offset stays at its id, so
// the dropped update is re-read instead of lost.
const maximumDeferredUpdates = 500;

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
    if (milliseconds <= 0) {
      resolve();
      return;
    }
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
  #onServiceReport;
  #logger;
  #botIdentifier;
  #pollTimeoutSeconds;
  #backoffMilliseconds;
  #membershipTimeoutMilliseconds;
  #albums;
  #sleep;
  #lastConsumed = null;
  #processed = new Set();
  #deferred = new Map();
  #deferredOverflow = null;

  constructor({
    groupIdentifier,
    botUsername,
    messages = defaultBridgeMessages,
    telegram,
    queue,
    runInstruction,
    onServiceReport = () => {},
    runWhenIdle = async () => false,
    botIdentifier,
    logger = () => {},
    pollTimeoutSeconds = 25,
    backoffMilliseconds = 5000,
    membershipTimeoutMilliseconds = defaultMembershipTimeoutMilliseconds,
    albumWaitMilliseconds = defaultAlbumWaitMilliseconds,
    now = () => Date.now(),
    sleepImpl = sleep,
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
    this.#onServiceReport = onServiceReport;
    this.#runWhenIdle = runWhenIdle;
    this.#botIdentifier = botIdentifier;
    this.#logger = logger;
    this.#pollTimeoutSeconds = pollTimeoutSeconds;
    this.#backoffMilliseconds = backoffMilliseconds;
    this.#membershipTimeoutMilliseconds = membershipTimeoutMilliseconds;
    this.#sleep = sleepImpl;
    this.#albums = new AlbumCollector({
      now,
      waitMilliseconds: albumWaitMilliseconds,
    });
  }

  #classificationContext() {
    return {
      groupIdentifier: this.#groupIdentifier,
      botUsername: this.#botUsername,
      botIdentifier: this.#botIdentifier,
    };
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
  // report names the reason, never the original file name. The text is also
  // reported to the owner of the topic, which keeps it for the next turn of the
  // model: the refusal is an effect of the service.
  async #refuseAttachment(classification, { signal } = {}) {
    // A restart may re-read the same update because the offset waits for an
    // album. The trace is durable, so the refusal is not sent again.
    const alreadyRefused = this.#queue.hasTrace({
      updateIdentifier: classification.updateIdentifier,
      action: "attachment_refused",
    });
    if (alreadyRefused) {
      return;
    }
    this.#queue.recordTrace({
      updateIdentifier: classification.updateIdentifier,
      authorIdentifier: classification.authorIdentifier,
      sessionKey: classification.sessionKey,
      action: "attachment_refused",
      detail: attachmentRefusalDetail(classification),
    });
    const text = this.#attachmentRefusalText(classification);
    try {
      await this.#onServiceReport({
        sessionKey: classification.sessionKey,
        text,
        // One update has one refusal: a redelivered update never records it
        // twice.
        effectKey: `attachment-refusal:${classification.updateIdentifier}`,
      });
    } catch (error) {
      this.#logger(
        "service_report_failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    await this.#reply(classification.sessionKey, text, { signal });
  }

  #attachmentRefusalText(classification) {
    if (classification.reason === attachmentRefusalReasons.invalidPhoto) {
      return this.#messages.attachmentInvalidPhoto;
    }
    if (
      classification.reason === attachmentRefusalReasons.unsupportedDocument
    ) {
      return this.#messages.attachmentUnsupported;
    }
    if (classification.reason === attachmentRefusalReasons.tooManyImages) {
      return this.#messages.attachmentTooManyImages(classification.count);
    }
    return this.#messages.attachmentTooLarge(
      attachmentMegabytes(classification.bytes),
    );
  }

  async #handleClassification(classification, { signal } = {}) {
    if (
      classification.decision !== "instruction" &&
      classification.decision !== "refuse"
    ) {
      return;
    }

    const membership = await verifyMembership({
      telegram: this.#telegram,
      groupIdentifier: this.#groupIdentifier,
      authorIdentifier: classification.authorIdentifier,
      signal: boundedSignal(signal, this.#membershipTimeoutMilliseconds),
    });

    // The service is stopping: the update was not consumed, so it is read
    // again on the next start instead of being recorded as a denial.
    if (signal?.aborted) {
      return;
    }

    if (!membership.verified) {
      // A re-read while the offset waits for an album does not record or send
      // the same denial again. A later successful check still admits it.
      const alreadyDenied = this.#queue.hasTrace({
        updateIdentifier: classification.updateIdentifier,
        action: "instruction_denied",
      });
      if (alreadyDenied) {
        return;
      }
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
      return;
    }

    if (classification.decision === "refuse") {
      await this.#refuseAttachment(classification, { signal });
      return;
    }

    const admission = this.#queue.admit({
      updateIdentifier: classification.updateIdentifier,
      messageIdentifier: classification.messageIdentifier,
      sessionKey: classification.sessionKey,
      authorIdentifier: classification.authorIdentifier,
      instruction: classification.text,
      attachments: classification.attachments,
    });
    this.#traceAdmission(admission, classification);
    if (admission === "accepted") {
      await this.#reply(
        classification.sessionKey,
        this.#messages.acknowledgement(instructionExcerpt(classification.text)),
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
      await this.#reply(classification.sessionKey, this.#messages.queueFull, {
        signal,
      });
    }
  }

  #sessionKeyOf(update) {
    const message = update.message;
    const chatIdentifier = message?.chat?.id;
    const threadIdentifier = message?.message_thread_id;
    if (chatIdentifier === undefined || typeof threadIdentifier !== "number") {
      return null;
    }
    return `${chatIdentifier}:${threadIdentifier}`;
  }

  #defer(update) {
    if (this.#deferred.size >= maximumDeferredUpdates) {
      const oldest = this.#deferred.keys().next().value;
      this.#deferred.delete(oldest);
      this.#deferredOverflow =
        this.#deferredOverflow === null
          ? oldest
          : Math.min(this.#deferredOverflow, oldest);
    }
    this.#deferred.set(update.update_id, update);
  }

  // Updates of a session whose album is still waiting keep their arrival order:
  // they wait here instead of overtaking the album. Other sessions continue. A
  // deferral only waits behind an album whose oldest member arrived before it;
  // a newer album never overtakes it.
  async #flushDeferred(sessionKey, { signal } = {}) {
    const deferred = [...this.#deferred.values()]
      .filter((update) => this.#sessionKeyOf(update) === sessionKey)
      .toSorted((first, second) => first.update_id - second.update_id);
    for (const update of deferred) {
      if (signal?.aborted) {
        return;
      }
      const oldestAlbum =
        this.#albums.oldestUpdateIdentifierForSession(sessionKey);
      if (oldestAlbum !== null && oldestAlbum < update.update_id) {
        return;
      }
      this.#deferred.delete(update.update_id);
      if (this.#processed.has(update.update_id)) {
        continue;
      }
      this.#rememberProcessed(update.update_id);
      const classification = classifyInstruction(
        update,
        this.#classificationContext(),
      );
      await this.#handleClassification(classification, { signal });
      if (signal?.aborted) {
        return;
      }
      this.#lastConsumed = Math.max(this.#lastConsumed ?? 0, update.update_id);
    }
  }

  #oldestDeferredUpdateIdentifier() {
    let oldest = this.#deferredOverflow;
    for (const updateIdentifier of this.#deferred.keys()) {
      if (oldest === null || updateIdentifier < oldest) {
        oldest = updateIdentifier;
      }
    }
    return oldest;
  }

  // Admit the albums whose bounded wait ended. An album becomes one
  // instruction, so its images are classified and verified together, once.
  async #admitExpiredAlbums({ signal } = {}) {
    for (const group of this.#albums.expired()) {
      if (signal?.aborted) {
        return;
      }
      this.#albums.remove(group.identifier);
      const classification = classifyAlbum(
        group.updates,
        this.#classificationContext(),
      );
      await this.#handleClassification(classification, { signal });
      if (signal?.aborted) {
        return;
      }
      this.#lastConsumed = Math.max(
        this.#lastConsumed ?? 0,
        ...group.updates.map((update) => update.update_id),
      );
      if (group.sessionKey !== null) {
        await this.#flushDeferred(group.sessionKey, { signal });
        if (signal?.aborted) {
          return;
        }
      }
    }
    this.#commitOffset();
  }

  // The offset never moves past an album member that is still waiting, so a
  // restart re-reads the whole album. Otherwise it advances past the newest
  // update the bridge already acted on.
  #commitOffset() {
    const held = this.#albums.oldestUpdateIdentifier();
    const deferred = this.#oldestDeferredUpdateIdentifier();
    let candidate = null;
    for (const waiting of [held, deferred]) {
      if (waiting !== null && (candidate === null || waiting < candidate)) {
        candidate = waiting;
      }
    }
    if (candidate === null && this.#lastConsumed !== null) {
      candidate = this.#lastConsumed + 1;
    }
    if (candidate !== null && candidate > this.#queue.readOffset()) {
      this.#queue.writeOffset(candidate);
    }
  }

  #rememberProcessed(updateIdentifier) {
    this.#processed.add(updateIdentifier);
    if (this.#processed.size > maximumRememberedUpdates) {
      const oldest = this.#processed.values().next().value;
      this.#processed.delete(oldest);
    }
  }

  /**
   * Read one Telegram batch, verify and admit each instruction, and advance the
   * durable offset only after the instruction is recorded. Returns how many
   * updates were consumed. A service stop leaves the batch update unconsumed, so
   * the same offset is read again on the next start.
   *
   * The images of an album are collected for a short bounded wait and become one
   * instruction. Unrelated updates of the same batch are still admitted and can
   * execute while that album waits; only the offset stays behind.
   */
  async pollOnce({ signal } = {}) {
    await this.#admitExpiredAlbums({ signal });
    if (signal?.aborted) {
      return 0;
    }

    const offset = this.#queue.readOffset();
    const updates = await this.#telegram.getUpdates({
      offset,
      timeoutSeconds: this.#albums.hasPending() ? 1 : this.#pollTimeoutSeconds,
      signal,
    });

    let consumed = 0;
    for (const update of updates) {
      if (signal?.aborted) {
        return consumed;
      }
      if (this.#processed.has(update.update_id)) {
        continue;
      }
      if (isAlbumMember(update, { groupIdentifier: this.#groupIdentifier })) {
        this.#albums.add(update);
        continue;
      }
      // A later message of an album's session waits behind the album; other
      // sessions are not delayed.
      const sessionKey = this.#sessionKeyOf(update);
      if (sessionKey !== null && this.#albums.hasPendingSession(sessionKey)) {
        this.#defer(update);
        continue;
      }
      this.#deferred.delete(update.update_id);
      if (
        this.#deferredOverflow !== null &&
        update.update_id >= this.#deferredOverflow
      ) {
        this.#deferredOverflow = null;
      }
      this.#rememberProcessed(update.update_id);
      const classification = classifyInstruction(
        update,
        this.#classificationContext(),
      );
      await this.#handleClassification(classification, { signal });
      if (signal?.aborted) {
        return consumed;
      }
      this.#lastConsumed = Math.max(this.#lastConsumed ?? 0, update.update_id);
      consumed += 1;
    }

    if (signal?.aborted) {
      return consumed;
    }
    await this.#admitExpiredAlbums({ signal });
    if (this.#albums.hasPending() && !signal?.aborted) {
      await this.#sleep(
        Math.min(this.#albums.remainingMilliseconds(), 250),
        signal,
      );
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
        await this.#sleep(this.#backoffMilliseconds, signal);
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
