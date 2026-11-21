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
    "There is too much work queued right now, so this request did not start. Please try again when the current work finishes.",
  queueBlocked:
    "An earlier task stopped halfway and a person must check it before anything else runs. This request did not start; please try again later.",
  membershipUnavailable:
    "Right now the group membership could not be checked, so this request did not start. Please try again in a moment.",
  unknownResult:
    "It is not known whether the last action finished. It is not repeated, and a person who runs the service must check it.",
  attachmentUnsupported:
    "I cannot use that kind of file. Send me a JPEG, PNG or WebP image.",
  attachmentInvalidPhoto:
    "I could not read that photo. I did not save anything; send it again.",
  attachmentTooLarge: (megabytes) =>
    `The image is ${megabytes} MB and the limit is 20 MB. I did not save anything; send a smaller copy.`,
  attachmentTooManyImages: (count) =>
    `One message can carry at most 5 images and this one carried ${count}. I did not save anything; send at most 5.`,
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
    if (milliseconds <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
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
  #deferredOverflow = new Map();

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
    // A re-delivered update is already waiting: it never evicts an older entry.
    if (this.#deferred.has(update.update_id)) {
      return;
    }
    if (this.#deferred.size >= maximumDeferredUpdates) {
      const oldestUpdateIdentifier = this.#deferred.keys().next().value;
      const oldestUpdate = this.#deferred.get(oldestUpdateIdentifier);
      this.#deferred.delete(oldestUpdateIdentifier);
      const sessionKey = this.#sessionKeyOf(oldestUpdate);
      if (sessionKey !== null) {
        const watermark = this.#deferredOverflow.get(sessionKey);
        this.#deferredOverflow.set(sessionKey, {
          min:
            watermark === undefined
              ? oldestUpdateIdentifier
              : Math.min(watermark.min, oldestUpdateIdentifier),
          max:
            watermark === undefined
              ? oldestUpdateIdentifier
              : Math.max(watermark.max, oldestUpdateIdentifier),
        });
      }
    }
    this.#deferred.set(update.update_id, update);
  }

  #oldestDeferredUpdateIdentifierForSession(sessionKey) {
    let oldest = this.#deferredOverflow.get(sessionKey)?.min ?? null;
    for (const update of this.#deferred.values()) {
      if (this.#sessionKeyOf(update) !== sessionKey) {
        continue;
      }
      if (oldest === null || update.update_id < oldest) {
        oldest = update.update_id;
      }
    }
    return oldest;
  }

  // Updates of a session whose album is still waiting keep their arrival order:
  // they wait here instead of overtaking the album. Other sessions continue. A
  // deferral only waits behind an album whose oldest member arrived before it;
  // a newer album never overtakes it.
  async #flushDeferred(sessionKey, { signal } = {}) {
    const watermark = this.#deferredOverflow.get(sessionKey);
    if (watermark !== undefined) {
      // Older updates of this session were evicted. The offset stays at the
      // watermark and Telegram re-reads them in order, so running a newer copy
      // here would let it overtake them. Every dropped copy extends the range
      // the offset must still cover.
      for (const [updateIdentifier, update] of this.#deferred) {
        if (
          this.#sessionKeyOf(update) === sessionKey &&
          updateIdentifier > watermark.min
        ) {
          this.#deferred.delete(updateIdentifier);
          watermark.max = Math.max(watermark.max, updateIdentifier);
        }
      }
      return;
    }
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
    let oldest = null;
    for (const updateIdentifier of this.#deferred.keys()) {
      if (oldest === null || updateIdentifier < oldest) {
        oldest = updateIdentifier;
      }
    }
    for (const watermark of this.#deferredOverflow.values()) {
      if (oldest === null || watermark.min < oldest) {
        oldest = watermark.min;
      }
    }
    return oldest;
  }

  // The offset covers the whole evicted range, page by page: only the update
  // that reaches the last evicted identifier ends the watermark.
  #advanceDeferredOverflow(update) {
    const sessionKey = this.#sessionKeyOf(update);
    if (sessionKey === null) {
      return;
    }
    const watermark = this.#deferredOverflow.get(sessionKey);
    if (watermark === undefined) {
      return;
    }
    if (update.update_id >= watermark.max) {
      this.#deferredOverflow.delete(sessionKey);
      return;
    }
    if (update.update_id >= watermark.min) {
      watermark.min = update.update_id + 1;
    }
  }

  // A group never overtakes an older arrival of its own session: admitting it
  // first would publish a newer album or message before the older one.
  #heldBehindOlderArrival(sessionKey, oldestUpdateIdentifier) {
    if (sessionKey === null) {
      return false;
    }
    const oldestAlbum =
      this.#albums.oldestUpdateIdentifierForSession(sessionKey);
    if (oldestAlbum !== null && oldestAlbum < oldestUpdateIdentifier) {
      return true;
    }
    const oldestDeferred =
      this.#oldestDeferredUpdateIdentifierForSession(sessionKey);
    return oldestDeferred !== null && oldestDeferred < oldestUpdateIdentifier;
  }

  // Admit the albums whose bounded wait ended. An album becomes one
  // instruction, so its images are classified and verified together, once.
  // A held group stays in the collector and is retried by the next poll, which
  // long-polls, so the wait costs no busy loop.
  async #admitExpiredAlbums({ signal } = {}) {
    for (const group of this.#albums.expired()) {
      if (signal?.aborted) {
        return;
      }
      const oldestUpdateIdentifier = group.updates[0].update_id;
      if (
        this.#heldBehindOlderArrival(group.sessionKey, oldestUpdateIdentifier)
      ) {
        continue;
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
      // Telegram re-delivers every member at or above the offset. Remembering
      // all of them keeps an unchanged group from being collected again while
      // another album holds the offset behind it.
      for (const update of group.updates) {
        this.#rememberProcessed(update.update_id);
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
        // The collector holds the offset for this member, so it already counts
        // as consumed for the watermark.
        this.#advanceDeferredOverflow(update);
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
      this.#advanceDeferredOverflow(update);
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

    if (result === null || typeof result !== "object") {
      this.#queue.markUncertain(request.updateIdentifier, "unexpected_result");
      this.#queue.recordTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: "instruction_uncertain",
        detail: "unexpected_result",
      });
      await this.#reply(request.sessionKey, this.#messages.unknownResult, {
        signal,
      });
      return request;
    }

    if (result.outcome === "uncertain") {
      this.#queue.markUncertain(request.updateIdentifier, result.outcome);
      this.#queue.recordTrace({
        updateIdentifier: request.updateIdentifier,
        authorIdentifier: request.authorIdentifier,
        sessionKey: request.sessionKey,
        action: "instruction_uncertain",
        detail: result.outcome,
      });
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
