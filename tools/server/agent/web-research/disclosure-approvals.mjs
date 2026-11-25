import { performance } from "node:perf_hooks";

export const disclosureApprovalReply = "Sí, envia-ho";
export const disclosureCancellationReply = "Cancel·la l'enviament";

const lifetimeMilliseconds = 5 * 60 * 1000;
const maximumEntries = 100;
const maximumStringBytes = 16 * 1024;

// Only call offer once a new question showing this exact request has been
// successfully sent to Telegram. Never reoffer an old send result: expired
// tombstones are pruned and a restart loses all state.
// sessionKey and replyMessageIdentifier must come from the bridge's attributed
// direct-reply contract. The caller must admit the instruction and recheck
// membership after take, immediately before dispatching the retained request.
// Payload fields are strings, so neither the offer nor its result can be mutated.
export function createDisclosureApprovals({
  now = () => performance.now(),
} = {}) {
  const entries = new Map();

  function prune(time) {
    for (const [key, entry] of entries) {
      if (time < entry.createdAt || time >= entry.expiresAt)
        entries.delete(key);
    }
  }

  function offer({
    sessionKey,
    authorIdentifier,
    questionMessageIdentifier,
    operation,
    destination,
    input,
    continuation,
  }) {
    const time = now();
    prune(time);
    if (
      typeof sessionKey !== "string" ||
      sessionKey.length === 0 ||
      Buffer.byteLength(sessionKey) > maximumStringBytes ||
      !Number.isSafeInteger(authorIdentifier) ||
      authorIdentifier <= 0 ||
      !Number.isSafeInteger(questionMessageIdentifier) ||
      questionMessageIdentifier <= 0
    ) {
      return false;
    }

    const key = JSON.stringify([
      sessionKey,
      authorIdentifier,
      questionMessageIdentifier,
    ]);
    // Keep consumed and superseded question IDs until expiry: replaying an
    // offer must not restore or change the request attached to that question.
    const previous = entries.get(key);
    if (previous) {
      previous.request = null;
      return false;
    }

    for (const entry of entries.values()) {
      if (
        entry.sessionKey === sessionKey &&
        entry.authorIdentifier === authorIdentifier
      ) {
        entry.request = null;
      }
    }

    if (
      entries.size >= maximumEntries ||
      [
        operation,
        destination,
        input,
        ...(continuation === undefined ? [] : [continuation]),
      ].some(
        (value) =>
          typeof value !== "string" ||
          Buffer.byteLength(value) > maximumStringBytes,
      )
    ) {
      return false;
    }

    entries.set(key, {
      sessionKey,
      authorIdentifier,
      createdAt: time,
      expiresAt: time + lifetimeMilliseconds,
      request: Object.freeze({
        operation,
        destination,
        input,
        ...(continuation === undefined ? {} : { continuation }),
      }),
    });
    return true;
  }

  /** Consume the retained request; the caller decides what the reply means. */
  function take({ sessionKey, authorIdentifier, replyMessageIdentifier }) {
    prune(now());
    if (
      typeof sessionKey !== "string" ||
      !Number.isSafeInteger(authorIdentifier) ||
      !Number.isSafeInteger(replyMessageIdentifier)
    ) {
      return null;
    }
    const key = JSON.stringify([
      sessionKey,
      authorIdentifier,
      replyMessageIdentifier,
    ]);
    const entry = entries.get(key);
    if (!entry || entry.request === null) return null;
    const request = entry.request;
    entry.request = null;
    return request;
  }

  return { offer, take };
}
