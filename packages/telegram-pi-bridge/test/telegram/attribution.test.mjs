import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyInstruction,
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
