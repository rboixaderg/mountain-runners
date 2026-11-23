import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { readPublicPage } from "./public-page.mjs";

const exclusions = {
  hostnames: ["production.example"],
  networks: ["8.8.4.0/24", "2606:4700:4700::/48"],
};
const url = "https://example.com/a%20b?q=one%2Ftwo";
const failure = { message: "Page read failed" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function dnsError(code) {
  return Object.assign(new Error("synthetic private DNS details"), { code });
}

function mockDns(context, ipv4, ipv6) {
  const queries = [];
  const cancelled = [];
  context.mock.method(Resolver.prototype, "resolve4", function (name) {
    queries.push({ resolver: this, family: 4, name });
    return ipv4;
  });
  context.mock.method(Resolver.prototype, "resolve6", function (name) {
    queries.push({ resolver: this, family: 6, name });
    return ipv6;
  });
  context.mock.method(Resolver.prototype, "cancel", function () {
    cancelled.push(this);
  });
  return { queries, cancelled };
}

class MockSocket extends Duplex {
  constructor(peer, response) {
    super();
    this.remoteAddress = peer;
    this.response = response;
    this.writes = [];
  }

  _read() {}

  _write(chunk, encoding, callback) {
    this.writes.push(Buffer.from(chunk));
    callback();
    if (this.response && Buffer.concat(this.writes).includes("\r\n\r\n")) {
      const response = this.response;
      this.response = null;
      process.nextTick(() => {
        this.push(response);
        this.push(null);
      });
    }
  }
}

function mockNetwork(context, response, peer = "8.8.8.8") {
  const connections = [];
  const sockets = [];
  context.mock.method(net, "connect", (options) => {
    connections.push(options);
    const socket = new MockSocket(peer, response);
    sockets.push(socket);
    process.nextTick(() => socket.emit("connect"));
    return socket;
  });
  context.mock.method(tls, "connect", (options) => {
    options.socket.authorized = true;
    process.nextTick(() => options.socket.emit("secureConnect"));
    return options.socket;
  });
  return { connections, sockets };
}

const textResponse = Buffer.from(
  "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nOK",
);

test("waits for both absolute DNS queries and requests the exact admitted URL on a pinned socket", async (context) => {
  const ipv6 = deferred();
  const dns = mockDns(context, Promise.resolve(["8.8.8.8"]), ipv6.promise);
  const network = mockNetwork(context, textResponse);
  const pending = readPublicPage({ url, exclusions });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    dns.queries.map(({ family, name }) => ({ family, name })),
    [
      { family: 4, name: "example.com." },
      { family: 6, name: "example.com." },
    ],
  );
  assert.equal(dns.queries[0].resolver, dns.queries[1].resolver);
  assert.equal(network.connections.length, 0);
  ipv6.resolve(["2606:4700:1111::1111"]);
  assert.deepEqual(await pending, {
    kind: "text",
    contentType: "text/plain",
    text: "OK",
  });
  assert.deepEqual(network.connections, [
    { host: "8.8.8.8", family: 4, port: 443 },
  ]);
  assert.match(
    Buffer.concat(network.sockets[0].writes).toString(),
    /^GET \/a%20b\?q=one%2Ftwo HTTP\/1\.1\r\nHost: example\.com\r\n/u,
  );
  assert.equal(dns.cancelled.length, 0);
});

test("rejects unsafe and noncanonical destinations before DNS or sockets", async (context) => {
  const dns = mockDns(context, Promise.resolve([]), Promise.resolve([]));
  const network = mockNetwork(context, textResponse);
  for (const options of [
    null,
    { url: "http://127.0.0.1/", exclusions },
    { url: "https://production.example/", exclusions },
    { url: "https://example.com/", exclusions: undefined },
    { url: "https://Example.com./?secret=value#fragment", exclusions },
    { url, exclusions, signal: AbortSignal.abort() },
    { url, exclusions, signal: {} },
  ]) {
    await assert.rejects(readPublicPage(options), failure);
  }
  assert.equal(dns.queries.length, 0);
  assert.equal(network.connections.length, 0);
});

test("rejects mixed unsafe or production DNS results even after a public answer", async (context) => {
  const cases = [
    [["8.8.8.8", "127.0.0.1"], null],
    [["8.8.8.8", "8.8.4.4"], null],
    [["8.8.8.8"], ["::1"]],
    [["8.8.8.8"], ["2606:4700:4700::1111"]],
    [["8.8.8.8"], ["8.8.8.8"]],
    [["8.8.8.8"], []],
    [[], ["2606:4700:1111::1111"]],
    [null, null],
  ];
  for (const [ipv4, ipv6] of cases) {
    const dns = mockDns(
      context,
      ipv4 === null
        ? Promise.reject(dnsError("ENODATA"))
        : Promise.resolve(ipv4),
      ipv6 === null
        ? Promise.reject(dnsError("ENODATA"))
        : Promise.resolve(ipv6),
    );
    const network = mockNetwork(context, textResponse);
    await assert.rejects(readPublicPage({ url, exclusions }), failure);
    assert.equal(dns.queries.length, 2);
    assert.equal(network.connections.length, 0);
    context.mock.restoreAll();
  }
});

