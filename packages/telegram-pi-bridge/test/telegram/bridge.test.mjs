import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdmissionQueue } from "../../src/sessions/queue.mjs";
import { TelegramApi } from "../../src/telegram/api.mjs";
import {
  AgentBridge,
  defaultBridgeMessages,
  instructionExcerpt,
  maximumAcknowledgementExcerptLength,
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

/** A real client whose long poll and membership answer, and whose send hangs. */
function telegramApiWithHangingSend({ batches }) {
  const pendingBatches = [...batches];
  const requestedMethods = [];
  const fetchImpl = async (url, init) => {
    const method = url.slice(url.lastIndexOf("/") + 1);
    requestedMethods.push(method);
    if (method === "getUpdates") {
      return {
        status: 200,
        async json() {
          return { ok: true, result: pendingBatches.shift() ?? [] };
        },
      };
    }
    if (method === "getChatMember") {
      return {
        status: 200,
        async json() {
          return { ok: true, result: { status: "member" } };
        },
      };
    }
    // The acknowledgement never answers: only the client deadline ends it.
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
    });
  };
  return {
    requestedMethods,
    api: new TelegramApi({
      botToken: "123:synthetic-token",
      fetchImpl,
      requestTimeoutMilliseconds: 100,
    }),
  };
}

function bridgeFor({
  queue,
  telegram,
  runInstruction = async () => ({}),
  runWhenIdle,
  messages,
  onServiceReport,
  logger = () => {},
  membershipTimeoutMilliseconds,
}) {
  return new AgentBridge({
    groupIdentifier,
    botUsername,
    messages,
    telegram,
    queue,
    runInstruction,
    runWhenIdle,
    onServiceReport,
    botIdentifier,
    logger,
    pollTimeoutSeconds: 1,
    membershipTimeoutMilliseconds,
  });
}

/** A membership read that only ends when its bounded signal aborts. */
function hangingMembershipTelegram({ batches }) {
  const telegram = telegramStub({ batches });
  telegram.membershipSignals = [];
  telegram.getChatMember = ({ signal }) => {
    telegram.membershipSignals.push(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  };
  return telegram;
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
      text: defaultBridgeMessages.acknowledgement("fes una tasca 10"),
    },
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
  assert.equal(
    telegram.sent.filter((message) =>
      message.text.startsWith("Instruction received"),
    ).length,
    1,
    "a redelivered update is acknowledged once",
  );
  assert.equal(telegram.sent.length, 2);
});

test("acknowledges an admitted instruction before running it", async (t) => {
  const { queue } = context(t);
  const order = [];
  const telegram = telegramStub({ batches: [[instructionUpdate(10, 7)]] });
  const sendMessage = telegram.sendMessage.bind(telegram);
  telegram.sendMessage = async (message) => {
    order.push(`send:${message.text}`);
    await sendMessage(message);
  };
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => {
      order.push("run");
      return { outcome: "answered", report: "fet" };
    },
  });

  await bridge.pollOnce();
  await bridge.executeNext();

  assert.equal(
    order[0],
    `send:${defaultBridgeMessages.acknowledgement("fes una tasca 10")}`,
  );
  assert.equal(order[1], "run");
});

test("runs the instruction when the acknowledgement cannot be sent", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({ batches: [[instructionUpdate(10, 7)]] });
  const events = [];
  telegram.sendMessage = async () => {
    events.push("send_failed");
    throw new Error("Synthetic transport failure");
  };
  const bridge = bridgeFor({
    queue,
    telegram,
    logger: (event) => events.push(event),
    runInstruction: async () => ({ outcome: "answered", report: "fet" }),
  });

  await bridge.pollOnce();
  await bridge.executeNext();

  assert.equal(queue.status(10), "done");
  assert.ok(events.includes("reply_failed"));
});

