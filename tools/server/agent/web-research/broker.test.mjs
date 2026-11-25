import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { createWebResearch } from "./broker.mjs";

const exclusions = {
  hostnames: ["production.example"],
  networks: ["8.8.4.0/24"],
};
const config = {
  exclusions,
  subscriptionToken: "synthetic-token",
  publicQueries: ["public routes"],
  publicUrls: [],
  neverSend: ["synthetic-private"],
  dnsRecipient: "configured resolver",
};
const unavailable = { kind: "unavailable", data: null, sources: [] };
const pending = { kind: "confirmation-required", data: null, sources: [] };

function context() {
  const offers = [];
  const recorded = [];
  return {
    offers,
    recorded,
    offerDisclosure: async (request) => {
      offers.push(request);
      return true;
    },
    recordSource: async (source) => recorded.push(source),
  };
}

function network(testContext, responses) {
  const events = [];
  testContext.mock.method(Resolver.prototype, "resolve4", async (name) => {
    events.push(`dns:${name}`);
    return ["8.8.8.8"];
  });
  testContext.mock.method(Resolver.prototype, "resolve6", async (name) => {
    events.push(`dns:${name}`);
    throw Object.assign(new Error(), { code: "ENODATA" });
  });
  testContext.mock.method(net, "connect", () => {
    events.push("connect");
    const response = responses.shift();
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        callback();
        if (response)
          process.nextTick(() => {
            this.push(response);
            this.push(null);
          });
      },
    });
    socket.remoteAddress = "8.8.8.8";
    process.nextTick(() => socket.emit("connect"));
    return socket;
  });
  testContext.mock.method(tls, "connect", ({ socket }) => {
    socket.authorized = true;
    process.nextTick(() => socket.emit("secureConnect"));
    return socket;
  });
  return events;
}

function page(body, contentType = "text/html") {
  return Buffer.from(
    `HTTP/1.1 200 OK\r\nContent-Type: ${contentType}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

test("only exact public queries or a consumed matching approval reach Brave", async () => {
  const calls = [];
  const broker = createWebResearch({
    ...config,
    requestBrave: async (url) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "A",
                url: "https://example.com/",
                description: "untrusted",
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const state = context();
  const result = await broker(
    { operation: "search", input: "public routes" },
    state,
  );
  assert.deepEqual(result, {
    kind: "result",
    data: {
      trust: "untrusted",
      snippets: [
        { title: "A", url: "https://example.com/", description: "untrusted" },
      ],
    },
    sources: [{ kind: "snippet", url: "https://example.com/" }],
  });
  assert.deepEqual(state.recorded, result.sources);
  assert.deepEqual(
    await broker({ operation: "search", input: "private question" }, state),
    pending,
  );
  assert.deepEqual(state.offers[0], {
    operation: "search",
    destination: "https://api.search.brave.com",
    input: "private question",
  });
  const approvedRequest = state.offers[0];
  assert.deepEqual(
    await broker(
      { operation: "search", input: "private question changed" },
      { ...state, approvedRequest },
    ),
    pending,
  );
  assert.equal(
    (
      await broker(
        { operation: "search", input: "private question" },
        { ...state, approvedRequest },
      )
    ).kind,
    "result",
  );
  assert.deepEqual(
    await broker(
      { operation: "search", input: "private question" },
      { ...state, approvedRequest },
    ),
    pending,
  );
  assert.equal(calls.length, 2);
});

test("never discloses known secrets, including encoded and malformed-percent inputs", async () => {
  let calls = 0;
  const broker = createWebResearch({
    ...config,
    publicQueries: ["synthetic-private"],
    requestBrave: async () => {
      calls += 1;
    },
  });
  const state = context();
  for (const input of [
    "synthetic-private",
    "%ZZ%73ynthetic-private",
    "synthetic-token",
    Buffer.from("prefix synthetic-private suffix").toString("base64"),
    `https://example.com/${Buffer.from("synthetic-private").toString("base64url")}`,
    "https://example.com/?q=%2573ynthetic-private",
    "route schedule with Telegram number 101234567",
  ]) {
    const operation = input.startsWith("https:") ? "read" : "search";
    const approvedRequest = {
      operation,
      input,
      destination: "https://api.search.brave.com",
    };
    assert.deepEqual(
      await broker(
        { operation, input },
        { ...state, approvedRequest, privateIdentifiers: ["101234567"] },
      ),
      unavailable,
    );
  }
  assert.equal(calls, 0);
  assert.deepEqual(state.offers, []);
});

