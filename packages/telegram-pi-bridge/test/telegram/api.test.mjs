import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  TelegramApi,
  TelegramApiError,
  TelegramFileTooLargeError,
} from "../../src/telegram/api.mjs";

/** A transport that only settles when its signal aborts, like a stuck request. */
function hangingFetch() {
  return async function fetchImpl(url, init) {
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), {
        once: true,
      });
    });
  };
}

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

test("ends a request that reaches its deadline without leaking the token", async () => {
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: hangingFetch(),
    requestTimeoutMilliseconds: 100,
  });

  await assert.rejects(api.getMe(), (error) => {
    assert.equal(error instanceof TelegramApiError, true);
    assert.match(error.message, /no answer within 100 ms/u);
    assert.equal(error.message.includes("synthetic-token"), false);
    return true;
  });
});

test("ends a download that reaches its deadline", async () => {
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: hangingFetch(),
    requestTimeoutMilliseconds: 100,
  });

  await assert.rejects(
    api.downloadFile({ filePath: "documents/file_6.png", maximumBytes: 5 }),
    (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.match(error.message, /no answer within 100 ms/u);
      assert.equal(error.message.includes("synthetic-token"), false);
      return true;
    },
  );
});

test("adds the long-poll margin to the requested server wait", async () => {
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: hangingFetch(),
    longPollMarginMilliseconds: 50,
  });

  // Half a second of server wait keeps the deadline assertable under a second.
  await assert.rejects(
    api.getUpdates({ offset: 0, timeoutSeconds: 0.5 }),
    (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.match(error.message, /no answer within 550 ms/u);
      return true;
    },
  );
});

test("propagates a stop during a send as an abort", async () => {
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: hangingFetch(),
    requestTimeoutMilliseconds: 60 * 1000,
  });
  const controller = new AbortController();
  const sending = api.sendMessage({
    chatIdentifier: "-1001234567890",
    messageThreadIdentifier: 7,
    text: "Fet: PR #200",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(sending, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error instanceof TelegramApiError, false);
    return true;
  });
});

/**
 * A server that sends the headers and the first bytes of the body, then never
 * finishes. The request is stuck in the body read, not in the connection.
 */
async function withPartialBody(t, run) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"ok":');
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  t.after(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  });
  await run({ baseUrl: `http://127.0.0.1:${port}` });
}

/** A transport that reports when the response headers were received. */
function fetchReportingHeaders() {
  let reportHeaders;
  const headersReceived = new Promise((resolve) => {
    reportHeaders = resolve;
  });
  return {
    headersReceived,
    async fetchImpl(url, init) {
      const response = await fetch(url, init);
      reportHeaders();
      return response;
    },
  };
}

/** The real download stream, reporting when its reader starts pulling. */
function bodyReportingRead(body, reportBodyRead) {
  const reader = body.getReader();
  return {
    getReader() {
      return {
        read() {
          const reading = reader.read();
          reportBodyRead();
          return reading;
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
        releaseLock() {
          reader.releaseLock();
        },
      };
    },
    cancel(reason) {
      return body.cancel(reason);
    },
  };
}

/**
 * A transport that reports when the caller starts reading the body: `json()` has
 * been called, or the download reader has pulled its first chunk. The headers
 * are not enough, because the read starts after them.
 */
function fetchReportingBodyRead() {
  let reportBodyRead;
  const bodyReadStarted = new Promise((resolve) => {
    reportBodyRead = resolve;
  });
  return {
    bodyReadStarted,
    async fetchImpl(url, init) {
      const response = await fetch(url, init);
      let body;
      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        async json() {
          const reading = response.json();
          reportBodyRead();
          return reading;
        },
        get body() {
          body ??= bodyReportingRead(response.body, reportBodyRead);
          return body;
        },
      };
    },
  };
}

function assertNoTokenOrUrl(error, baseUrl) {
  assert.equal(error.message.includes("synthetic-token"), false);
  assert.equal(error.message.includes(baseUrl), false);
  return true;
}

/**
 * Await a request that must settle. A signal disconnected after the headers are
 * received leaves the body read pending, so this fails instead of hanging.
 */
async function settledWithin(request, milliseconds) {
  let timer;
  const limit = new Promise((resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`the request did not settle within ${milliseconds} ms`),
        ),
      milliseconds,
    );
  });
  try {
    return await Promise.race([request, limit]);
  } finally {
    clearTimeout(timer);
  }
}