test("advances the offset after an acknowledgement that reaches its deadline", async (t) => {
  const { queue } = context(t);
  const { api, requestedMethods } = telegramApiWithHangingSend({
    batches: [[instructionUpdate(10, 7)]],
  });
  const events = [];
  const bridge = bridgeFor({
    queue,
    telegram: api,
    logger: (event) => events.push(event),
    runInstruction: async () => ({ outcome: "answered", report: "fet" }),
  });

  assert.equal(await bridge.pollOnce(), 1);

  // The instruction is durable even though its acknowledgement timed out, so
  // the offset moves on and the next read continues from it.
  assert.equal(queue.status(10), "pending");
  assert.equal(queue.readOffset(), 11);
  assert.deepEqual(events, ["reply_failed"]);
  assert.equal(await bridge.pollOnce(), 0);
  assert.deepEqual(requestedMethods, [
    "getUpdates",
    "getChatMember",
    "sendMessage",
    "getUpdates",
  ]);
});

test("keeps the acknowledgement to one short line", () => {
  assert.equal(
    instructionExcerpt("  primera\nsegona\tlinia "),
    "primera segona linia",
  );
  const longExcerpt = instructionExcerpt("x".repeat(300));
  assert.equal(longExcerpt.length, maximumAcknowledgementExcerptLength);
  assert.match(longExcerpt, /…$/u);
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
  assert.deepEqual(
    telegram.sent.map((message) => message.text),
    [
      defaultBridgeMessages.acknowledgement("fes una tasca 10"),
      defaultBridgeMessages.queueFull,
    ],
  );
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
  assert.equal(telegram.sent[2].text, defaultBridgeMessages.unknownResult);
  assert.equal(
    telegram.sent[2].text.includes("synthetic output"),
    false,
    "internal failure details are not published to the topic",
  );
});

test("continues with the next instruction after a known local failure", async (contextObject) => {
  const { queue } = context(contextObject);
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7), instructionUpdate(11, 8)]],
  });
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async (request) =>
      request.updateIdentifier === 10
        ? { outcome: "failed", report: "Local failure; no publication" }
        : { outcome: "answered", report: "Next task completed" },
  });
  await bridge.pollOnce();
  await bridge.executeNext();
  await bridge.executeNext();
  assert.equal(queue.status(10), "done");
  assert.equal(queue.status(11), "done");
  assert.equal(telegram.sent[3].text, "Next task completed");
});

test("rejects and reports new instructions while an uncertain run blocks the queue", async (contextObject) => {
  const { queue } = context(contextObject);
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7)], [instructionUpdate(11, 8)]],
  });
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => ({ outcome: "uncertain" }),
  });
  await bridge.pollOnce();
  await bridge.executeNext();
  await bridge.pollOnce();
  assert.equal(queue.status(11), "rejected");
  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.readOffset(), 12);
  assert.equal(telegram.sent[2].text, defaultBridgeMessages.queueBlocked);
});

test("tells the author to retry when Telegram cannot verify membership", async (contextObject) => {
  const { queue } = context(contextObject);
  const telegram = telegramStub({
    batches: [[instructionUpdate(10, 7)]],
    members: {},
  });
  const bridge = bridgeFor({ queue, telegram });
  await bridge.pollOnce();
  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.readOffset(), 11);
  assert.equal(telegram.sent.length, 1);
  assert.equal(
    telegram.sent[0].text,
    defaultBridgeMessages.membershipUnavailable,
  );
});

test("denies an instruction when the membership read runs out of its deadline", async (t) => {
  const { queue } = context(t);
  const telegram = hangingMembershipTelegram({
    batches: [[instructionUpdate(10, 7)]],
  });
  const bridge = bridgeFor({
    queue,
    telegram,
    membershipTimeoutMilliseconds: 10,
  });

  assert.equal(await bridge.pollOnce(), 1);

  assert.equal(telegram.membershipSignals.length, 1);
  assert.ok(telegram.membershipSignals[0] instanceof AbortSignal);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.readOffset(), 11);
  assert.equal(telegram.sent.length, 1);
  assert.equal(
    telegram.sent[0].text,
    defaultBridgeMessages.membershipUnavailable,
  );
});

