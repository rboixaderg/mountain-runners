import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyAlbum,
  classifyInstruction,
  isAlbumMember,
  verifyMembership,
} from "../../src/telegram/attribution.mjs";

const groupIdentifier = "-1001234567890";
const botUsername = "example_agent_bot";
const botIdentifier = 999;

function mentionEntity(offset = 0) {
  return {
    type: "mention",
    offset,
    length: botUsername.length + 1,
  };
}

function botCommandEntity(command, offset = 0) {
  return { type: "bot_command", offset, length: command.length };
}

function baseUpdate(overrides = {}) {
  return {
    update_id: 1001,
    message: {
      message_id: 50,
      chat: { id: -1001234567890, type: "supergroup" },
      from: { id: 42, is_bot: false },
      is_topic_message: true,
      message_thread_id: 7,
      text: `@${botUsername} revisa el README`,
      entities: [mentionEntity()],
      ...overrides,
    },
  };
}

const context = { groupIdentifier, botUsername, botIdentifier };

test("accepts a mention in a forum topic and keeps the session key", () => {
  const result = classifyInstruction(baseUpdate(), context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.sessionKey, "-1001234567890:7");
  assert.equal(result.authorIdentifier, 42);
  assert.equal(result.updateIdentifier, 1001);
  assert.equal(result.text, "revisa el README");
});

test("removes multiple mentions using their original UTF-16 offsets", () => {
  const text = `🥾 @${botUsername} revisa @${botUsername} el README`;
  const firstOffset = text.indexOf("@");
  const secondOffset = text.lastIndexOf("@");
  const result = classifyInstruction(
    baseUpdate({
      text,
      entities: [mentionEntity(firstOffset), mentionEntity(secondOffset)],
    }),
    context,
  );
  assert.equal(result.text, "🥾  revisa  el README");
});

