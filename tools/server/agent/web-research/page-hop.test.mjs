import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { readPageHop } from "./page-hop.mjs";
import { selectPublicDestination } from "./public-destination.mjs";

const failure = { message: "Page read failed" };
const destination = selectPublicDestination(
  "https://example.com/path?q=one",
  [{ address: "93.184.216.34", family: 4 }],
  { hostnames: ["production.example"], networks: ["1.1.1.1"] },
);

class MockSocket extends Duplex {
  constructor(response, peer, endResponse) {
    super();
    this.response = response;
    this.remoteAddress = peer;
    this.endResponse = endResponse;
    this.writes = [];
    this.replied = false;
  }

  _read() {}

  _write(chunk, encoding, callback) {
    this.writes.push(Buffer.from(chunk));
    callback();
    if (!this.replied && Buffer.concat(this.writes).includes("\r\n\r\n")) {
      this.replied = true;
      if (this.response !== undefined) {
        process.nextTick(() => {
          for (const chunk of Array.isArray(this.response)
            ? this.response
            : [this.response]) {
            this.push(chunk);
          }
          if (this.endResponse) this.push(null);
        });
      }
    }
  }
}

function mockNetwork(
  context,
  {
    response,
    peer = destination.address,
    connect = true,
    tlsAuthorized = true,
    endResponse = true,
  } = {},
) {
  const sockets = [];
  const connections = [];
  const handshakes = [];
  context.mock.method(net, "connect", (options) => {
    connections.push(options);
    const socket = new MockSocket(response, peer, endResponse);
    sockets.push(socket);
    if (connect) process.nextTick(() => socket.emit("connect"));
    return socket;
  });
  context.mock.method(tls, "connect", (options) => {
    handshakes.push(options);
    options.socket.authorized = tlsAuthorized;
    process.nextTick(() => options.socket.emit("secureConnect"));
    return options.socket;
  });
  return { sockets, connections, handshakes };
}

function response(
  body = "Hello",
  headers = "Content-Type: text/plain; charset=utf-8",
  status = "200 OK",
) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([
    Buffer.from(
      `HTTP/1.1 ${status}\r\n${headers}\r\nContent-Length: ${data.length}\r\n\r\n`,
    ),
    data,
  ]);
}

function read(options = {}) {
  return readPageHop({
    destination,
    ...options,
  });
}

test("pins the direct connection, verifies the peer before TLS and sends a minimal GET", async (context) => {
  const network = mockNetwork(context, {
    response: response("Hola món", 'Content-Type: text/html; charset="UTF-8"'),
  });
  const result = await read();
  assert.deepEqual(result, {
    kind: "text",
    contentType: "text/html",
    text: "Hola món",
  });
  assert.deepEqual(network.connections, [
    { host: "93.184.216.34", family: 4, port: 443 },
  ]);
  assert.equal(network.handshakes.length, 1);
  assert.equal(network.handshakes[0].socket, network.sockets[0]);
  assert.equal(network.handshakes[0].host, "example.com");
  assert.equal(network.handshakes[0].servername, "example.com");
  assert.equal(network.handshakes[0].rejectUnauthorized, true);
  const sent = Buffer.concat(network.sockets[0].writes).toString();
  assert.equal(
    sent,
    "GET /path?q=one HTTP/1.1\r\nHost: example.com\r\nAccept: text/plain, text/html\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n",
  );
  assert.equal(network.sockets[0].destroyed, true);
});

test("uses HTTP without TLS and preserves IPv6 Host syntax", async (context) => {
  const network = mockNetwork(context, {
    response: response(),
    peer: "2001:4860:4860::8888",
  });
  const result = await read({
    destination: {
      url: "http://[2001:4860:4860::8888]/",
      address: "2001:4860:4860::8888",
      family: 6,
    },
  });
  assert.equal(result.text, "Hello");
  assert.equal(network.handshakes.length, 0);
  assert.match(
    Buffer.concat(network.sockets[0].writes).toString(),
    /\r\nHost: \[2001:4860:4860::8888\]\r\n/u,
  );
});

test("checks an IP-origin certificate without IP SNI", async (context) => {
  const network = mockNetwork(context, {
    response: response(),
    peer: "2001:4860:4860::8888",
  });
  await read({
    destination: {
      url: "https://[2001:4860:4860::8888]/",
      address: "2001:4860:4860::8888",
      family: 6,
    },
  });
  assert.equal(network.handshakes[0].host, "2001:4860:4860::8888");
  assert.equal(network.handshakes[0].servername, undefined);
});

test("fails before HTTP data on peer mismatch, even with a caller-provided override", async (context) => {
  const network = mockNetwork(context, {
    response: response(),
    peer: "203.0.113.1",
  });
  await assert.rejects(read({ verifyPeer: () => true }), failure);
  assert.equal(network.handshakes.length, 0);
  assert.equal(network.sockets[0].writes.length, 0);
});

test("fails before HTTP data when TLS is unauthorized", async (context) => {
  const insecure = mockNetwork(context, {
    response: response(),
    tlsAuthorized: false,
  });
  await assert.rejects(read(), failure);
  assert.equal(insecure.sockets[0].writes.length, 0);
});

test("accepts a canonically equivalent IPv4-mapped peer", async (context) => {
  const network = mockNetwork(context, {
    response: response(),
    peer: "::ffff:93.184.216.34",
  });
  assert.equal((await read()).text, "Hello");
  assert.equal(network.connections.length, 1);
});

