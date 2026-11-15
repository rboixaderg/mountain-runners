import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  TelegramApi,
  TelegramFileTooLargeError,
} from "../../src/telegram/api.mjs";

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

async function withFakeDownload(handler, run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    const result = handler(request.url);
    response.writeHead(result.status ?? 200, result.headers ?? {});
    response.end(result.body ?? Buffer.alloc(0));
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

test("asks for the temporary location of a stored file", async () => {
  await withFakeTelegram(
    () => ({
      payload: {
        ok: true,
        result: { file_id: "telegram-file", file_path: "documents/file_1.png" },
      },
    }),
    async ({ api, requests }) => {
      const file = await api.getFile({ fileIdentifier: "telegram-file" });

      assert.equal(file.file_path, "documents/file_1.png");
      assert.equal(requests[0].url, "/bot123:synthetic-token/getFile");
      assert.deepEqual(requests[0].body, { file_id: "telegram-file" });
    },
  );
});

test("downloads the file from the path Telegram returned", async () => {
  await withFakeDownload(
    () => ({
      headers: { "content-type": "image/png" },
      body: Buffer.from("synthetic-image"),
    }),
    async ({ api, requests }) => {
      const bytes = await api.downloadFile({
        filePath: "documents/file_1.png",
        maximumBytes: 1024,
      });

      assert.equal(bytes.toString("utf8"), "synthetic-image");
      assert.deepEqual(requests, [
        {
          method: "GET",
          url: "/file/bot123:synthetic-token/documents/file_1.png",
        },
      ]);
    },
  );
});

test("aborts a download above the byte limit with the known size", async () => {
  const cases = [
    { headers: { "content-length": "10" }, bytes: 10 },
    { headers: {}, bytes: 10 },
  ];
  for (const { headers, bytes } of cases) {
    await withFakeDownload(
      () => ({ headers, body: Buffer.alloc(10, 1) }),
      async ({ api }) => {
        await assert.rejects(
          api.downloadFile({
            filePath: "documents/file_2.png",
            maximumBytes: 5,
          }),
          (error) => {
            assert.equal(error instanceof TelegramFileTooLargeError, true);
            assert.equal(error.bytes, bytes);
            assert.match(error.message, /size limit/u);
            assert.equal(error.message.includes("synthetic-token"), false);
            return true;
          },
        );
      },
    );
  }
});

test("cancels the body of a declared download above the limit", async () => {
  let cancelled = false;
  const headers = new Headers({ "content-length": "3000000" });
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    baseUrl: "http://127.0.0.1:1",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers,
      body: {
        cancel: async () => {
          cancelled = true;
        },
      },
    }),
  });

  await assert.rejects(
    api.downloadFile({
      filePath: "documents/file_5.png",
      maximumBytes: 2097152,
    }),
    TelegramFileTooLargeError,
  );
  assert.equal(cancelled, true);
});

test("refuses a redirect without asking the other server", async () => {
  const elsewhereRequests = [];
  const elsewhere = createServer((request, response) => {
    elsewhereRequests.push(request.url);
    response.writeHead(200);
    response.end(Buffer.from("synthetic-image"));
  });
  await new Promise((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
  const { port: elsewherePort } = elsewhere.address();
  try {
    await withFakeDownload(
      () => ({
        status: 302,
        headers: {
          location: `http://127.0.0.1:${elsewherePort}/elsewhere/file_3.png`,
        },
      }),
      async ({ api }) => {
        await assert.rejects(
          api.downloadFile({
            filePath: "documents/file_3.png",
            maximumBytes: 5,
          }),
          (error) => {
            assert.match(error.message, /network error/u);
            assert.equal(error.message.includes("synthetic-token"), false);
            return true;
          },
        );
      },
    );
  } finally {
    await new Promise((resolve) => elsewhere.close(resolve));
  }
  assert.deepEqual(elsewhereRequests, []);
});

test("reports a failed download without leaking the token", async () => {
  await withFakeDownload(
    () => ({ status: 404, body: Buffer.from("not found") }),
    async ({ api }) => {
      await assert.rejects(
        api.downloadFile({ filePath: "documents/file_4.png", maximumBytes: 5 }),
        (error) => {
          assert.match(error.message, /HTTP 404/u);
          assert.equal(error.message.includes("synthetic-token"), false);
          return true;
        },
      );
    },
  );
});