test("keeps the update unread when the service stops during the membership read", async (t) => {
  const { queue } = context(t);
  const telegram = hangingMembershipTelegram({
    batches: [[instructionUpdate(10, 7)]],
  });
  const controller = new AbortController();
  const bridge = bridgeFor({ queue, telegram });

  const pending = bridge.pollOnce({ signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  assert.equal(await pending, 0);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.readOffset(), 0);
  assert.deepEqual(telegram.sent, []);
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
  assert.equal(telegram.sent.length, 4);
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

  assert.equal(telegram.sent.length, 2);
  assert.equal(telegram.sent[1].text.length, 4000);
  assert.match(telegram.sent[1].text, /…$/u);
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
    [
      defaultBridgeMessages.acknowledgement("fes una tasca 10"),
      messages.queueFull,
      messages.unknownResult,
    ],
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
  assert.equal(telegram.sent[2].text, defaultBridgeMessages.unknownResult);
});

test("runs the service background work only when no instruction is executing", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({ batches: [[instructionUpdate(10, 7)]] });
  // Yield to the timers of this test between polls: the bridge loop never
  // blocks, so an empty long poll would starve them.
  const pollForUpdates = telegram.getUpdates.bind(telegram);
  telegram.getUpdates = async (options) => {
    await new Promise((resolve) => setImmediate(resolve));
    return pollForUpdates(options);
  };
  const controller = new AbortController();
  const order = [];
  let instructionRunning = false;
  const bridge = bridgeFor({
    queue,
    telegram,
    async runInstruction() {
      instructionRunning = true;
      order.push("instruction");
      instructionRunning = false;
      return { outcome: "answered", report: "fet" };
    },
    async runWhenIdle() {
      assert.equal(instructionRunning, false);
      assert.equal(queue.pendingCount(), 0);
      order.push("idle");
      if (order.length === 3) {
        controller.abort();
      }
      return order.length === 2;
    },
  });

  const running = bridge.run({ signal: controller.signal });
  for (let waited = 0; waited < 100 && !order.includes("idle"); waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(order.includes("idle"), "the idle work never ran");
  controller.abort();
  await running;

  // The second idle call does nothing, so the loop returns to polling.
  assert.deepEqual(order, ["instruction", "idle", "idle"]);
});

test("reports a defect of the background work without stopping the bridge", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({ batches: [[]] });
  const controller = new AbortController();
  const events = [];
  const bridge = bridgeFor({
    queue,
    telegram,
    logger: (event) => events.push(event),
    runWhenIdle: async () => {
      controller.abort();
      throw new Error("state volume full");
    },
  });

  await bridge.run({ signal: controller.signal });

  assert.deepEqual(events, ["idle_work_failed"]);
});

function documentUpdate(updateIdentifier, threadIdentifier, overrides = {}) {
  return instructionUpdate(updateIdentifier, threadIdentifier, {
    text: undefined,
    entities: undefined,
    caption: `@${botUsername} usa aquesta imatge`,
    caption_entities: [
      { type: "mention", offset: 0, length: botUsername.length + 1 },
    ],
    document: {
      file_id: "telegram-file",
      file_unique_id: "telegram-unique-file",
      file_name: "portada.png",
      mime_type: "image/png",
      file_size: 1200000,
    },
    ...overrides,
  });
}

test("admits an image document and hands it to the execution", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({ batches: [[documentUpdate(10, 7)]] });
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

  assert.equal(executed[0].instruction, "usa aquesta imatge");
  assert.deepEqual(executed[0].attachment, {
    fileIdentifier: "telegram-file",
    fileUniqueIdentifier: "telegram-unique-file",
    fileName: "portada.png",
    mimeType: "image/png",
    fileSize: 1200000,
    origin: "message",
  });
  assert.equal(
    telegram.sent[0].text,
    defaultBridgeMessages.acknowledgement("usa aquesta imatge"),
  );
  assert.equal(queue.status(10), "done");
});

