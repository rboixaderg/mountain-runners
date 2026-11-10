import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "../../src/sessions/queue.mjs";
import {
  AgentBridge,
  defaultBridgeMessages,
} from "../../src/telegram/bridge.mjs";

const groupIdentifier = "-1001234567890";
const botUsername = "example_agent_bot";
const botIdentifier = 999;

function context(t, { maxPending = 10 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "telegram-pi-bridge-"));
  t.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const queue = new AdmissionQueue(join(directory, "admission.sqlite"), {
    maxPending,
  });
  t.after(() => queue.close());
  return { directory, queue };
}

function instructionUpdate(updateIdentifier, threadIdentifier, overrides = {}) {
  return {
    update_id: updateIdentifier,
    message: {
      message_id: updateIdentifier + 1000,
      chat: { id: -1001234567890, type: "supergroup" },
      from: { id: 42, is_bot: false },
      is_topic_message: true,
      message_thread_id: threadIdentifier,
      text: `@${botUsername} fes una tasca ${updateIdentifier}`,
      entities: [
        { type: "mention", offset: 0, length: botUsername.length + 1 },
      ],
      ...overrides,
    },
  };
}

function telegramStub({ batches, members = { 42: "member" } }) {
  return {
    pendingBatches: [...batches],
    sent: [],
    requestedOffsets: [],
    async getUpdates({ offset }) {
      this.requestedOffsets.push(offset);
      return this.pendingBatches.shift() ?? [];
    },
    async getChatMember({ userIdentifier }) {
      const status = members[userIdentifier];
      if (status === undefined) {
        throw new Error("unverifiable");
      }
      return { status };
    },
    async sendMessage({ chatIdentifier, messageThreadIdentifier, text }) {
      this.sent.push({ chatIdentifier, messageThreadIdentifier, text });
    },
  };
}

function bridgeFor({
  queue,
  telegram,
  runInstruction = async () => ({}),
  messages,
}) {
  return new AgentBridge({
    groupIdentifier,
    botUsername,
    messages,
    telegram,
    queue,
    runInstruction,
    botIdentifier,
    pollTimeoutSeconds: 1,
  });
}

test("executes an admitted instruction once and reports in its topic", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({ batches: [[instructionUpdate(10, 7)]] });
  const executed = [];
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async (request) => {
      executed.push(request);
      return { outcome: "answered", report: "Resposta al fil." };
    },
  });

  assert.equal(await bridge.pollOnce(), 1);
  assert.equal((await bridge.executeNext()) !== null, true);

  assert.equal(executed.length, 1);
  assert.equal(executed[0].sessionKey, "-1001234567890:7");
  assert.equal(executed[0].instruction, "fes una tasca 10");
  assert.deepEqual(telegram.sent, [
    {
      chatIdentifier: -1001234567890,
      messageThreadIdentifier: 7,
      text: "Resposta al fil.",
    },
  ]);
  assert.equal(queue.status(10), "done");
  assert.equal(queue.readOffset(), 11);
});

test("executes a redelivered update only once", async (t) => {
  const { queue } = context(t);
  const update = instructionUpdate(10, 7);
  const telegram = telegramStub({ batches: [[update], [update]] });
  let executions = 0;
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => {
      executions += 1;
      return { outcome: "answered", report: "un cop" };
    },
  });

  await bridge.pollOnce();
  await bridge.executeNext();
  await bridge.pollOnce();
  await bridge.executeNext();

  assert.equal(executions, 1);
  assert.equal(telegram.sent.length, 1);
});

test("denies an instruction from a person outside the group", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7)]],
    members: { 42: "left" },
  });
  let executions = 0;
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => {
      executions += 1;
      return {};
    },
  });

  await bridge.pollOnce();
  await bridge.executeNext();

  assert.equal(executions, 0);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.readOffset(), 11);
  assert.deepEqual(telegram.sent, []);
  assert.equal(queue.traceEntries()[0].action, "instruction_denied");
  assert.equal(queue.traceEntries()[0].detail, "not_a_group_member");
});

