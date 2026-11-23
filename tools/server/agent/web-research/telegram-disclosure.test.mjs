import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import {
  AgentBridge,
  classifyInstruction,
  TelegramApi,
} from "telegram-pi-bridge/telegram";
import {
  createDisclosureApprovals,
  disclosureApprovalReply,
  disclosureCancellationReply,
} from "./disclosure-approvals.mjs";
import { createTelegramDisclosure } from "./telegram-disclosure.mjs";

const attribution = {
  groupIdentifier: "-100123",
  botUsername: "example_bot",
  botIdentifier: 12,
};
const request = {
  operation: "read",
  destination: "https://example.test",
  input: "https://example.test/?name=synthetic&value=one",
};

function rawReply({ text = disclosureApprovalReply, ...overrides } = {}) {
  const message = {
    message_id: 902,
    chat: { id: -100123 },
    message_thread_id: 7,
    is_topic_message: true,
    from: { id: 42, is_bot: false },
    text,
    reply_to_message: {
      message_id: 900,
      chat: { id: -100123 },
      message_thread_id: 7,
      from: { id: 12, is_bot: true },
    },
    ...overrides,
  };
  return { update_id: 10, message };
}

function reply(overrides = {}) {
  const classified = classifyInstruction(rawReply(overrides), attribution);
  if (classified.decision !== "instruction") return null;
  return {
    sessionKey: classified.sessionKey,
    authorIdentifier: classified.authorIdentifier,
    replyMessageIdentifier: classified.replyMessageIdentifier,
    instruction: classified.text,
    exactDirectReply: classified.exactDirectReply,
  };
}

test("the bridge persists exactness and routes confirmations without a Pi turn", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "disclosure-queue-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "queue.sqlite");
  const effects = [];
  const updates = [
    rawReply({ text: ` ${disclosureApprovalReply}` }),
    rawReply(),
  ];
  updates[1].update_id = 11;
  const telegram = {
    sendMessage: async () => ({ message_id: 900 }),
    getUpdates: async () => updates,
    getChatMember: async () => {
      effects.push("membership");
      return { status: "member" };
    },
  };
  const coordinator = createTelegramDisclosure({
    telegram,
    attribution,
    checkMembership: async () => {
      effects.push("recheck");
      return { verified: true };
    },
    dispatch: async (retained) => {
      effects.push(retained);
      return "resultat";
    },
  });
  assert.equal(
    await coordinator.offer({
      sessionKey: "-100123:7",
      authorIdentifier: 42,
      request,
    }),
    true,
  );
  let queue = new AdmissionQueue(path, { maxPending: 10 });
  const makeBridge = () =>
    new AgentBridge({
      ...attribution,
      queue,
      telegram,
      runInstruction: async (admitted, { signal }) => {
        const result = await coordinator.handle({ request: admitted, signal });
        if (result === null) effects.push("pi");
        else effects.push(result.status);
        return { outcome: "answered" };
      },
    });
  await makeBridge().pollOnce();
  queue.close();
  queue = new AdmissionQueue(path, { maxPending: 10 });
  const bridge = makeBridge();
  await bridge.executeNext();
  await bridge.executeNext();
  queue.close();
  assert.deepEqual(effects, [
    "membership",
    "membership",
    "refused",
    "recheck",
    request,
    "handled",
  ]);
});

