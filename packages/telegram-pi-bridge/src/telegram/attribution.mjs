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
  largestPhotoSize,
  maximumImagesPerInstruction,
  photoAttachment,
  photoRefusal,
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

// The media this exact message carries. A compressed photo wins over a document
// because Telegram never sends both.
function ownMedia(message) {
  if (hasPhoto(message)) {
    return { kind: "photo", size: largestPhotoSize(message.photo) };
  }
  if (message.document) {
    return { kind: "document", document: message.document };
  }
  return null;
}

// The media of the addressed message wins over the media of the one it replies
// to: it is the file the person has just sent. A reply can quote a message from
// another topic, and that media is never this topic's attachment.
function messageMedia(message) {
  const own = ownMedia(message);
  if (own !== null) {
    return { ...own, origin: attachmentOrigins.message };
  }
  const replied = message.reply_to_message;
  if (!replied || replied.message_thread_id !== message.message_thread_id) {
    return null;
  }
  const quoted = ownMedia(replied);
  return quoted === null
    ? null
    : { ...quoted, origin: attachmentOrigins.reply };
}

// The checks that make a message part of the configured private forum topic.
// `null` means the message can be classified; otherwise it is ignored.
function baseRejection(message, { groupIdentifier }) {
  if (String(message.chat?.id) !== groupIdentifier) {
    return "other_chat";
  }
  if (message.sender_chat || !message.from || message.from.is_bot) {
    return "no_person_author";
  }
  if (message.forward_origin || message.forward_from_chat) {
    return "forwarded_message";
  }
  if (
    !message.is_topic_message ||
    typeof message.message_thread_id !== "number"
  ) {
    return "not_a_forum_topic";
  }
  return null;
}

function mentionsIn(content, context) {
  if (content === null) {
    return [];
  }
  return mentionEntities(
    content.text,
    content.entities,
    context.botUsername,
    context.botIdentifier,
  );
}

// The attachment of one media item, or the refusal it deserves.
function mediaAttachment(media) {
  if (media.kind === "photo") {
    const refusal = photoRefusal(media.size);
    return refusal === null
      ? { attachment: photoAttachment(media.size, media.origin) }
      : { refusal };
  }
  const refusal = imageDocumentRefusal(media.document);
  return refusal === null
    ? {
        attachment: imageDocumentAttachment(media.document, media.origin),
      }
    : { refusal };
}

function identityOf(message) {
  return {
    messageIdentifier: message.message_id,
    sessionKey: `${message.chat.id}:${message.message_thread_id}`,
    authorIdentifier: message.from.id,
  };
}

/**
 * Decide whether an update is an instruction for the agent.
 *
 * `botIdentifier` is the Telegram user identifier of the bot (from getMe), used
 * only to recognise replies to its own messages. A compressed photo is admitted
 * like an image document; both are refused when their type or size is not
 * accepted, before the instruction is queued.
 */
export function classifyInstruction(
  update,
  { groupIdentifier, botUsername, botIdentifier },
) {
  const message = update.message;
  if (!message) {
    return { decision: "ignore", reason: "not_a_message" };
  }

  const rejection = baseRejection(message, { groupIdentifier });
  if (rejection !== null) {
    return { decision: "ignore", reason: rejection };
  }

  const context = { groupIdentifier, botUsername, botIdentifier };
  const content = messageContent(message);
  const media = messageMedia(message);
  if (content === null && media === null) {
    return { decision: "ignore", reason: "not_text" };
  }

  const mentions = mentionsIn(content, context);
  if (mentions.length === 0 && !isReplyToBot(message, botIdentifier)) {
    return { decision: "ignore", reason: "not_addressed_to_bot" };
  }

  const identity = {
    updateIdentifier: update.update_id,
    ...identityOf(message),
  };

  const attachments = [];
  if (media !== null) {
    const admitted = mediaAttachment(media);
    if (admitted.refusal) {
      return { decision: "refuse", ...identity, ...admitted.refusal };
    }
    attachments.push(admitted.attachment);
  }

  const text = content === null ? "" : instructionText(content.text, mentions);
  if (text === "") {
    return { decision: "ignore", reason: "empty_instruction" };
  }

  return {
    decision: "instruction",
    ...identity,
    text,
    attachments,
  };
}

/**
 * Whether an update can be one image of an album addressed to the bot. Album
 * members are recognised before their text, because the caption and the mention
 * may travel with any of them. The remaining checks happen once per group.
 */
export function isAlbumMember(update, { groupIdentifier }) {
  const message = update.message;
  if (!message || typeof message.media_group_id !== "string") {
    return false;
  }
  if (baseRejection(message, { groupIdentifier }) !== null) {
    return false;
  }
  return ownMedia(message) !== null;
}

/**
 * Classify the updates of one album as a single instruction. The caption, the
 * mention and the reply to the bot may be on any member; the images are the
 * ones each member carries, up to the album limit.
 */
export function classifyAlbum(
  updates,
  { groupIdentifier, botUsername, botIdentifier },
) {
  let textContent = null;
  let textMentions = [];
  let answered = false;
  let replyToBot = false;
  const attachments = [];
  let refusals = null;
  let sessionMessage = null;

  for (const update of updates) {
    const message = update.message;
    if (message === undefined) {
      continue;
    }
    const rejection = baseRejection(message, { groupIdentifier });
    if (rejection !== null) {
      return { decision: "ignore", reason: rejection };
    }
    sessionMessage ??= message;
    const content = messageContent(message);
    const contentMentions =
      content === null
        ? []
        : mentionsIn(content, { botUsername, botIdentifier });
    if (content !== null && textContent === null) {
      textContent = content;
      textMentions = contentMentions;
    }
    if (contentMentions.length > 0) {
      answered = true;
    }
    if (isReplyToBot(message, botIdentifier)) {
      replyToBot = true;
    }
    const media = ownMedia(message);
    if (media === null) {
      continue;
    }
    const admitted = mediaAttachment({
      ...media,
      origin: attachmentOrigins.message,
    });
    if (admitted.refusal) {
      refusals ??= admitted.refusal;
      continue;
    }
    attachments.push(admitted.attachment);
  }

  const identity = {
    // A stable key: a member that arrives after a crash does not change it, so
    // the queue recognises the same album instead of admitting it twice.
    updateIdentifier: Math.min(...updates.map((update) => update.update_id)),
    ...identityOf(sessionMessage),
  };

  // An album that does not address the bot is not this topic's instruction, so
  // it is ignored before any refusal.
  if (!answered && !replyToBot) {
    return { decision: "ignore", reason: "not_addressed_to_bot" };
  }
  if (refusals !== null) {
    return { decision: "refuse", ...identity, ...refusals };
  }
  if (attachments.length > maximumImagesPerInstruction) {
    return {
      decision: "refuse",
      ...identity,
      reason: attachmentRefusalReasons.tooManyImages,
      count: attachments.length,
    };
  }
  const text =
    textContent === null ? "" : instructionText(textContent.text, textMentions);
  if (text === "") {
    return { decision: "ignore", reason: "empty_instruction" };
  }

  return {
    decision: "instruction",
    ...identity,
    text,
    attachments,
  };
}

/**
 * Verify that the author is still a member of the configured group.
 * The Telegram API is asked for every instruction; errors deny access. A caller
 * with its own deadline passes `signal`, so the read is bounded and stoppable.
 */
export async function verifyMembership({
  telegram,
  groupIdentifier,
  authorIdentifier,
  signal,
}) {
  let member;
  try {
    member = await telegram.getChatMember({
      chatIdentifier: groupIdentifier,
      userIdentifier: authorIdentifier,
      signal,
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