test("accepts a reply to the bot without a mention", () => {
  const update = baseUpdate({
    text: "i ara el CHANGELOG",
    entities: [],
    reply_to_message: { message_id: 49, from: { id: botIdentifier } },
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "i ara el CHANGELOG");
});

test("accepts a mention regardless of its case", () => {
  const text = `@${botUsername.toUpperCase()} fes un canvi petit`;
  const result = classifyInstruction(
    baseUpdate({ text, entities: [mentionEntity()] }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "fes un canvi petit");
});

test("rejects another group and a private chat", () => {
  for (const chat of [
    { id: -1005555555555, type: "supergroup" },
    { id: 42, type: "private" },
  ]) {
    const result = classifyInstruction(baseUpdate({ chat }), context);
    assert.equal(result.decision, "ignore");
    assert.equal(result.reason, "other_chat");
  }
});

test("rejects an anonymous group author", () => {
  const update = baseUpdate({
    from: undefined,
    sender_chat: { id: -1001234567890, type: "supergroup" },
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "no_person_author");
});

test("rejects a forwarded message even when it mentions the bot", () => {
  const update = baseUpdate({
    forward_origin: { type: "user", sender_user: { id: 7 } },
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "forwarded_message");
});

test("rejects a message outside a forum topic", () => {
  const update = baseUpdate({
    is_topic_message: false,
    message_thread_id: undefined,
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "not_a_forum_topic");
});

test("rejects a group message that does not address the bot", () => {
  const update = baseUpdate({
    text: `parlem de @${botUsername} però no li preguntem res`,
    entities: [{ type: "mention", offset: 10, length: 0 }],
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "not_addressed_to_bot");
});

test("rejects a mention of another person as an instruction", () => {
  const update = baseUpdate({
    text: "@altra_persona revisa el README",
    entities: [
      {
        type: "text_mention",
        offset: 0,
        length: 14,
        user: { id: 500 },
      },
    ],
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "not_addressed_to_bot");
});

test("rejects an empty instruction after the mention", () => {
  const result = classifyInstruction(
    baseUpdate({ text: `@${botUsername}`, entities: [mentionEntity()] }),
    context,
  );

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "empty_instruction");
});

test("accepts a slash command that names the bot and keeps its arguments", () => {
  const command = `/merge@${botUsername}`;
  const result = classifyInstruction(
    baseUpdate({
      text: `${command} 12`,
      entities: [botCommandEntity(command)],
    }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "/merge 12");
});

test("accepts a slash command that names the bot regardless of its case", () => {
  const command = `/merge@${botUsername.toUpperCase()}`;
  const result = classifyInstruction(
    baseUpdate({
      text: `${command} 12`,
      entities: [botCommandEntity(command)],
    }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "/merge 12");
});

test("rejects a slash command that names another bot", () => {
  const command = "/merge@altre_agent_bot";
  const result = classifyInstruction(
    baseUpdate({ text: command, entities: [botCommandEntity(command)] }),
    context,
  );

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "not_addressed_to_bot");
});

test("does not treat a reply to a forum topic creation as a reply to the bot", () => {
  const update = baseUpdate({
    text: "hola",
    entities: [],
    reply_to_message: {
      message_id: 49,
      from: { id: botIdentifier },
      forum_topic_created: { name: "Tema" },
    },
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "not_addressed_to_bot");
});

test("rejects a legacy forwarded message", () => {
  for (const forwarded of [
    { forward_from: { id: 7 } },
    { forward_sender_name: "Algú" },
    { forward_date: 1763000000 },
  ]) {
    const result = classifyInstruction(baseUpdate(forwarded), context);

    assert.equal(result.decision, "ignore");
    assert.equal(result.reason, "forwarded_message");
  }
});

test("accepts the member states of the configured group", async () => {
  for (const status of ["creator", "administrator", "member"]) {
    const telegram = {
      calls: 0,
      async getChatMember() {
        this.calls += 1;
        return { status };
      },
    };

    const result = await verifyMembership({
      telegram,
      groupIdentifier,
      authorIdentifier: 42,
    });

    assert.deepEqual(result, { verified: true, status });
    assert.equal(telegram.calls, 1);
  }
});

test("denies restricted, absent and unverifiable authors", async () => {
  for (const status of ["restricted", "left", "kicked"]) {
    const telegram = { getChatMember: async () => ({ status }) };

    const result = await verifyMembership({
      telegram,
      groupIdentifier,
      authorIdentifier: 42,
    });

    assert.equal(result.verified, false);
    assert.equal(result.reason, "not_a_group_member");
  }

  const failingTelegram = {
    getChatMember: async () => {
      throw new Error("network");
    },
  };
  const failure = await verifyMembership({
    telegram: failingTelegram,
    groupIdentifier,
    authorIdentifier: 42,
  });

  assert.equal(failure.verified, false);
  assert.equal(failure.reason, "membership_check_failed");
});

test("asks Telegram again for every instruction instead of caching", async () => {
  const statuses = ["member", "left"];
  const telegram = {
    calls: 0,
    async getChatMember() {
      const status = statuses[this.calls];
      this.calls += 1;
      return { status };
    },
  };

  const first = await verifyMembership({
    telegram,
    groupIdentifier,
    authorIdentifier: 42,
  });
  const second = await verifyMembership({
    telegram,
    groupIdentifier,
    authorIdentifier: 42,
  });

  assert.equal(first.verified, true);
  assert.equal(second.verified, false);
  assert.equal(telegram.calls, 2);
});

function imageDocument(overrides = {}) {
  return {
    file_id: "telegram-file",
    file_unique_id: "telegram-unique-file",
    file_name: "portada.png",
    mime_type: "image/png",
    file_size: 1200000,
    ...overrides,
  };
}

function documentUpdate(overrides = {}) {
  return baseUpdate({
    text: undefined,
    entities: undefined,
    caption: `@${botUsername} usa aquesta imatge`,
    caption_entities: [mentionEntity()],
    document: imageDocument(),
    ...overrides,
  });
}

test("accepts an image document with the mention in its caption", () => {
  const result = classifyInstruction(documentUpdate(), context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "usa aquesta imatge");
  assert.deepEqual(result.attachments, [
    {
      fileIdentifier: "telegram-file",
      fileUniqueIdentifier: "telegram-unique-file",
      fileName: "portada.png",
      mimeType: "image/png",
      fileSize: 1200000,
      origin: "message",
    },
  ]);
});

test("accepts a document that replies to the bot and takes its caption", () => {
  const result = classifyInstruction(
    documentUpdate({
      caption: "usa aquesta imatge",
      caption_entities: [],
      reply_to_message: { message_id: 49, from: { id: botIdentifier } },
    }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "usa aquesta imatge");
  assert.equal(result.attachments[0]?.origin, "message");
});

test("accepts the document of the message the instruction replies to", () => {
  const update = baseUpdate({
    reply_to_message: {
      message_id: 49,
      from: { id: 43, is_bot: false },
      message_thread_id: 7,
      document: imageDocument({
        file_name: "foto.webp",
        mime_type: "image/webp",
      }),
    },
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "revisa el README");
  assert.equal(result.attachments[0]?.origin, "reply");
  assert.equal(result.attachments[0]?.fileIdentifier, "telegram-file");
});

test("accepts a reply to the document message that answers with the rights", () => {
  const update = baseUpdate({
    text: `@${botUsername} l'origen és propi, els drets són de l'entitat i el crèdit és seu`,
    reply_to_message: {
      message_id: 49,
      from: { id: 43, is_bot: false },
      message_thread_id: 7,
      document: imageDocument(),
    },
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "instruction");
  assert.equal(
    result.text,
    "l'origen és propi, els drets són de l'entitat i el crèdit és seu",
  );
  assert.equal(result.attachments[0]?.origin, "reply");
});

test("ignores a document quoted from another topic", () => {
  const update = baseUpdate({
    reply_to_message: {
      message_id: 49,
      from: { id: 43, is_bot: false },
      message_thread_id: 8,
      document: imageDocument(),
    },
  });

  const result = classifyInstruction(update, context);

  assert.equal(result.decision, "instruction");
  assert.deepEqual(result.attachments, []);
});

test("keeps a text instruction without an attachment", () => {
  const result = classifyInstruction(baseUpdate(), context);

  assert.deepEqual(result.attachments, []);
});

test("accepts a compressed photo with its largest size", () => {
  const result = classifyInstruction(
    baseUpdate({
      text: undefined,
      entities: undefined,
      caption: `@${botUsername} usa aquesta foto`,
      caption_entities: [mentionEntity()],
      photo: [
        {
          file_id: "small",
          file_unique_id: "small-unique",
          width: 90,
          height: 90,
          file_size: 1000,
        },
        {
          file_id: "large",
          file_unique_id: "large-unique",
          width: 1280,
          height: 960,
          file_size: 200000,
        },
      ],
    }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.deepEqual(result.attachments, [
    {
      fileIdentifier: "large",
      fileUniqueIdentifier: "large-unique",
      fileName: "foto.jpg",
      mimeType: "image/jpeg",
      fileSize: 200000,
      origin: "message",
      width: 1280,
      height: 960,
    },
  ]);
  assert.equal(result.sessionKey, "-1001234567890:7");
  assert.equal(result.authorIdentifier, 42);
});

test("accepts an image-only reply to the bot as an instruction", () => {
  const result = classifyInstruction(
    baseUpdate({
      text: undefined,
      entities: undefined,
      photo: [{ file_id: "large", file_unique_id: "large-unique" }],
      reply_to_message: { message_id: 49, from: { id: botIdentifier } },
    }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "");
  assert.equal(result.attachments.length, 1);
});

test("accepts a caption that only mentions the bot when it carries an image", () => {
  const result = classifyInstruction(
    documentUpdate({
      caption: `@${botUsername}`,
      caption_entities: [mentionEntity()],
    }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "");
  assert.equal(result.attachments.length, 1);
});

test("refuses a document that is not an accepted image", () => {
  const result = classifyInstruction(
    documentUpdate({
      document: imageDocument({
        file_name: "informe.pdf",
        mime_type: "application/pdf",
      }),
    }),
    context,
  );

  assert.equal(result.decision, "refuse");
  assert.equal(result.reason, "unsupported_document");
  assert.equal(result.type, "application/pdf");
});

test("never echoes a declared type that is not a plain MIME token", () => {
  const result = classifyInstruction(
    documentUpdate({
      document: imageDocument({
        file_name: "informe.pdf",
        mime_type: "application/pdf\nforged trace line",
      }),
    }),
    context,
  );

  assert.equal(result.decision, "refuse");
  assert.equal(result.reason, "unsupported_document");
  assert.equal(result.type, undefined);
});

test("the photo of the message wins over a replied document", () => {
  const result = classifyInstruction(
    documentUpdate({
      text: undefined,
      entities: undefined,
      caption: `@${botUsername} usa aquesta foto`,
      caption_entities: [mentionEntity()],
      document: undefined,
      photo: [{ file_id: "large", file_unique_id: "large-unique" }],
      reply_to_message: {
        message_id: 49,
        from: { id: 43, is_bot: false },
        message_thread_id: 7,
        document: imageDocument(),
      },
    }),
    context,
  );

  assert.equal(result.decision, "instruction");
  assert.equal(result.attachments[0].fileIdentifier, "large");
  assert.equal(result.attachments[0].mimeType, "image/jpeg");
});

test("refuses an image above the 20 MB input limit with its size", () => {
  const fileSize = 21 * 1024 * 1024;
  const result = classifyInstruction(
    documentUpdate({ document: imageDocument({ file_size: fileSize }) }),
    context,
  );

  assert.equal(result.decision, "refuse");
  assert.equal(result.reason, "declared_too_large");
  assert.equal(result.type, "png");
  assert.equal(result.bytes, fileSize);
});

test("ignores a forwarded document message", () => {
  const result = classifyInstruction(
    documentUpdate({
      forward_origin: { type: "user", sender_user: { id: 7 } },
    }),
    context,
  );

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "forwarded_message");
});

test("ignores a document sent in another chat", () => {
  const result = classifyInstruction(
    documentUpdate({ chat: { id: -1005555555555, type: "supergroup" } }),
    context,
  );

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "other_chat");
});

test("ignores a document that does not address the bot", () => {
  const result = classifyInstruction(
    documentUpdate({ caption: "mira aquesta imatge", caption_entities: [] }),
    context,
  );

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "not_addressed_to_bot");
});

function albumMember(updateIdentifier, overrides = {}) {
  const update = baseUpdate({
    media_group_id: "album-1",
    photo: [
      {
        file_id: `photo-${updateIdentifier}`,
        file_unique_id: `unique-${updateIdentifier}`,
        width: 1280,
        height: 960,
        file_size: 200000,
      },
    ],
    ...overrides,
  });
  update.update_id = updateIdentifier;
  update.message.message_id = updateIdentifier + 1000;
  return update;
}

test("recognises an album member and uses the smallest update identifier as key", () => {
  const updates = [albumMember(12), albumMember(10), albumMember(11)];

  assert.equal(isAlbumMember(updates[0], context), true);
  const result = classifyAlbum(updates, context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.updateIdentifier, 10);
  assert.equal(result.attachments.length, 3);
  assert.deepEqual(
    result.attachments.map((attachment) => attachment.fileIdentifier),
    ["photo-10", "photo-11", "photo-12"],
  );
});

test("ignores an album that does not address the bot before any refusal", () => {
  const updates = [10, 11, 12, 13, 14, 15].map((updateIdentifier) =>
    albumMember(updateIdentifier, {
      text: "no adreçat al bot",
      entities: [],
    }),
  );

  const result = classifyAlbum(updates, context);

  assert.equal(result.decision, "ignore");
  assert.equal(result.reason, "not_addressed_to_bot");
});

test("ignores an album without updates or without a message", () => {
  assert.deepEqual(classifyAlbum([], context), {
    decision: "ignore",
    reason: "not_text",
  });
  assert.deepEqual(
    classifyAlbum([{ update_id: 10 }, { update_id: 11 }], context),
    { decision: "ignore", reason: "not_text" },
  );
});

test("rejects an album whose members have different identities", () => {
  for (const overrides of [
    { message_thread_id: 8 },
    { from: { id: 43, is_bot: false } },
  ]) {
    const result = classifyAlbum(
      [albumMember(10), albumMember(11, overrides)],
      context,
    );

    assert.equal(result.decision, "ignore");
    assert.equal(result.reason, "mixed_album_identity");
  }
});

test("prefers the album caption that mentions the bot", () => {
  const updates = [
    albumMember(10, {
      text: undefined,
      entities: undefined,
      caption: "usa aquestes fotos",
      caption_entities: [],
    }),
    albumMember(11, {
      text: undefined,
      entities: undefined,
      caption: `@${botUsername} fes això`,
      caption_entities: [mentionEntity()],
    }),
  ];

  const result = classifyAlbum(updates, context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "fes això");
});

test("uses the first non-empty album caption when none mentions the bot", () => {
  const updates = [
    albumMember(10, {
      text: undefined,
      entities: undefined,
      caption: "   ",
      caption_entities: [],
      reply_to_message: { message_id: 49, from: { id: botIdentifier } },
    }),
    albumMember(11, {
      text: undefined,
      entities: undefined,
      caption: "  usa la segona  ",
      caption_entities: [],
    }),
  ];

  const result = classifyAlbum(updates, context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "usa la segona");
});

test("accepts an image-only album that replies to the bot", () => {
  const updates = [
    albumMember(10, {
      text: undefined,
      entities: undefined,
      reply_to_message: { message_id: 49, from: { id: botIdentifier } },
    }),
    albumMember(11, { text: undefined, entities: undefined }),
  ];

  const result = classifyAlbum(updates, context);

  assert.equal(result.decision, "instruction");
  assert.equal(result.text, "");
  assert.equal(result.attachments.length, 2);
});
