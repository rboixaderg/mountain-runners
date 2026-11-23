import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { matchesPublicPeer } from "./public-destination.mjs";

const MAX_BYTES = 512 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_HTTP_BYTES = MAX_BYTES + MAX_HEADER_BYTES;
const TIMEOUT_MS = 10_000;
const FAILURE = "Page read failed";
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function textBody(chunks, size) {
  const bytes = Buffer.concat(chunks, size);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const character of text) {
    const code = character.codePointAt(0);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 127 && code <= 159)
    ) {
      throw new Error(FAILURE);
    }
  }
  if (/^\s*(?:%PDF-|%!PS|\{\\rtf|<svg(?:\s|>))/iu.test(text)) {
    throw new Error(FAILURE);
  }
  return text;
}

// Destination admission, DNS validation and redirect policy belong to the caller.
// Results and redirects are untrusted.
export function readPageHop(options = {}) {
  return new Promise((resolve, reject) => {
    let destination;
    let signal;
    let socket;
    let transport;
    let request;
    let timer;
    let finished = false;
    const fail = () => finish();
    const onAbort = () => fail();

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (signal instanceof AbortSignal)
        signal.removeEventListener("abort", onAbort);
      request?.destroy();
      transport?.destroy();
      socket?.destroy();
      if (result) resolve(result);
      else reject(new Error(FAILURE));
    }

    try {
      ({ destination, signal } = options);
      const { url: urlString, address, family } = destination;
      if (
        typeof urlString !== "string" ||
        ![4, 6].includes(family) ||
        net.isIP(address) !== family ||
        (signal !== undefined && !(signal instanceof AbortSignal)) ||
        signal?.aborted
      ) {
        return fail();
      }

      const selected = { url: urlString, address, family };
      const url = new URL(urlString);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return fail();

      const hostname = url.hostname.replace(/^\[|\]$/gu, "");
      const host = url.host;
      const path = `${url.pathname}${url.search}`;
      const secure = url.protocol === "https:";
      const port = Number(url.port || (secure ? 443 : 80));
      timer = setTimeout(fail, TIMEOUT_MS);
      signal?.addEventListener("abort", onAbort, { once: true });
      socket = net.connect({ host: address, family, port });
      socket.on("error", fail);
      socket.once("close", fail);
      socket.once("connect", () => {
        try {
          if (!matchesPublicPeer(selected, socket.remoteAddress)) return fail();
          if (!secure) return send(socket);

          const options = { socket, host: hostname, rejectUnauthorized: true };
          if (!net.isIP(hostname)) options.servername = hostname;
          transport = tls.connect(options);
          transport.on("error", fail);
          transport.once("close", fail);
          transport.once("secureConnect", () => {
            if (transport.authorized !== true) return fail();
            send(transport);
          });
        } catch {
          fail();
        }
      });

      function send(connectedSocket) {
        if (finished) return;
        try {
          // A custom connection with no agent keeps this socket single-use and
          // avoids the global agent, proxy settings and another DNS resolution.
          request = http.request({
            method: "GET",
            path,
            headers: {
              Host: host,
              Accept: "text/plain, text/html",
              "Accept-Encoding": "identity",
              Connection: "close",
            },
            createConnection: () => connectedSocket,
            maxHeaderSize: MAX_HEADER_BYTES,
          });
          // Count the HTTP bytes before Node's parser removes chunk framing.
          // For TLS this is the decrypted HTTP stream, not encrypted TLS records.
          let rawBytes = 0;
          connectedSocket.prependListener("data", (chunk) => {
            rawBytes += chunk.length;
            if (rawBytes > MAX_HTTP_BYTES) fail();
          });
          request.on("error", fail);
          request.once("response", (response) => {
            if (finished) return;
            response.on("error", fail);
            response.once("aborted", fail);
            const counts = new Map();
            for (
              let index = 0;
              index < response.rawHeaders.length;
              index += 2
            ) {
              const name = response.rawHeaders[index].toLowerCase();
              counts.set(name, (counts.get(name) || 0) + 1);
            }
            if (
              ["location", "content-type", "content-encoding"].some(
                (name) => counts.get(name) > 1,
              )
            ) {
              return fail();
            }
            if (REDIRECTS.has(response.statusCode)) {
              const location = response.headers.location;
              if (
                typeof location !== "string" ||
                !location ||
                location.length > 2048
              )
                return fail();
              return finish({ kind: "redirect", location });
            }
            const contentType = response.headers["content-type"];
            const encoding = response.headers["content-encoding"];
            const transferEncoding = response.headers["transfer-encoding"];
            const contentLength = response.headers["content-length"];
            if (
              response.statusCode < 200 ||
              response.statusCode >= 300 ||
              typeof contentType !== "string" ||
              !/^\s*text\/(?:plain|html)\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*)?$/iu.test(
                contentType,
              ) ||
              (transferEncoding !== undefined &&
                transferEncoding.trim().toLowerCase() !== "chunked") ||
              (contentLength !== undefined &&
                Number(contentLength) > MAX_BYTES) ||
              (encoding !== undefined &&
                encoding.trim().toLowerCase() !== "identity")
            )
              return fail();

            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
              if (finished) return;
              size += chunk.length;
              if (size > MAX_BYTES) return fail();
              chunks.push(chunk);
            });
            response.once("end", () => {
              try {
                finish({
                  kind: "text",
                  contentType: contentType.split(";")[0].trim().toLowerCase(),
                  text: textBody(chunks, size),
                });
              } catch {
                fail();
              }
            });
          });
          request.end();
        } catch {
          fail();
        }
      }
    } catch {
      fail();
    }
  });
}
