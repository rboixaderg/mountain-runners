import { parseSessionKey } from "telegram-pi-bridge/sessions";
import {
  createDisclosureApprovals,
  disclosureApprovalReply,
  disclosureCancellationReply,
} from "./disclosure-approvals.mjs";

// The caller supplies an already admitted, secret-free canonical request and
// its verified author. Handle receives the admitted instruction, including the
// bridge's exact-direct-reply marker; it never receives a raw Telegram update.
export function createTelegramDisclosure({
  telegram,
  attribution,
  checkMembership,
  dispatch,
  approvals = createDisclosureApprovals(),
}) {
  const pendingSends = new Set();

  async function offer({
    sessionKey,
    authorIdentifier,
    request,
    continuation,
    signal,
  }) {
    const { operation, destination, input } = request;
    if (
      [operation, destination, input].some(
        (value) =>
          typeof value !== "string" ||
          value.length > 4096 ||
          !value.isWellFormed(),
      ) ||
      !Number.isSafeInteger(authorIdentifier) ||
      authorIdentifier <= 0
    ) {
      return false;
    }
    const { chatIdentifier, threadIdentifier } = parseSessionKey(sessionKey);
    if (
      String(chatIdentifier) !== attribution.groupIdentifier ||
      threadIdentifier <= 0
    ) {
      return false;
    }
    const retained = { operation, destination, input };
    const text = [
      "Abans d'enviar dades, confirma aquesta petició (valors en JSON):",
      JSON.stringify(retained, null, 2).replace(
        /[\p{Cf}\p{Zl}\p{Zp}]/gu,
        (character) =>
          character
            .split("")
            .map(
              (unit) =>
                `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
            )
            .join(""),
      ),
      `Respon directament «${disclosureApprovalReply}» per enviar-la o «${disclosureCancellationReply}» per cancel·lar-la.`,
    ].join("\n");
    // Telegram messages are limited to 4096 characters. Never truncate the
    // request: the person must see exactly what will be dispatched.
    const key = JSON.stringify([sessionKey, authorIdentifier]);
    if (
      text.length > 4096 ||
      pendingSends.has(key) ||
      pendingSends.size >= 100
    ) {
      return false;
    }
    pendingSends.add(key);
    try {
      const message = await telegram.sendMessage({
        chatIdentifier,
        messageThreadIdentifier: threadIdentifier,
        text,
        disableLinkPreview: true,
        signal,
      });
      if (signal?.aborted) return false;
      return approvals.offer({
        sessionKey,
        authorIdentifier,
        questionMessageIdentifier: message?.message_id,
        ...retained,
        continuation,
      });
    } finally {
      pendingSends.delete(key);
    }
  }

  async function handle({ request, signal }) {
    if (
      request.instruction !== disclosureApprovalReply &&
      request.instruction !== disclosureCancellationReply
    ) {
      return null;
    }
    if (request.exactDirectReply !== true || !request.replyMessageIdentifier) {
      return { status: "refused" };
    }
    // Both replies take the offer, so a valid cancellation can be distinguished
    // from an absent, expired or already consumed one. Cancellation consumes the
    // retained request but never dispatches it.
    const retained = approvals.take({
      sessionKey: request.sessionKey,
      authorIdentifier: request.authorIdentifier,
      replyMessageIdentifier: request.replyMessageIdentifier,
    });
    if (retained === null || signal?.aborted) return { status: "refused" };
    if (request.instruction === disclosureCancellationReply) {
      return { status: "cancelled" };
    }
    let membership;
    try {
      membership = await checkMembership({
        groupIdentifier: attribution.groupIdentifier,
        authorIdentifier: request.authorIdentifier,
        signal,
      });
    } catch {
      return { status: "refused" };
    }
    if (membership?.verified !== true || signal?.aborted) {
      return { status: "refused" };
    }
    const { continuation, ...operation } = retained;
    const result = await dispatch(operation, {
      sessionKey: request.sessionKey,
      authorIdentifier: request.authorIdentifier,
      signal,
      ...(continuation === undefined
        ? {}
        : { continuation, updateIdentifier: request.updateIdentifier }),
    });
    return { status: "handled", result };
  }

  return { offer, handle };
}
