import https from "node:https";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const FAILURE = "Brave search failed";

// Only searchBrave calls this sender. It never follows redirects, decompresses,
// uses the global agent or accepts a caller-selected origin.
export function requestBrave(url, options) {
  return new Promise((resolve, reject) => {
    let request;
    let response;
    let finished = false;
    const fail = () => {
      if (finished) return;
      finished = true;
      response?.destroy();
      request?.destroy();
      reject(new Error(FAILURE));
    };
    try {
      const target = new URL(url);
      if (
        target.origin !== "https://api.search.brave.com" ||
        target.pathname !== "/res/v1/web/search" ||
        target.username ||
        target.password ||
        target.hash ||
        options.method !== "GET" ||
        options.redirect !== "error" ||
        options.credentials !== "omit" ||
        !(options.signal instanceof AbortSignal) ||
        options.signal.aborted
      )
        return fail();

      request = https.request({
        hostname: "api.search.brave.com",
        port: 443,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: options.headers,
        agent: false,
        maxHeaderSize: MAX_HEADER_BYTES,
        rejectUnauthorized: true,
        signal: options.signal,
      });
      request.on("error", fail);
      request.once("socket", (socket) => {
        let wireBytes = 0;
        socket.prependListener("data", (chunk) => {
          wireBytes += chunk.length;
          if (wireBytes > MAX_BODY_BYTES + MAX_HEADER_BYTES) fail();
        });
      });
      request.once("response", (incoming) => {
        response = incoming;
        incoming.on("error", fail);
        incoming.once("aborted", fail);
        incoming.once("close", () => {
          if (!incoming.complete) fail();
        });
        let headers;
        try {
          headers = new Headers();
          const seen = new Set();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            const name = incoming.rawHeaders[index].toLowerCase();
            if (
              ["content-type", "content-length", "content-encoding"].includes(
                name,
              ) &&
              seen.has(name)
            )
              return fail();
            seen.add(name);
            headers.append(name, incoming.rawHeaders[index + 1]);
          }
        } catch {
          return fail();
        }
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) return fail();
          chunks.push(chunk);
        });
        incoming.once("end", () => {
          if (finished) return;
          finished = true;
          resolve({
            ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
            headers,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(Buffer.concat(chunks, size));
                controller.close();
              },
            }),
          });
        });
      });
      request.end();
    } catch {
      fail();
    }
  });
}