test("ends a reply whose body never finishes", async (t) => {
  await withPartialBody(t, async ({ baseUrl }) => {
    const transport = fetchReportingHeaders();
    const api = new TelegramApi({
      botToken: "123:synthetic-token",
      baseUrl,
      fetchImpl: transport.fetchImpl,
      requestTimeoutMilliseconds: 100,
    });
    const sending = api.sendMessage({
      chatIdentifier: "-1001234567890",
      messageThreadIdentifier: 7,
      text: "Fet: PR #200",
    });

    await transport.headersReceived;
    await assert.rejects(settledWithin(sending, 900), (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.match(error.message, /no answer within 100 ms/u);
      return assertNoTokenOrUrl(error, baseUrl);
    });
  });
});

test("keeps a stop during the body read as an abort", async (t) => {
  await withPartialBody(t, async ({ baseUrl }) => {
    const transport = fetchReportingBodyRead();
    const api = new TelegramApi({
      botToken: "123:synthetic-token",
      baseUrl,
      fetchImpl: transport.fetchImpl,
      requestTimeoutMilliseconds: 60 * 1000,
    });
    const controller = new AbortController();
    const sending = api.sendMessage({
      chatIdentifier: "-1001234567890",
      messageThreadIdentifier: 7,
      text: "Fet: PR #200",
      signal: controller.signal,
    });

    // The stop lands while `response.json()` is already waiting for the rest.
    await transport.bodyReadStarted;
    controller.abort();
    await assert.rejects(settledWithin(sending, 900), (error) => {
      assert.equal(error.name, "AbortError");
      assert.equal(error instanceof TelegramApiError, false);
      return assertNoTokenOrUrl(error, baseUrl);
    });
  });
});

test("ends a download whose body never finishes", async (t) => {
  await withPartialBody(t, async ({ baseUrl }) => {
    const transport = fetchReportingHeaders();
    const api = new TelegramApi({
      botToken: "123:synthetic-token",
      baseUrl,
      fetchImpl: transport.fetchImpl,
      requestTimeoutMilliseconds: 100,
    });
    const downloading = api.downloadFile({
      filePath: "documents/file_7.png",
      maximumBytes: 2097152,
    });

    await transport.headersReceived;
    await assert.rejects(settledWithin(downloading, 900), (error) => {
      assert.equal(error instanceof TelegramApiError, true);
      assert.match(error.message, /no answer within 100 ms/u);
      return assertNoTokenOrUrl(error, baseUrl);
    });
  });
});

test("keeps a stop during a download body as an abort", async (t) => {
  await withPartialBody(t, async ({ baseUrl }) => {
    const transport = fetchReportingBodyRead();
    const api = new TelegramApi({
      botToken: "123:synthetic-token",
      baseUrl,
      fetchImpl: transport.fetchImpl,
      requestTimeoutMilliseconds: 60 * 1000,
    });
    const controller = new AbortController();
    const downloading = api.downloadFile({
      filePath: "documents/file_8.png",
      maximumBytes: 2097152,
      signal: controller.signal,
    });

    // The stop lands while the download reader is already waiting for more.
    await transport.bodyReadStarted;
    controller.abort();
    await assert.rejects(settledWithin(downloading, 900), (error) => {
      assert.equal(error.name, "AbortError");
      assert.equal(error instanceof TelegramApiError, false);
      return assertNoTokenOrUrl(error, baseUrl);
    });
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

test("refuses a download without a positive byte limit", async () => {
  let requested = false;
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: async () => {
      requested = true;
      throw new Error("unexpected request");
    },
  });

  for (const maximumBytes of [0, -1, 1.5, Number.NaN, "5"]) {
    await assert.rejects(
      api.downloadFile({ filePath: "documents/file_9.png", maximumBytes }),
      { message: /positive integer/u },
    );
  }
  assert.equal(requested, false);
});

test("refuses a stored path that is not one plain URL segment", async () => {
  let requested = false;
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: async () => {
      requested = true;
      throw new Error("unexpected request");
    },
  });

  const invalidPaths = [
    "",
    "/etc/passwd",
    "../secret.png",
    "documents/../../secret.png",
    "documents/file.png?token=synthetic",
    "documents/file.png#fragment",
    "documents/file\u0000.png",
    "documents/file\nname.png",
  ];
  for (const filePath of invalidPaths) {
    await assert.rejects(
      api.downloadFile({ filePath, maximumBytes: 10 }),
      (error) => {
        assert.equal(error instanceof TelegramApiError, true);
        assert.match(error.message, /plain relative path/u);
        assert.equal(error.message.includes("synthetic-token"), false);
        return true;
      },
      JSON.stringify(filePath),
    );
  }
  assert.equal(requested, false);
});