test("returns only the redirect location without following it", async (context) => {
  const network = mockNetwork(context, {
    response: response(
      "ignored",
      "Location: http://internal.example/private",
      "302 Found",
    ),
  });
  assert.deepEqual(await read(), {
    kind: "redirect",
    location: "http://internal.example/private",
  });
  assert.equal(network.connections.length, 1);
  assert.equal(network.sockets[0].destroyed, true);
});

test("rejects status, content metadata, encoding, malformed UTF-8 and disguised binary", async (context) => {
  const cases = [
    response("secret", "Content-Type: text/plain", "401 Unauthorized"),
    response("secret", "Location: /one\r\nLocation: /two", "302 Found"),
    response("secret", "Content-Type: application/pdf"),
    response("secret", "Content-Type: text/plain; charset=iso-8859-1"),
    response("secret", "Content-Type: text/plain\r\nContent-Encoding: gzip"),
    response("secret", "Content-Type: text/plain\r\nContent-Type: text/html"),
    Buffer.from(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: gzip, chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
    ),
    Buffer.from(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
    ),
    response(Buffer.from([0xc3, 0x28])),
    response(Buffer.from([0x61, 0x00, 0x62])),
    response("%PDF-1.7\nfake"),
    response('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  ];
  for (const data of cases) {
    const network = mockNetwork(context, { response: data });
    await assert.rejects(read(), failure);
    assert.equal(network.sockets[0].destroyed, true);
    context.mock.restoreAll();
  }
});

test("accepts text beginning with MZ", async (context) => {
  mockNetwork(context, { response: response("MZ is a valid text prefix") });
  assert.equal((await read()).text, "MZ is a valid text prefix");
});

test("accepts identity-encoded chunked text", async (context) => {
  const network = mockNetwork(context, {
    response: Buffer.from(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Encoding: identity\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n",
    ),
  });
  assert.equal((await read()).text, "hello world");
  assert.equal(network.connections.length, 1);
});

test("rejects excessive chunk framing before the entity limit", async (context) => {
  const headers = Buffer.from(
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n",
  );
  const framedText = Buffer.from("1\r\na\r\n".repeat(91_000));
  const network = mockNetwork(context, {
    response: [headers, framedText],
    endResponse: false,
  });
  const controller = new AbortController();
  const pending = read({ signal: controller.signal });
  const result = pending.then(
    () => "success",
    (error) => error.message,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const destroyedBeforeAbort = network.sockets[0].destroyed;
  controller.abort();
  assert.equal(await result, "Page read failed");
  assert.equal(destroyedBeforeAbort, true);
});

test("rejects an oversized Content-Length before waiting for a body", async (context) => {
  const network = mockNetwork(context, {
    response: Buffer.from(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 524289\r\n\r\n",
    ),
    endResponse: false,
  });
  const controller = new AbortController();
  const pending = read({ signal: controller.signal });
  const result = pending.then(
    () => "success",
    (error) => error.message,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const destroyedBeforeAbort = network.sockets[0].destroyed;
  controller.abort();
  assert.equal(await result, "Page read failed");
  assert.equal(destroyedBeforeAbort, true);
});

test("limits streamed response bytes", async (context) => {
  mockNetwork(context, { response: response(Buffer.alloc(512 * 1024, 97)) });
  assert.equal((await read()).text.length, 512 * 1024);
  context.mock.restoreAll();
  const network = mockNetwork(context, {
    response: [
      Buffer.from(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n80001\r\n",
      ),
      Buffer.alloc(512 * 1024, 97),
      Buffer.from("a\r\n0\r\n\r\n"),
    ],
  });
  await assert.rejects(read(), failure);
  assert.equal(network.sockets[0].destroyed, true);
});

test("abort stops both a pending connection and a pending response", async (context) => {
  const network = mockNetwork(context, { connect: false });
  const controller = new AbortController();
  const pending = read({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, failure);
  assert.equal(network.sockets[0].destroyed, true);
  context.mock.restoreAll();
  const stalled = mockNetwork(context);
  const next = new AbortController();
  const reading = read({ signal: next.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(stalled.sockets[0].writes.length);
  next.abort();
  await assert.rejects(reading, failure);
  assert.equal(stalled.sockets[0].destroyed, true);
});

test("times out a pending connection and redacts errors", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const network = mockNetwork(context, { connect: false });
  const pending = read();
  context.mock.timers.tick(10_000);
  await assert.rejects(pending, failure);
  assert.equal(network.sockets[0].destroyed, true);
});

test("the same deadline also stops a response that never finishes", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const network = mockNetwork(context);
  const pending = read();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(network.sockets[0].writes.length);
  context.mock.timers.tick(10_000);
  await assert.rejects(pending, failure);
  assert.equal(network.sockets[0].destroyed, true);
});

test("rejects invalid input without opening a socket", async (context) => {
  const network = mockNetwork(context);
  await assert.rejects(readPageHop(null), failure);
  for (const options of [
    { destination: { ...destination, address: "example.com" } },
    { destination: { ...destination, address: "example.com", family: 0 } },
    { destination: { ...destination, family: 6 } },
    {
      destination: {
        ...destination,
        url: "https://user:pass@example.com/",
      },
    },
    { destination: { ...destination, url: "file:///etc/passwd" } },
    { destination: { ...destination, url: new URL(destination.url) } },
    { signal: AbortSignal.abort() },
    { signal: {} },
  ])
    await assert.rejects(read(options), failure);
  assert.equal(network.connections.length, 0);
});