for (const input of [
  "chat 1001234567890",
  "chat -1001234567890",
  "https://t.me/c/1234567890/7",
  "chat-1234567890",
  "member -101234567",
]) {
  test(`never discloses a private identifier written as ${input}`, async () => {
    const broker = createWebResearch({
      ...config,
      requestBrave: async () => assert.fail("nothing may be sent"),
    });
    const state = context();
    const operation = input.startsWith("https:") ? "read" : "search";

    assert.deepEqual(
      await broker(
        { operation, input },
        {
          ...state,
          privateIdentifiers: ["-1001234567890", "101234567"],
        },
      ),
      unavailable,
    );
    assert.deepEqual(state.offers, []);
  });
}

test("checks redirects before DNS, offers exact DNS and HTTP recipients, and resumes the approved URL", async (testContext) => {
  const events = network(testContext, [
    Buffer.from(
      "HTTP/1.1 302 Found\r\nLocation: https://other.example/final?q=one\r\nContent-Length: 0\r\n\r\n",
    ),
    page(
      "<!doctype html><html><head><title>hidden</title></head><body><h1>Public &amp; useful</h1><script>do not follow</script><p>Text</p></body></html>",
    ),
  ]);
  const broker = createWebResearch({
    ...config,
    publicUrls: ["https://example.com/start"],
  });
  const state = context();
  assert.deepEqual(
    await broker(
      { operation: "read", input: "https://example.com/start" },
      state,
    ),
    pending,
  );
  assert.deepEqual(events, ["dns:example.com.", "dns:example.com.", "connect"]);
  assert.deepEqual(state.offers[0], {
    operation: "read",
    destination: "DNS: configured resolver; HTTP: https://other.example",
    input: "https://other.example/final?q=one",
  });
  const result = await broker(
    { operation: "read", input: state.offers[0].input },
    { ...state, approvedRequest: state.offers[0] },
  );
  assert.deepEqual(result, {
    kind: "result",
    data: { trust: "untrusted", text: "Public & useful Text" },
    sources: [{ kind: "page", url: "https://other.example/final?q=one" }],
  });
  assert.deepEqual(state.recorded, result.sources);
});

test("IP disclosures omit DNS and rejected or secret redirects never resolve", async (testContext) => {
  const events = network(testContext, [
    Buffer.from(
      "HTTP/1.1 302 Found\r\nLocation: https://other.example/?q=synthetic-private\r\nContent-Length: 0\r\n\r\n",
    ),
  ]);
  const broker = createWebResearch({
    ...config,
    publicUrls: ["https://example.com/"],
  });
  const state = context();
  assert.deepEqual(
    await broker({ operation: "read", input: "https://8.8.8.8/" }, state),
    pending,
  );
  assert.equal(state.offers[0].destination, "HTTP: https://8.8.8.8");
  assert.deepEqual(
    await broker({ operation: "read", input: "https://example.com/" }, state),
    unavailable,
  );
  assert.deepEqual(events, ["dns:example.com.", "dns:example.com.", "connect"]);
  assert.equal(state.offers.length, 1);
});

test("source recording failure and invalid HTML never return web content", async (testContext) => {
  network(testContext, [
    page("<script>unfinished"),
    page("hello", "text/plain"),
  ]);
  const broker = createWebResearch({
    ...config,
    publicUrls: ["https://example.com/"],
  });
  const state = context();
  assert.deepEqual(
    await broker({ operation: "read", input: "https://example.com/" }, state),
    unavailable,
  );
  assert.deepEqual(
    await broker(
      { operation: "read", input: "https://example.com/" },
      {
        ...state,
        recordSource: async () => {
          throw new Error("private details");
        },
      },
    ),
    unavailable,
  );
});