test("cancels the body of a failed download before reporting it", async () => {
  let cancelled = false;
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    baseUrl: "http://127.0.0.1:1",
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      body: {
        cancel: async () => {
          cancelled = true;
        },
      },
    }),
  });

  await assert.rejects(
    api.downloadFile({ filePath: "documents/file_4.png", maximumBytes: 5 }),
    /HTTP 404/u,
  );
  assert.equal(cancelled, true);
});

test("accepts a base URL with a trailing slash without doubling it", async () => {
  const requestedUrls = [];
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    baseUrl: "https://example.test/",
    fetchImpl: async (url) => {
      requestedUrls.push(url);
      return {
        status: 200,
        async json() {
          return { ok: true, result: { id: 999 } };
        },
      };
    },
  });

  await api.getMe();
  assert.deepEqual(requestedUrls, [
    "https://example.test/bot123:synthetic-token/getMe",
  ]);
});

test("refuses a long-poll wait that is not a non-negative number", async () => {
  let requested = false;
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: async () => {
      requested = true;
      throw new Error("unexpected request");
    },
  });

  for (const timeoutSeconds of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "25",
  ]) {
    await assert.rejects(api.getUpdates({ offset: 0, timeoutSeconds }), {
      message: /long-poll timeout/u,
    });
  }
  assert.equal(requested, false);
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

/** A transport that rate limits the first `limitedAttempts` requests. */
function rateLimitedApi({ retryAfter, limitedAttempts, limitedStatus = 429 }) {
  const attempts = [];
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    fetchImpl: async () => {
      attempts.push(Date.now());
      const limited = attempts.length <= limitedAttempts;
      return {
        status: limited ? limitedStatus : 200,
        async json() {
          return limited
            ? {
                ok: false,
                description: "Too Many Requests",
                parameters: { retry_after: retryAfter },
              }
            : { ok: true, result: { message_id: 60 } };
        },
      };
    },
  });
  return { api, attempts };
}

const message = {
  chatIdentifier: "-1001234567890",
  messageThreadIdentifier: 7,
  text: "Fet: PR #200",
};

test("repeats a rate-limited send once after the requested wait", async () => {
  const { api, attempts } = rateLimitedApi({
    retryAfter: 0.05,
    limitedAttempts: 1,
  });

  assert.deepEqual(await api.sendMessage(message), { message_id: 60 });
  assert.equal(attempts.length, 2);
  // Timers may fire a millisecond early against the wall clock.
  assert.equal(attempts[1] - attempts[0] >= 45, true);
});

test("fails a send that is rate limited twice", async () => {
  const { api, attempts } = rateLimitedApi({
    retryAfter: 0,
    limitedAttempts: 2,
  });

  await assert.rejects(api.sendMessage(message), /Too Many Requests/u);
  assert.equal(attempts.length, 2);
});

test("does not wait for a retry past the request deadline", async () => {
  const { api, attempts } = rateLimitedApi({
    retryAfter: 60,
    limitedAttempts: 1,
  });

  await assert.rejects(api.sendMessage(message), TelegramApiError);
  assert.equal(attempts.length, 1);
});

test("ends the retry wait when the caller stops", async () => {
  const { api, attempts } = rateLimitedApi({
    retryAfter: 20,
    limitedAttempts: 1,
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(
    api.sendMessage({ ...message, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(attempts.length, 1);
});

test("retries only a 429 that says how long to wait", async () => {
  for (const options of [
    { limitedStatus: 400, retryAfter: 0 },
    { limitedStatus: 429, retryAfter: undefined },
  ]) {
    const { api, attempts } = rateLimitedApi({
      ...options,
      limitedAttempts: 1,
    });

    await assert.rejects(api.sendMessage(message), TelegramApiError);
    assert.equal(attempts.length, 1, String(options.limitedStatus));
  }
});

test("gives the repeated send only the rest of the shared deadline", async () => {
  const hang = hangingFetch();
  let attempts = 0;
  const api = new TelegramApi({
    botToken: "123:synthetic-token",
    requestTimeoutMilliseconds: 500,
    fetchImpl: async (url, init) => {
      attempts += 1;
      if (attempts > 1) {
        return hang(url, init);
      }
      return {
        status: 429,
        async json() {
          return { ok: false, parameters: { retry_after: 0.3 } };
        },
      };
    },
  });

  await assert.rejects(api.sendMessage(message), (error) => {
    const [, milliseconds] = /no answer within (\d+) ms/u.exec(error.message);
    // Timers may fire a few milliseconds early against the wall clock.
    assert.equal(Number(milliseconds) <= 205, true, error.message);
    return true;
  });
  assert.equal(attempts, 2);
});
