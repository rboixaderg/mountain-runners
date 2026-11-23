import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { searchBrave } from "./brave-search.mjs";
import { requestBrave } from "./brave-sender.mjs";

function simulate(
  testContext,
  {
    status = 200,
    headers = ["content-type", "application/json"],
    body = Buffer.from('{"web":{"results":[]}}'),
    wire,
  } = {},
) {
  const calls = [];
  testContext.mock.method(https, "request", (options) => {
    calls.push(options);
    const request = new EventEmitter();
    const socket = new EventEmitter();
    const response = new PassThrough();
    response.statusCode = status;
    response.rawHeaders = headers;
    response.complete = true;
    request.destroy = () => {
      request.destroyed = true;
    };
    request.end = () =>
      process.nextTick(() => {
        request.emit("socket", socket);
        socket.emit("data", wire ?? body);
        if (request.destroyed) return;
        request.emit("response", response);
        response.end(body);
      });
    return request;
  });
  return calls;
}

function search() {
  return searchBrave({
    query: "public query",
    subscriptionToken: "synthetic-token",
    request: requestBrave,
  });
}

test("native sender uses a fixed TLS origin, a single-use agent and only the search headers", async (testContext) => {
  const calls = simulate(testContext);
  assert.deepEqual(await search(), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hostname, "api.search.brave.com");
  assert.equal(calls[0].port, 443);
  assert.match(calls[0].path, /^\/res\/v1\/web\/search\?/u);
  assert.equal(calls[0].agent, false);
  assert.equal(calls[0].rejectUnauthorized, true);
  assert.deepEqual(calls[0].headers, {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "X-Subscription-Token": "synthetic-token",
  });
});

test("rejects a different target before the token can leave", async (testContext) => {
  const calls = simulate(testContext);
  await assert.rejects(
    requestBrave("https://other.example/res/v1/web/search", {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      signal: new AbortController().signal,
    }),
    { message: "Brave search failed" },
  );
  assert.equal(calls.length, 0);
});

test("refuses redirects, compressed responses and duplicate security headers", async (testContext) => {
  for (const response of [
    { status: 302, headers: ["location", "https://other.example/"] },
    {
      headers: ["content-type", "application/json", "content-encoding", "gzip"],
    },
    {
      headers: [
        "content-type",
        "application/json",
        "content-type",
        "application/json",
      ],
    },
  ]) {
    const child = await testContext.test(
      JSON.stringify(response),
      async (nested) => {
        const calls = simulate(nested, response);
        await assert.rejects(search(), { message: "Brave search failed" });
        assert.equal(calls.length, 1);
      },
    );
    assert.equal(child, undefined);
  }
});

test("enforces entity and HTTP wire limits independently", async (testContext) => {
  for (const response of [
    { body: Buffer.alloc(256 * 1024 + 1) },
    { wire: Buffer.alloc(256 * 1024 + 16 * 1024 + 1) },
  ]) {
    await testContext.test("rejects oversized response", async (nested) => {
      simulate(nested, response);
      await assert.rejects(search(), { message: "Brave search failed" });
    });
  }
});