test("ignores another group, a private chat and a message that does not address the bot", async (t) => {
  const { queue } = context(t);
  const otherGroup = instructionUpdate(10, 7, {
    chat: { id: -1005555555555, type: "supergroup" },
  });
  const privateChat = instructionUpdate(11, 7, {
    chat: { id: 42, type: "private" },
  });
  const notAddressed = instructionUpdate(12, 7, {
    text: "només parlem entre nosaltres",
    entities: [],
  });
  const telegram = telegramStub({
    batches: [[otherGroup, privateChat, notAddressed]],
  });
  let executions = 0;
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => {
      executions += 1;
      return {};
    },
  });

  await bridge.pollOnce();
  await bridge.executeNext();

  assert.equal(executions, 0);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.readOffset(), 13);
  assert.deepEqual(telegram.sent, []);
});

test("rejects an instruction when the pending queue is full", async (t) => {
  const { queue } = context(t, { maxPending: 1 });
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7), instructionUpdate(11, 8)]],
  });
  const bridge = bridgeFor({ queue, telegram });

  await bridge.pollOnce();

  assert.equal(queue.status(10), "pending");
  assert.equal(queue.status(11), "rejected");
  assert.deepEqual(telegram.sent, [
    {
      chatIdentifier: -1001234567890,
      messageThreadIdentifier: 8,
      text: defaultBridgeMessages.queueFull,
    },
  ]);
});

test("stops new work when the run throws and reports the unknown result", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7), instructionUpdate(11, 8)]],
  });
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => {
      throw new Error("sandbox crashed with synthetic output");
    },
  });

  await bridge.pollOnce();
  await bridge.executeNext();
  await bridge.executeNext();

  assert.equal(queue.status(10), "uncertain");
  assert.equal(queue.status(11), "pending");
  assert.equal(telegram.sent[0].text, defaultBridgeMessages.unknownResult);
  assert.equal(
    telegram.sent[0].text.includes("synthetic output"),
    false,
    "internal failure details are not published to the topic",
  );
});

test("processes two topics in arrival order", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({
    batches: [
      [
        instructionUpdate(10, 7, { text: `@${botUsername} primera` }),
        instructionUpdate(11, 8, { text: `@${botUsername} segona` }),
      ],
    ],
  });
  const order = [];
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async (request) => {
      order.push(request.sessionKey);
      return { outcome: "answered", report: `fet ${request.sessionKey}` };
    },
  });

  await bridge.pollOnce();
  while (await bridge.executeNext()) {
    // drain the queue
  }

  assert.deepEqual(order, ["-1001234567890:7", "-1001234567890:8"]);
  assert.equal(telegram.sent.length, 2);
});

test("limits a long answer to the Telegram message budget", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({ batches: [[instructionUpdate(10, 7)]] });
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => ({
      outcome: "answered",
      report: "x".repeat(5000),
    }),
  });

  await bridge.pollOnce();
  await bridge.executeNext();

  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].text.length, 4000);
  assert.match(telegram.sent[0].text, /…$/u);
});

test("uses application messages and forwards cancellation to the instruction callback", async (contextObject) => {
  const { queue } = context(contextObject, { maxPending: 1 });
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7), instructionUpdate(11, 7)]],
  });
  const controller = new AbortController();
  const messages = {
    queueFull: "Custom queue message",
    unknownResult: "Custom uncertainty message",
  };
  const bridge = bridgeFor({
    queue,
    telegram,
    messages,
    runInstruction: async (_request, { signal }) => {
      assert.equal(signal, controller.signal);
      throw new Error("Synthetic interruption");
    },
  });
  await bridge.pollOnce();
  await bridge.executeNext({ signal: controller.signal });
  assert.deepEqual(
    telegram.sent.map((message) => message.text),
    [messages.queueFull, messages.unknownResult],
  );
});

test("uses the fallback message and blocks the queue for an uncertain result without a report", async (contextObject) => {
  const { queue } = context(contextObject);
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7), instructionUpdate(11, 7)]],
  });
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => ({ outcome: "uncertain" }),
  });
  await bridge.pollOnce();
  await bridge.executeNext();
  assert.equal(queue.status(10), "uncertain");
  assert.equal(await bridge.executeNext(), null);
  assert.equal(telegram.sent[0].text, defaultBridgeMessages.unknownResult);
});
