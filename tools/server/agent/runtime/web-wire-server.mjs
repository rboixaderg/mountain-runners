import {
  maxInputBytes,
  maxRequestBytes,
  maxRequests,
  maxResponseBytes,
  maxTotalResponseBytes,
  operationTimeoutMs,
} from "./web-wire-limits.mjs";

// Dedicated FD protocol, not Pi RPC. Closing the pipe cancels the operation.
export function serveWebResearch(pipe, webResearch, signal) {
  let buffer = Buffer.alloc(0);
  let active;
  let timer;
  let closed = false;
  let requests = 0;
  let responseBytes = 0;

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    active?.abort();
    signal?.removeEventListener("abort", close);
    pipe.destroy();
  }

  function send(record) {
    if (closed) return;
    let line;
    try {
      line = `${JSON.stringify(record)}\n`;
      if (Buffer.byteLength(line) > maxResponseBytes) throw new Error();
    } catch {
      line = '{"ok":false}\n';
    }
    responseBytes += Buffer.byteLength(line);
    if (responseBytes > maxTotalResponseBytes) return close();
    pipe.write(line);
  }

  function handle(line) {
    let request;
    try {
      request = JSON.parse(line.toString("utf8"));
    } catch {
      return close();
    }
    if (
      active ||
      ++requests > maxRequests ||
      request === null ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      Object.keys(request).sort().join(",") !== "input,operation" ||
      !["search", "read"].includes(request.operation) ||
      typeof request.input !== "string" ||
      request.input.length === 0 ||
      Buffer.byteLength(request.input) > maxInputBytes
    )
      return close();

    const controller = new AbortController();
    active = controller;
    timer = setTimeout(close, operationTimeoutMs);
    Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return webResearch(request, { signal: controller.signal });
      })
      .then((result) => {
        // Undefined and non-serializable values are failures, not successes.
        if (result === undefined) throw new Error();
        send({ ok: true, result });
      })
      .catch(() => send({ ok: false }))
      .finally(() => {
        clearTimeout(timer);
        active = undefined;
      });
  }

  pipe.on("data", (chunk) => {
    if (closed) return;
    if (active) return close();
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxRequestBytes) return close();
    const separator = buffer.indexOf(10);
    if (separator === -1) return;
    const line = buffer.subarray(0, separator);
    buffer = buffer.subarray(separator + 1);
    handle(line);
    // Pipelining is forbidden, even if the first request completed instantly.
    if (buffer.length > 0) close();
  });
  pipe.on("error", close);
  pipe.on("end", close);
  pipe.on("close", close);
  signal?.addEventListener("abort", close, { once: true });
  if (signal?.aborted) close();
  return close;
}
