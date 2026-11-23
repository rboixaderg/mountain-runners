import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { navigatePublicPage } from "./page-navigation.mjs";

const exclusions = {
  hostnames: ["production.example"],
  networks: ["8.8.4.0/24"],
};
const failure = { message: "Page read failed" };
const text = Buffer.from(
  "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nOK",
);

function redirect(location) {
  return Buffer.from(
    `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 0\r\n\r\n`,
  );
}

class MockSocket extends Duplex {
  constructor(response) {
    super();
    this.response = response;
    this.remoteAddress = "8.8.8.8";
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

function mockNetwork(context, responses = [], ipv4 = "8.8.8.8") {
  const events = [];
  const sockets = [];
  context.mock.method(Resolver.prototype, "resolve4", async (name) => {
    events.push(`dns4:${name}`);
    return [typeof ipv4 === "function" ? ipv4(name) : ipv4];
  });
  context.mock.method(Resolver.prototype, "resolve6", async (name) => {
    events.push(`dns6:${name}`);
    throw Object.assign(new Error("synthetic DNS error"), { code: "ENODATA" });
  });
  context.mock.method(net, "connect", (options) => {
    events.push(`connect:${options.host}`);
    const socket = new MockSocket(responses[sockets.length]);
    sockets.push(socket);
    process.nextTick(() => socket.emit("connect"));
    return socket;
  });
  context.mock.method(tls, "connect", ({ socket }) => {
    socket.authorized = true;
    process.nextTick(() => socket.emit("secureConnect"));
    return socket;
  });
  return { events, sockets };
}

test("admits each canonical URL and hostname before DNS and sends only minimal requests", async (context) => {
  const network = mockNetwork(context, [
    redirect("../next?x=1#part"),
    redirect("//OTHER.example/final#part"),
    text,
  ]);
  const admitted = [];
  const result = await navigatePublicPage({
    url: "https://EXAMPLE.com./dir/start#fragment",
    exclusions,
    authorize: ({ url, hostname, signal }) => {
      assert.ok(signal instanceof AbortSignal);
      admitted.push({ url, hostname });
      network.events.push(`admit:${url}`);
      return true;
    },
  });
  assert.deepEqual(result, {
    kind: "text",
    contentType: "text/plain",
    text: "OK",
    url: "https://other.example/final",
  });
  assert.deepEqual(admitted, [
    { url: "https://example.com/dir/start", hostname: "example.com" },
    { url: "https://example.com/next?x=1", hostname: "example.com" },
    { url: "https://other.example/final", hostname: "other.example" },
  ]);
  assert.deepEqual(network.events, [
    "admit:https://example.com/dir/start",
    "dns4:example.com.",
    "dns6:example.com.",
    "connect:8.8.8.8",
    "admit:https://example.com/next?x=1",
    "dns4:example.com.",
    "dns6:example.com.",
    "connect:8.8.8.8",
    "admit:https://other.example/final",
    "dns4:other.example.",
    "dns6:other.example.",
    "connect:8.8.8.8",
  ]);
  for (const socket of network.sockets) {
    const request = Buffer.concat(socket.writes).toString();
    assert.doesNotMatch(request, /cookie|authorization|referer/iu);
  }
  assert.match(
    Buffer.concat(network.sockets[1].writes).toString(),
    /^GET \/next\?x=1 HTTP\/1\.1\r\n/u,
  );
});

test("an admitted redirect cannot connect when the new DNS answer points to production", async (context) => {
  const network = mockNetwork(
    context,
    [redirect("https://alias.example/final")],
    (name) => (name === "alias.example." ? "8.8.4.4" : "8.8.8.8"),
  );
  await assert.rejects(
    navigatePublicPage({
      url: "https://example.com/first",
      exclusions,
      authorize: () => true,
    }),
    failure,
  );
  assert.ok(network.events.includes("dns4:alias.example."));
  assert.deepEqual(
    network.events.filter((event) => event.startsWith("connect:")),
    ["connect:8.8.8.8"],
  );
});

test("only explicit true admits a hostname or IP; callback failures never reach the network", async (context) => {
  const network = mockNetwork(context, [text]);
  for (const url of [
    "https://example.com/private?value=one#part",
    "http://8.8.8.8/private",
  ]) {
    for (const answer of [false, undefined, null, "true", { approved: true }]) {
      assert.deepEqual(
        await navigatePublicPage({ url, exclusions, authorize: () => answer }),
        {
          kind: "blocked",
          url: url.replace(/#.*$/u, ""),
        },
      );
    }
    await assert.rejects(
      navigatePublicPage({
        url,
        exclusions,
        authorize: () => {
          throw new Error("private callback detail");
        },
      }),
      (error) => {
        assert.equal(error.message, "Page read failed");
        assert.equal("cause" in error, false);
        assert.doesNotMatch(error.stack, /private callback detail/u);
        return true;
      },
    );
  }
  assert.deepEqual(network.events, []);
  assert.equal(network.sockets.length, 0);
});

test("waits for policy to settle before starting DNS", async (context) => {
  const network = mockNetwork(context, [text]);
  let admit;
  const pending = navigatePublicPage({
    url: "https://example.com/",
    exclusions,
    authorize: () =>
      new Promise((resolve) => {
        admit = resolve;
      }),
  });
  assert.deepEqual(network.events, []);
  admit(true);
  assert.equal((await pending).text, "OK");
  assert.deepEqual(network.events, [
    "dns4:example.com.",
    "dns6:example.com.",
    "connect:8.8.8.8",
  ]);
});

test("admits a public IP literal before connecting without DNS", async (context) => {
  const network = mockNetwork(context, [text]);
  const result = await navigatePublicPage({
    url: "http://8.8.8.8/path#fragment",
    exclusions,
    authorize: ({ url, hostname }) => {
      assert.equal(url, "http://8.8.8.8/path");
      assert.equal(hostname, "8.8.8.8");
      assert.deepEqual(network.events, []);
      return true;
    },
  });
  assert.equal(result.url, "http://8.8.8.8/path");
  assert.deepEqual(network.events, ["connect:8.8.8.8"]);
});

test("a denied redirect returns its exact target without DNS or a connection for that hop", async (context) => {
  const network = mockNetwork(context, [
    redirect("https://other.example/secret?q=value#fragment"),
  ]);
  let calls = 0;
  assert.deepEqual(
    await navigatePublicPage({
      url: "https://example.com/",
      exclusions,
      authorize: () => ++calls === 1,
    }),
    { kind: "blocked", url: "https://other.example/secret?q=value" },
  );
  assert.deepEqual(network.events, [
    "dns4:example.com.",
    "dns6:example.com.",
    "connect:8.8.8.8",
  ]);
  assert.equal(network.sockets.length, 1);
});

test("rejects excluded or unsafe initial destinations before policy, DNS or socket", async (context) => {
  const network = mockNetwork(context);
  let calls = 0;
  for (const url of [
    "https://production.example/",
    "https://sub.production.example/",
    "http://8.8.4.4/",
    "http://127.0.0.1/",
    "https://@example.com/",
  ]) {
    await assert.rejects(
      navigatePublicPage({
        url,
        exclusions,
        authorize: () => {
          calls += 1;
          return true;
        },
      }),
      failure,
    );
  }
  assert.equal(calls, 0);
  assert.deepEqual(network.events, []);
});

test("rejects unsafe and malformed redirects before approval or network for the target", async (context) => {
  for (const location of [
    "https://@other.example/",
    "//@other.example/",
    "https://other.example:/",
    "https:other.example/",
    "///other.example/",
    "https://%65xample.com/",
    "http://127.0.0.1/",
    "https://sub.production.example/",
    "http://8.8.4.4/",
    "file:///private",
    "https://other.example/with space",
    "\\\\other.example/",
  ]) {
    const network = mockNetwork(context, [redirect(location)]);
    let calls = 0;
    await assert.rejects(
      navigatePublicPage({
        url: "https://example.com/",
        exclusions,
        authorize: () => {
          calls += 1;
          return true;
        },
      }),
      failure,
      location,
    );
    assert.equal(calls, 1, location);
    assert.deepEqual(
      network.events,
      ["dns4:example.com.", "dns6:example.com.", "connect:8.8.8.8"],
      location,
    );
    context.mock.restoreAll();
  }
});

test("an admitted hostname resolving to production is rejected before connecting", async (context) => {
  const network = mockNetwork(context, [], "8.8.4.4");
  await assert.rejects(
    navigatePublicPage({
      url: "https://example.com/",
      exclusions,
      authorize: () => true,
    }),
    failure,
  );
  assert.deepEqual(network.events, ["dns4:example.com.", "dns6:example.com."]);
  assert.equal(network.sockets.length, 0);
});

test("rejects canonical redirect loops and stops after five redirects", async (context) => {
  let network = mockNetwork(context, [redirect("#fragment")]);
  let calls = 0;
  await assert.rejects(
    navigatePublicPage({
      url: "https://example.com/",
      exclusions,
      authorize: () => {
        calls += 1;
        return true;
      },
    }),
    failure,
  );
  assert.equal(calls, 1);
  assert.equal(network.sockets.length, 1);
  context.mock.restoreAll();
  network = mockNetwork(
    context,
    Array.from({ length: 6 }, (_, index) => redirect(`/step${index}`)),
  );
  calls = 0;
  await assert.rejects(
    navigatePublicPage({
      url: "https://example.com/",
      exclusions,
      authorize: () => {
        calls += 1;
        return true;
      },
    }),
    failure,
  );
  assert.equal(calls, 6);
  assert.equal(network.sockets.length, 6);
});

test("caller abort and overall deadline reach the policy and do not admit late approvals", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const network = mockNetwork(context);
  for (const abortByDeadline of [false, true]) {
    const controller = new AbortController();
    let observed;
    const pending = navigatePublicPage({
      url: "https://example.com/",
      exclusions,
      signal: controller.signal,
      authorize: ({ signal }) =>
        new Promise((resolve) => {
          observed = signal;
          signal.addEventListener("abort", () => resolve(true), { once: true });
        }),
    });
    if (abortByDeadline) context.mock.timers.tick(30_000);
    else controller.abort();
    await assert.rejects(pending, failure);
    assert.equal(observed.aborted, true);
  }
  assert.deepEqual(network.events, []);
});

test("caller abort stops the in-progress page connection", async (context) => {
  const network = mockNetwork(context);
  const controller = new AbortController();
  const pending = navigatePublicPage({
    url: "https://example.com/",
    exclusions,
    signal: controller.signal,
    authorize: () => true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(network.sockets.length, 1);
  controller.abort();
  await assert.rejects(pending, failure);
  assert.equal(network.sockets[0].destroyed, true);
});

test("the overall deadline does not restart after a redirect", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const network = mockNetwork(context, [redirect("/next")]);
  let calls = 0;
  await assert.rejects(
    navigatePublicPage({
      url: "https://example.com/",
      exclusions,
      authorize: () => {
        calls += 1;
        context.mock.timers.tick(calls === 1 ? 20_000 : 10_000);
        return true;
      },
    }),
    failure,
  );
  assert.equal(calls, 2);
  assert.equal(network.sockets.length, 1);
});