test("refuses a compressed photo without queuing it", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({
    batches: [
      [
        instructionUpdate(10, 7, {
          text: undefined,
          entities: undefined,
          caption: `@${botUsername} usa aquesta foto`,
          caption_entities: [
            { type: "mention", offset: 0, length: botUsername.length + 1 },
          ],
          photo: [
            { file_id: "small", file_unique_id: "small-unique", width: 90 },
            { file_id: "large", file_unique_id: "large-unique", width: 1280 },
          ],
        }),
      ],
    ],
  });
  let executions = 0;
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => {
      executions += 1;
      return { outcome: "answered", report: "unexpected" };
    },
  });

  assert.equal(await bridge.pollOnce(), 1);

  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.readOffset(), 11);
  assert.deepEqual(telegram.sent, [
    {
      chatIdentifier: -1001234567890,
      messageThreadIdentifier: 7,
      text: defaultBridgeMessages.attachmentPhoto,
    },
  ]);
  assert.equal(await bridge.executeNext(), null);
  assert.equal(executions, 0);
  const refusals = queue
    .traceEntries()
    .filter((entry) => entry.action === "attachment_refused");
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].update_identifier, 10);
  assert.equal(refusals[0].author_identifier, 42);
  assert.equal(refusals[0].session_key, "-1001234567890:7");
  assert.equal(refusals[0].detail, "reason=photo");
});

test("reports the refusal of an attachment to the owner of the topic", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({
    batches: [
      [
        documentUpdate(10, 7, {
          document: {
            file_id: "file",
            file_unique_id: "unique",
            file_name: "photo.gif",
            mime_type: "image/gif",
            file_size: 1024,
          },
        }),
      ],
    ],
  });
  const reports = [];
  const bridge = bridgeFor({
    queue,
    telegram,
    onServiceReport: ({ sessionKey, text, effectKey }) =>
      reports.push({ sessionKey, text, effectKey }),
  });

  assert.equal(await bridge.pollOnce(), 1);

  assert.deepEqual(reports, [
    {
      sessionKey: "-1001234567890:7",
      text: telegram.sent[0].text,
      effectKey: "attachment-refusal:10",
    },
  ]);
});

test("refuses an oversized document with the real size", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({
    batches: [
      [
        documentUpdate(10, 7, {
          document: {
            file_id: "telegram-file",
            file_unique_id: "telegram-unique-file",
            file_name: "portada.png",
            mime_type: "image/png",
            file_size: 3 * 1024 * 1024,
          },
        }),
      ],
    ],
  });
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => ({}),
  });

  assert.equal(await bridge.pollOnce(), 1);

  assert.equal(queue.pendingCount(), 0);
  assert.equal(
    telegram.sent[0].text,
    defaultBridgeMessages.attachmentTooLarge("3.0"),
  );
  const [refusal] = queue
    .traceEntries()
    .filter((entry) => entry.action === "attachment_refused");
  assert.equal(
    refusal.detail,
    "reason=declared_too_large type=png bytes=3145728",
  );
});

test("traces the declared type of an unsupported document", async (t) => {
  const { queue } = context(t);
  const telegram = telegramStub({
    batches: [
      [
        documentUpdate(10, 7, {
          document: {
            file_id: "telegram-file",
            file_unique_id: "telegram-unique-file",
            file_name: "informe.pdf",
            mime_type: "application/pdf",
            file_size: 1000,
          },
        }),
      ],
    ],
  });
  const bridge = bridgeFor({
    queue,
    telegram,
    runInstruction: async () => ({}),
  });

  assert.equal(await bridge.pollOnce(), 1);

  assert.equal(queue.pendingCount(), 0);
  assert.equal(
    telegram.sent[0].text,
    defaultBridgeMessages.attachmentUnsupported,
  );
  const [refusal] = queue
    .traceEntries()
    .filter((entry) => entry.action === "attachment_refused");
  assert.equal(
    refusal.detail,
    "reason=unsupported_document type=application/pdf",
  );
});
