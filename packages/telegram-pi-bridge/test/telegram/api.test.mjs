import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { TelegramApi } from "../../src/telegram/api.mjs";

async function withFakeTelegram(handler, run) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body =
      chunks.length > 0
        ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
        : null;
    requests.push({ url: request.url, body });
    const result = handler(request.url, body);
    response.writeHead(result.status ?? 200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(result.payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run({
      api: new TelegramApi({
        botToken: "123:synthetic-token",
        baseUrl: `http://127.0.0.1:${port}`,
      }),
      requests,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("requests the next updates with long polling and message updates only", async () => {
  await withFakeTelegram(
    () => ({ payload: { ok: true, result: [] } }),
    async ({ api, requests }) => {
      const updates = await api.getUpdates({ offset: 77, timeoutSeconds: 25 });

      assert.deepEqual(updates, []);
      assert.equal(requests[0].url, "/bot123:synthetic-token/getUpdates");
      assert.deepEqual(requests[0].body, {
        offset: 77,
        timeout: 25,
        allowed_updates: ["message"],
      });
    },
  );
});

test("returns the membership status for the configured group and author", async () => {
  await withFakeTelegram(
    () => ({ payload: { ok: true, result: { status: "member" } } }),
    async ({ api, requests }) => {
      const member = await api.getChatMember({
        chatIdentifier: "-1001234567890",
        userIdentifier: 42,
      });

      assert.equal(member.status, "member");
      assert.equal(requests[0].url, "/bot123:synthetic-token/getChatMember");
      assert.deepEqual(requests[0].body, {
        chat_id: "-1001234567890",
        user_id: 42,
      });
    },
  );
});

test("sends the answer to the originating forum topic", async () => {
  await withFakeTelegram(
    () => ({ payload: { ok: true, result: { message_id: 60 } } }),
    async ({ api, requests }) => {
      await api.sendMessage({
        chatIdentifier: "-1001234567890",
        messageThreadIdentifier: 7,
        text: "Fet: PR #200",
      });

      assert.deepEqual(requests[0].body, {
        chat_id: "-1001234567890",
        message_thread_id: 7,
        text: "Fet: PR #200",
      });
    },
  );
});

test("reports an API failure without leaking the bot token", async () => {
  await withFakeTelegram(
    () => ({
      status: 401,
      payload: { ok: false, description: "Unauthorized" },
    }),
    async ({ api }) => {
      await assert.rejects(api.getMe(), (error) => {
        assert.match(error.message, /Unauthorized/u);
        assert.equal(error.message.includes("synthetic-token"), false);
        return true;
      });
    },
  );
});

test("reports an unreachable API without leaking the bot token", async () => {
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    baseUrl: "http://127.0.0.1:1",
  });

  await assert.rejects(api.getMe(), (error) => {
    assert.match(error.message, /network error/u);
    assert.equal(error.message.includes("synthetic-token"), false);
    return true;
  });
});
