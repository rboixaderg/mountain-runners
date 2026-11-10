// Attribution rules for the private Telegram group.
//
// Only a message written by a person in the configured forum topic can be an
// instruction. Names, quotes, forwarded content and channel identities never
// prove authorship; a private chat or another group is never accepted.
//
// Membership is checked against Telegram for every new instruction. The check
// is not cached: a failure or an unexpected answer denies the instruction.

export const memberStatuses = new Set(["creator", "administrator", "member"]);

function entityText(message, entity) {
  return message.text.slice(entity.offset, entity.offset + entity.length);
}

function mentionEntities(message, botUsername, botIdentifier) {
  const entities = Array.isArray(message.entities) ? message.entities : [];
  return entities.filter((entity) => {
    if (entity.type === "text_mention") {
      return (
        typeof botIdentifier === "number" && entity.user?.id === botIdentifier
      );
    }
    if (entity.type !== "mention") {
      return false;
    }
    return (
      entityText(message, entity).toLowerCase() ===
      `@${botUsername.toLowerCase()}`
    );
  });
}

function isReplyToBot(message, botIdentifier) {
  const repliedAuthor = message.reply_to_message?.from;
  return (
    typeof botIdentifier === "number" &&
    Boolean(repliedAuthor) &&
    repliedAuthor.id === botIdentifier
  );
}

function instructionText(message, mentions) {
  let text = message.text ?? "";
  for (const entity of mentions.toSorted(
    (first, second) => second.offset - first.offset,
  )) {
    text =
      text.slice(0, entity.offset) + text.slice(entity.offset + entity.length);
  }
  return text.trim();
}

/**
 * Decide whether an update is an instruction for the agent.
 *
 * `botIdentifier` is the Telegram user identifier of the bot (from getMe), used
 * only to recognise replies to its own messages.
 */
export function classifyInstruction(
  update,
  { groupIdentifier, botUsername, botIdentifier },
) {
  const message = update.message;
  if (!message) {
    return { decision: "ignore", reason: "not_a_message" };
  }

  if (String(message.chat?.id) !== groupIdentifier) {
    return { decision: "ignore", reason: "other_chat" };
  }

  if (message.sender_chat || !message.from || message.from.is_bot) {
    return { decision: "ignore", reason: "no_person_author" };
  }

  if (message.forward_origin || message.forward_from_chat) {
    return { decision: "ignore", reason: "forwarded_message" };
  }

  if (
    !message.is_topic_message ||
    typeof message.message_thread_id !== "number"
  ) {
    return { decision: "ignore", reason: "not_a_forum_topic" };
  }

  if (typeof message.text !== "string") {
    return { decision: "ignore", reason: "not_text" };
  }

  const mentions = mentionEntities(message, botUsername, botIdentifier);
  if (mentions.length === 0 && !isReplyToBot(message, botIdentifier)) {
    return { decision: "ignore", reason: "not_addressed_to_bot" };
  }

  const text = instructionText(message, mentions);
  if (text === "") {
    return { decision: "ignore", reason: "empty_instruction" };
  }

  return {
    decision: "instruction",
    updateIdentifier: update.update_id,
    messageIdentifier: message.message_id,
    sessionKey: `${message.chat.id}:${message.message_thread_id}`,
    authorIdentifier: message.from.id,
    text,
  };
}

/**
 * Verify that the author is still a member of the configured group.
 * The Telegram API is asked for every instruction; errors deny access.
 */
export async function verifyMembership({
  telegram,
  groupIdentifier,
  authorIdentifier,
}) {
  let member;
  try {
    member = await telegram.getChatMember({
      chatIdentifier: groupIdentifier,
      userIdentifier: authorIdentifier,
    });
  } catch (error) {
    return {
      verified: false,
      reason: "membership_check_failed",
      detail: error instanceof Error ? error.name : "unknown",
    };
  }

  const status = member?.status;
  if (typeof status !== "string" || !memberStatuses.has(status)) {
    return {
      verified: false,
      reason: "not_a_group_member",
      status: status ?? "unknown",
    };
  }

  return { verified: true, status };
}