function setup({
  payload = { ok: true, result: { message_id: 900 } },
  status = 200,
  checkMembership,
  approvals,
} = {}) {
  const sent = [];
  const effects = [];
  const telegram = new TelegramApi({
    botToken: "synthetic",
    fetchImpl: async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const coordinator = createTelegramDisclosure({
    telegram,
    attribution,
    approvals,
    checkMembership:
      checkMembership ??
      (async (identity) => {
        effects.push({ membership: identity });
        return { verified: true };
      }),
    dispatch: async (retained, identity) => {
      effects.push({ dispatch: retained, identity });
      return "resultat";
    },
  });
  const offer = (overrides = {}) =>
    coordinator.offer({
      sessionKey: "-100123:7",
      authorIdentifier: 42,
      request,
      ...overrides,
    });
  return { ...coordinator, offer, sent, effects, telegram };
}

test("sends the exact canonical request to the topic without previews, then dispatches only after rechecking membership", async () => {
  const fixture = setup();
  const mutable = { ...request, input: `${request.input}\n\u202e"end` };
  assert.equal(await fixture.offer({ request: mutable }), true);
  mutable.input = "changed";
  assert.equal(fixture.sent.length, 1);
  const body = fixture.sent[0].body;
  assert.match(fixture.sent[0].url, /\/sendMessage$/u);
  assert.equal(body.chat_id, -100123);
  assert.equal(body.message_thread_id, 7);
  assert.deepEqual(body.link_preview_options, { is_disabled: true });
  assert.equal(Object.hasOwn(body, "parse_mode"), false);
  const json = body.text.slice(
    body.text.indexOf("{"),
    body.text.lastIndexOf("}") + 1,
  );
  assert.deepEqual(JSON.parse(json), {
    ...request,
    input: `${request.input}\n\u202e"end`,
  });
  assert.ok(json.includes("\\u202e"));
  assert.ok(body.text.includes(disclosureApprovalReply));
  assert.ok(body.text.includes(disclosureCancellationReply));
  assert.deepEqual(await fixture.handle({ request: reply() }), {
    status: "handled",
    result: "resultat",
  });
  assert.deepEqual(fixture.effects, [
    {
      membership: {
        groupIdentifier: "-100123",
        authorIdentifier: 42,
        signal: undefined,
      },
    },
    {
      dispatch: { ...request, input: `${request.input}\n\u202e"end` },
      identity: {
        sessionKey: "-100123:7",
        authorIdentifier: 42,
        signal: undefined,
      },
    },
  ]);
  assert.deepEqual(await fixture.handle({ request: reply() }), {
    status: "refused",
  });
  assert.equal(fixture.effects.length, 2);
});

test("the Telegram API omits preview options unless explicitly enabled", async () => {
  const fixture = setup();
  for (const disableLinkPreview of [undefined, false, true]) {
    await fixture.telegram.sendMessage({
      chatIdentifier: -100123,
      text: "hello",
      disableLinkPreview,
    });
  }
  assert.deepEqual(
    fixture.sent.map(({ body }) => body),
    [
      { chat_id: -100123, text: "hello" },
      { chat_id: -100123, text: "hello" },
      {
        chat_id: -100123,
        text: "hello",
        link_preview_options: { is_disabled: true },
      },
    ],
  );
});

test("failed or unconfirmed sends never offer approval", async () => {
  for (const payload of [
    { ok: false, description: "failed" },
    { ok: true },
    { ok: true, result: { message_id: 0 } },
    { ok: true, result: { message_id: "900" } },
  ]) {
    const fixture = setup({ payload });
    if (payload.ok === false) await assert.rejects(fixture.offer());
    else assert.equal(await fixture.offer(), false);
    assert.deepEqual(await fixture.handle({ request: reply() }), {
      status: "refused",
    });
    assert.deepEqual(fixture.effects, []);
  }
});

test("an HTTP failure with a success payload cannot register an approval", async () => {
  const fixture = setup({ status: 500 });
  await assert.rejects(fixture.offer(), /HTTP 500/u);
  assert.deepEqual(await fixture.handle({ request: reply() }), {
    status: "refused",
  });
  assert.deepEqual(fixture.effects, []);
});

test("only a direct, exact literal from the original author and topic is eligible", async () => {
  const fixture = setup();
  assert.equal(await fixture.offer(), true);
  const mismatches = [
    reply({ text: ` ${disclosureApprovalReply}` }),
    reply({ text: `${disclosureApprovalReply} ` }),
    reply({ text: "Sí" }),
    { ...reply(), exactDirectReply: 1 },
    { ...reply(), replyMessageIdentifier: null },
    reply({ from: { id: 43, is_bot: false } }),
    reply({ chat: { id: -100124 } }),
    reply({ message_thread_id: 8 }),
    reply({
      reply_to_message: {
        message_id: 901,
        chat: { id: -100123 },
        message_thread_id: 7,
        from: { id: 12 },
      },
    }),
    reply({
      reply_to_message: {
        message_id: 900,
        chat: { id: -100123 },
        message_thread_id: 8,
        from: { id: 12 },
      },
    }),
    reply({ quote: { text: disclosureApprovalReply } }),
    reply({ external_reply: {} }),
    reply({ edit_date: 1 }),
    reply({ forward_date: 1 }),
    reply({ via_bot: { id: 2 } }),
    reply({
      photo: [{ file_id: "synthetic", file_size: 1, width: 1, height: 1 }],
    }),
    reply({ entities: [{ type: "blockquote", offset: 0, length: 1 }] }),
  ];
  for (const admitted of mismatches) {
    // Messages rejected by attribution never reach the coordinator.
    if (admitted === null) continue;
    const result = await fixture.handle({ request: admitted });
    assert.deepEqual(
      result,
      admitted.instruction === "Sí" ? null : { status: "refused" },
    );
  }
  assert.deepEqual(fixture.effects, []);
  assert.equal((await fixture.handle({ request: reply() })).status, "handled");
});

test("cancellation, expiry, restart, and a newer request do not authorize an old request", async () => {
  let time = 0;
  const approvals = createDisclosureApprovals({ now: () => time });
  const fixture = setup({ approvals });
  assert.equal(await fixture.offer(), true);
  assert.deepEqual(
    await fixture.handle({
      request: reply({ text: disclosureCancellationReply }),
    }),
    { status: "cancelled" },
  );
  assert.deepEqual(await fixture.handle({ request: reply() }), {
    status: "refused",
  });
  assert.deepEqual(await setup().handle({ request: reply() }), {
    status: "refused",
  });
  time += 300_000;
  assert.equal(await fixture.offer(), true);
  time += 300_000;
  assert.deepEqual(await fixture.handle({ request: reply() }), {
    status: "refused",
  });

  // Reuse a single approval store across both sends, as the coordinator does.
  const shared = createDisclosureApprovals();
  const first = setup({ approvals: shared });
  const second = createTelegramDisclosure({
    telegram: { sendMessage: async () => ({ message_id: 901 }) },
    attribution,
    approvals: shared,
    checkMembership: async () => ({ verified: true }),
    dispatch: async () => "new",
  });
  assert.equal(await first.offer(), true);
  assert.equal(
    await second.offer({
      sessionKey: "-100123:7",
      authorIdentifier: 42,
      request: { ...request, input: "changed" },
    }),
    true,
  );
  assert.deepEqual(await first.handle({ request: reply() }), {
    status: "refused",
  });
  assert.deepEqual(
    await second.handle({
      request: reply({
        reply_to_message: {
          message_id: 901,
          chat: { id: -100123 },
          message_thread_id: 7,
          from: { id: 12 },
        },
      }),
    }),
    { status: "handled", result: "new" },
  );
});

test("membership denial or failure consumes the one-use approval", async () => {
  for (const checkMembership of [
    async () => ({ verified: false }),
    async () => ({ verified: 1 }),
    async () => {
      throw new Error("unavailable");
    },
  ]) {
    const fixture = setup({ checkMembership });
    assert.equal(await fixture.offer(), true);
    assert.deepEqual(await fixture.handle({ request: reply() }), {
      status: "refused",
    });
    assert.deepEqual(await fixture.handle({ request: reply() }), {
      status: "refused",
    });
    assert.deepEqual(fixture.effects, []);
  }
});

test("concurrent confirmations atomically consume before asynchronous membership", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fixture = setup({
    checkMembership: async () => {
      await gate;
      return { verified: true };
    },
  });
  assert.equal(await fixture.offer(), true);
  const first = fixture.handle({ request: reply() });
  assert.deepEqual(await fixture.handle({ request: reply() }), {
    status: "refused",
  });
  release();
  assert.equal((await first).status, "handled");
  assert.equal(fixture.effects.length, 1);
});

test("oversized or wrong-topic offers do not send a question", async () => {
  const fixture = setup();
  assert.equal(
    await fixture.offer({ request: { ...request, input: "a".repeat(4096) } }),
    false,
  );
  assert.equal(await fixture.offer({ sessionKey: "-100124:7" }), false);
  assert.equal(await fixture.offer({ authorIdentifier: 0 }), false);
  assert.deepEqual(fixture.sent, []);
});

test("an in-flight send cannot be overtaken by a newer request from the same author", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const effects = [];
  const coordinator = createTelegramDisclosure({
    telegram: {
      sendMessage: async () => {
        await gate;
        return { message_id: 900 };
      },
    },
    attribution,
    checkMembership: async () => ({ verified: true }),
    dispatch: async (retained) => {
      effects.push(retained);
    },
  });
  const identity = { sessionKey: "-100123:7", authorIdentifier: 42 };
  const mutable = { ...request };
  const first = coordinator.offer({ ...identity, request: mutable });
  assert.deepEqual(await coordinator.handle({ request: reply() }), {
    status: "refused",
  });
  assert.equal(
    await coordinator.offer({
      ...identity,
      request: { ...request, input: "changed" },
    }),
    false,
  );
  mutable.input = "mutated while sending";
  release();
  assert.equal(await first, true);
  await coordinator.handle({ request: reply() });
  assert.deepEqual(effects, [request]);
});

test("a stop during membership or sending never dispatches or offers", async () => {
  const controller = new AbortController();
  const fixture = setup({
    checkMembership: async () => {
      controller.abort();
      return { verified: true };
    },
  });
  assert.equal(await fixture.offer(), true);
  assert.deepEqual(
    await fixture.handle({ request: reply(), signal: controller.signal }),
    { status: "refused" },
  );
  assert.deepEqual(await fixture.handle({ request: reply() }), {
    status: "refused",
  });
  assert.deepEqual(fixture.effects, []);

  const stopped = new AbortController();
  const coordinator = createTelegramDisclosure({
    telegram: {
      sendMessage: async () => {
        stopped.abort();
        return { message_id: 900 };
      },
    },
    attribution,
    checkMembership: async () => ({ verified: true }),
    dispatch: async () => {
      throw new Error("must not dispatch");
    },
  });
  assert.equal(
    await coordinator.offer({
      sessionKey: "-100123:7",
      authorIdentifier: 42,
      request,
      signal: stopped.signal,
    }),
    false,
  );
  assert.deepEqual(await coordinator.handle({ request: reply() }), {
    status: "refused",
  });
});
