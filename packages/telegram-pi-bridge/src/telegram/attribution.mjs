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

// The text range of a mention, or null. A bot command that names the bot only
// loses the `@username` suffix: `/merge@bot 12` keeps `/merge 12`.
function mentionRange(text, entity, botUsername, botIdentifier) {
  if (entity.type === "text_mention") {
    if (
      typeof botIdentifier !== "number" ||
      entity.user?.id !== botIdentifier
    ) {
      return null;
    }
    return { offset: entity.offset, length: entity.length };
  }
  if (entity.type === "mention") {
    const mention = entityText(text, entity);
    return mention.toLowerCase() === `@${botUsername.toLowerCase()}`
      ? { offset: entity.offset, length: entity.length }
      : null;
  }
  if (entity.type !== "bot_command") {
    return null;
  }
  const command = entityText(text, entity);
  const suffixStart = command.lastIndexOf("@");
  if (suffixStart === -1) {
    return null;
  }
  const suffix = command.slice(suffixStart);
  return suffix.toLowerCase() === `@${botUsername.toLowerCase()}`
    ? { offset: entity.offset + suffixStart, length: suffix.length }
    : null;
}

function mentionRanges(text, entities, botUsername, botIdentifier) {
  return entities
    .map((entity) => mentionRange(text, entity, botUsername, botIdentifier))
    .filter((range) => range !== null);
}

function isReplyToBot(message, botIdentifier) {
  const replied = message.reply_to_message;
  // The creation of a forum topic is a service message the bot may author, but
  // a reply to it is not a reply to the bot.
  if (replied?.forum_topic_created !== undefined) {
    return false;
  }
  return (
    typeof botIdentifier === "number" && replied?.from?.id === botIdentifier
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
  if (
    message.forward_origin ||
    message.forward_from_chat ||
    message.forward_from !== undefined ||
    message.forward_sender_name !== undefined ||
    message.forward_date !== undefined
  ) {
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
  return mentionRanges(
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
  // An image alone is a valid instruction when the person replies to the bot or
  // captions it with only the mention of the bot.
  if (text === "" && attachments.length === 0) {
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
  // Telegram normally delivers the members in order, but the classifier also
  // accepts an unsorted list: the order decides the stable album key and the
  // attachment order. Updates without a message cannot be a member.
  const orderedUpdates = updates
    .filter((update) => update.message !== undefined)
    .toSorted((first, second) => first.update_id - second.update_id);
  if (orderedUpdates.length === 0) {
    return { decision: "ignore", reason: "not_text" };
  }
  const sessionMessage = orderedUpdates[0].message;

  let textContent = null;
  let textMentions = [];
  let answered = false;
  let replyToBot = false;
  const attachments = [];
  let refusals = null;

  for (const update of orderedUpdates) {
    const message = update.message;
    const rejection = baseRejection(message, { groupIdentifier });
    if (rejection !== null) {
      return { decision: "ignore", reason: rejection };
    }
    // One album has one author, chat and topic. A media group identifier that
    // repeats across them must never merge two people's images.
    if (
      message.chat.id !== sessionMessage.chat.id ||
      message.message_thread_id !== sessionMessage.message_thread_id ||
      message.from.id !== sessionMessage.from.id
    ) {
      return { decision: "ignore", reason: "mixed_album_identity" };
    }
    const content = messageContent(message);
    const contentMentions =
      content === null
        ? []
        : mentionsIn(content, { botUsername, botIdentifier });
    if (
      content !== null &&
      (textContent === null ||
        (textMentions.length === 0 &&
          (contentMentions.length > 0 ||
            (textContent.text.trim() === "" && content.text.trim() !== ""))))
    ) {
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
    updateIdentifier: orderedUpdates[0].update_id,
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
  if (text === "" && attachments.length === 0) {
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