test("accepts ENODATA for one family only and rejects all other DNS errors without leaking them", async (context) => {
  let dns = mockDns(
    context,
    Promise.resolve(["8.8.8.8"]),
    Promise.reject(dnsError("ENODATA")),
  );
  let network = mockNetwork(context, textResponse);
  assert.equal((await readPublicPage({ url, exclusions })).text, "OK");
  assert.equal(network.connections.length, 1);
  assert.equal(dns.queries.length, 2);
  context.mock.restoreAll();

  for (const code of ["ENOTFOUND", "ETIMEOUT", "ESERVFAIL", "ECANCELLED"]) {
    dns = mockDns(
      context,
      Promise.resolve(["8.8.8.8"]),
      Promise.reject(dnsError(code)),
    );
    network = mockNetwork(context, textResponse);
    await assert.rejects(readPublicPage({ url, exclusions }), (error) => {
      assert.equal(error.message, "Page read failed");
      assert.equal("cause" in error, false);
      assert.doesNotMatch(error.stack, /private DNS details/u);
      return true;
    });
    assert.equal(dns.queries.length, 2);
    assert.equal(network.connections.length, 0);
    context.mock.restoreAll();
  }
});

test("cancels the per-operation resolver on DNS timeout or caller abort", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let dns = mockDns(context, deferred().promise, deferred().promise);
  let network = mockNetwork(context, textResponse);
  let pending = readPublicPage({ url, exclusions });
  context.mock.timers.tick(10_000);
  await assert.rejects(pending, failure);
  assert.deepEqual(dns.cancelled, [dns.queries[0].resolver]);
  assert.equal(network.connections.length, 0);
  context.mock.restoreAll();

  dns = mockDns(context, deferred().promise, deferred().promise);
  network = mockNetwork(context, textResponse);
  const controller = new AbortController();
  pending = readPublicPage({ url, exclusions, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, failure);
  assert.deepEqual(dns.cancelled, [dns.queries[0].resolver]);
  assert.equal(network.connections.length, 0);
});

test("does not resolve IP literals and keeps caller abort active during the page hop", async (context) => {
  const dns = mockDns(context, Promise.resolve([]), Promise.resolve([]));
  const network = mockNetwork(context, undefined);
  const controller = new AbortController();
  const pending = readPublicPage({
    url: "http://8.8.8.8/path?q=one",
    exclusions,
    signal: controller.signal,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(network.connections, [
    { host: "8.8.8.8", family: 4, port: 80 },
  ]);
  assert.equal(dns.queries.length, 0);
  assert.ok(network.sockets[0].writes.length);
  controller.abort();
  await assert.rejects(pending, failure);
  assert.equal(network.sockets[0].destroyed, true);
});

test("connects to a public IPv6 literal without DNS", async (context) => {
  const dns = mockDns(context, Promise.resolve([]), Promise.resolve([]));
  const network = mockNetwork(context, textResponse, "2606:4700:1111::1111");
  assert.equal(
    (
      await readPublicPage({
        url: "https://[2606:4700:1111::1111]/",
        exclusions,
      })
    ).text,
    "OK",
  );
  assert.equal(dns.queries.length, 0);
  assert.deepEqual(network.connections, [
    { host: "2606:4700:1111::1111", family: 6, port: 443 },
  ]);
});

test("returns a redirect without resolving or connecting to its target", async (context) => {
  const dns = mockDns(
    context,
    Promise.resolve(["8.8.8.8"]),
    Promise.reject(dnsError("ENODATA")),
  );
  const network = mockNetwork(
    context,
    Buffer.from(
      "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\n\r\n",
    ),
  );
  assert.deepEqual(await readPublicPage({ url, exclusions }), {
    kind: "redirect",
    location: "http://127.0.0.1/private",
  });
  assert.equal(dns.queries.length, 2);
  assert.equal(network.connections.length, 1);
});

test("uses a fresh resolver for each operation and supports an IPv6-only answer", async (context) => {
  const dns = mockDns(
    context,
    Promise.reject(dnsError("ENODATA")),
    Promise.resolve(["2606:4700:1111::1111"]),
  );
  const network = mockNetwork(context, textResponse, "2606:4700:1111::1111");
  assert.equal((await readPublicPage({ url, exclusions })).text, "OK");
  assert.equal((await readPublicPage({ url, exclusions })).text, "OK");
  assert.notEqual(dns.queries[0].resolver, dns.queries[2].resolver);
  assert.deepEqual(network.connections, [
    { host: "2606:4700:1111::1111", family: 6, port: 443 },
    { host: "2606:4700:1111::1111", family: 6, port: 443 },
  ]);
});

test("does not retry another validated address when the selected connection fails", async (context) => {
  const dns = mockDns(
    context,
    Promise.resolve(["8.8.8.8", "8.8.8.9"]),
    Promise.reject(dnsError("ENODATA")),
  );
  const network = mockNetwork(context, textResponse, "8.8.8.9");
  await assert.rejects(readPublicPage({ url, exclusions }), failure);
  assert.equal(dns.queries.length, 2);
  assert.deepEqual(network.connections, [
    { host: "8.8.8.8", family: 4, port: 443 },
  ]);
  assert.equal(network.sockets[0].writes.length, 0);
});
