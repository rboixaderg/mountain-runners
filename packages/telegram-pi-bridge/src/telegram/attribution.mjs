// Attribution rules for the private Telegram group.
//
// Only a message written by a person in the configured forum topic can be an
// instruction. Names, quotes, forwarded content and channel identities never
// prove authorship; a private chat or another group is never accepted.
//
// Membership is checked against Telegram for every new instruction. The check
// is not cached: a failure or an unexpected answer denies the instruction.

import {
  attachmentOrigins,
  attachmentRefusalReasons,
  imageDocumentAttachment,
  imageDocumentRefusal,
} from "./attachments.mjs";

export const memberStatuses = new Set(["creator", "administrator", "member"]);

function entityText(text, entity) {
  return text.slice(entity.offset, entity.offset + entity.length);
}

function mentionEntities(text, entities, botUsername, botIdentifier) {
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
      entityText(text, entity).toLowerCase() === `@${botUsername.toLowerCase()}`
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

function instructionText(text, mentions) {
  let stripped = text;
  for (const entity of mentions.toSorted(
    (first, second) => second.offset - first.offset,
  )) {
    stripped =
      stripped.slice(0, entity.offset) +
      stripped.slice(entity.offset + entity.length);
  }
  return stripped.trim();
}

// A text message uses `text`; a document uses `caption` and its own entities.
function messageContent(message) {
  if (typeof message.text === "string") {
    return {
      text: message.text,
      entities: Array.isArray(message.entities) ? message.entities : [],
    };
  }
  if (typeof message.caption === "string") {
    return {
      text: message.caption,
      entities: Array.isArray(message.caption_entities)
        ? message.caption_entities
        : [],
    };
  }
  return null;
}

function hasPhoto(entry) {
  return Array.isArray(entry?.photo) && entry.photo.length > 0;
}

// The media of the addressed message wins over the media of the one it replies
// to, and a compressed photo wins over a replied document: it is the file the
// person has just sent. A reply can quote a message from another topic, and that
// media is never this topic's attachment.
function messageMedia(message) {
  if (hasPhoto(message)) {
    return { photo: true };
  }
  if (message.document) {
    return { document: message.document, origin: attachmentOrigins.message };
  }
  const replied = message.reply_to_message;
  if (!replied || replied.message_thread_id !== message.message_thread_id) {
    return null;
  }
  if (hasPhoto(replied)) {
    return { photo: true };
  }
  if (replied.document) {
    return { document: replied.document, origin: attachmentOrigins.reply };
  }
  return null;
}

/**
 * Decide whether an update is an instruction for the agent.
 *
 * `botIdentifier` is the Telegram user identifier of the bot (from getMe), used
 * only to recognise replies to its own messages. An addressed photo is answered
 * with a refusal instead of being ignored, so its author knows to resend it as
 * a file; a document that is not an accepted image is refused the same way and
 * never queued.
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

  const content = messageContent(message);
  const media = messageMedia(message);
  const compressedPhoto = media?.photo === true;
  if (content === null && media === null) {
    return { decision: "ignore", reason: "not_text" };
  }

  const mentions =
    content === null
      ? []
      : mentionEntities(
          content.text,
          content.entities,
          botUsername,
          botIdentifier,
        );
  if (mentions.length === 0 && !isReplyToBot(message, botIdentifier)) {
    return { decision: "ignore", reason: "not_addressed_to_bot" };
  }

  const identity = {
    updateIdentifier: update.update_id,
    messageIdentifier: message.message_id,
    sessionKey: `${message.chat.id}:${message.message_thread_id}`,
    authorIdentifier: message.from.id,
  };

  if (compressedPhoto) {
    return {
      decision: "refuse",
      reason: attachmentRefusalReasons.photo,
      ...identity,
    };
  }

  if (media?.document) {
    const refusal = imageDocumentRefusal(media.document);
    if (refusal !== null) {
      return { decision: "refuse", ...identity, ...refusal };
    }
  }

  const text = content === null ? "" : instructionText(content.text, mentions);
  if (text === "") {
    return { decision: "ignore", reason: "empty_instruction" };
  }

  return {
    decision: "instruction",
    ...identity,
    text,
    attachment:
      media?.document === undefined
        ? null
        : imageDocumentAttachment(media.document, media.origin),
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
