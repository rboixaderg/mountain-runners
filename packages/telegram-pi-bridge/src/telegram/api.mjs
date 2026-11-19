// Minimal Telegram Bot API client for the private agent.
//
// Only the methods the bridge needs are exposed. The bot token travels in the
// request path, so errors never include the request URL or the token. Long
// polling avoids an inbound port, a domain and webhooks.

const defaultBaseUrl = "https://api.telegram.org";

// Strip the trailing slashes of the configured base URL, so every request
// joins the path with exactly one "/".
function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.at(end - 1) === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

// A stored file path comes from Telegram and is used as one URL segment: it
// never traverses, carries a query or a fragment, starts an absolute path or
// contains a control character.
function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

// A request that never answers would hold the admission loop, the CI worker or
// the download. Every call carries a client deadline that covers the connection
// and the body read, on top of the caller's stop signal.
export const defaultRequestTimeoutMilliseconds = 30 * 1000;

// getUpdates asks the server to hold the response for `timeout` seconds, so its
// deadline is that wait plus room for the connection and the body read.
export const defaultLongPollMarginMilliseconds = 15 * 1000;

export class TelegramApiError extends Error {
  constructor(method, description) {
    super(`Telegram ${method} failed: ${description}`);
    this.name = "TelegramApiError";
    this.method = method;
  }
}

/**
 * A download that reached the byte limit. The caller turns it into a refusal
 * that tells the person the real size, and `bytes` is the known count: the
 * declared length, or what was already received when no length was sent.
 */
export class TelegramFileTooLargeError extends TelegramApiError {
  constructor(bytes) {
    super("downloadFile", "response above the size limit");
    this.name = "TelegramFileTooLargeError";
    this.bytes = bytes;
  }
}

// Read one download response without allowing it to grow past the limit. The
// declared length is checked first, and the stream is bounded as well because
// the header is not guaranteed.
async function readBoundedBody(response, maximumBytes) {
  const declaredLength = Number(
    response.headers.get("content-length") ?? Number.NaN,
  );
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new TelegramFileTooLargeError(declaredLength);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        throw new TelegramFileTooLargeError(received);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export class TelegramApi {
  #botToken;
  #baseUrl;
  #fetch;
  #requestTimeoutMilliseconds;
  #longPollMarginMilliseconds;

  constructor({
    botToken,
    baseUrl = defaultBaseUrl,
    fetchImpl = fetch,
    requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
    longPollMarginMilliseconds = defaultLongPollMarginMilliseconds,
  }) {
    if (!botToken) {
      throw new Error("A bot token is required.");
    }
    this.#botToken = botToken;
    this.#baseUrl = stripTrailingSlashes(baseUrl);
    this.#fetch = fetchImpl;
    this.#requestTimeoutMilliseconds = requestTimeoutMilliseconds;
    this.#longPollMarginMilliseconds = longPollMarginMilliseconds;
  }

  /**
   * Compose the caller signal with a client deadline, so a request that never
   * answers cannot hold the admission loop, the CI worker or the download.
   */
  #boundedRequest(signal, timeoutMilliseconds) {
    const deadline = AbortSignal.timeout(timeoutMilliseconds);
    return {
      callerSignal: signal,
      deadline,
      requestSignal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      timeoutMilliseconds,
    };
  }

  /**
   * A deadline expiry is a TelegramApiError, so a slow send stays an unknown
   * delivery; the caller's stop keeps propagating as an AbortError.
   */
  #requestFailure(method, error, bounded) {
    if (error instanceof TelegramApiError) {
      return error;
    }
    if (bounded.callerSignal?.aborted) {
      return error;
    }
    if (bounded.deadline.aborted) {
      return new TelegramApiError(
        method,
        `no answer within ${bounded.timeoutMilliseconds} ms`,
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      return error;
    }
    return new TelegramApiError(method, "network error");
  }

  async #call(
    method,
    body = {},
    { signal, timeoutMilliseconds = this.#requestTimeoutMilliseconds } = {},
  ) {
    const bounded = this.#boundedRequest(signal, timeoutMilliseconds);
    let response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/bot${this.#botToken}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: bounded.requestSignal,
        },
      );
    } catch (error) {
      throw this.#requestFailure(method, error, bounded);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (!bounded.requestSignal.aborted) {
        throw new TelegramApiError(method, `HTTP ${response.status}`);
      }
      throw this.#requestFailure(method, error, bounded);
    }

    if (!payload || payload.ok !== true) {
      throw new TelegramApiError(
        method,
        typeof payload?.description === "string"
          ? payload.description
          : `HTTP ${response.status}`,
      );
    }

    return payload.result;
  }

  async getMe({ signal } = {}) {
    return this.#call("getMe", {}, { signal });
  }

  async getUpdates({ offset, timeoutSeconds, signal }) {
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
      throw new Error("The long-poll timeout must be a non-negative number.");
    }
    return this.#call(
      "getUpdates",
      {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ["message"],
      },
      {
        signal,
        timeoutMilliseconds:
          timeoutSeconds * 1000 + this.#longPollMarginMilliseconds,
      },
    );
  }

  /** The temporary location of a file Telegram already stores. */
  async getFile({ fileIdentifier, signal }) {
    return this.#call("getFile", { file_id: fileIdentifier }, { signal });
  }

  /**
   * The bytes of a file returned by getFile. Redirects are refused: the URL
   * carries the bot token and must never follow another location. Errors keep
   * the TelegramApiError style, so no message contains the token or the URL.
   */
  async downloadFile({ filePath, maximumBytes, signal }) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new Error("The download byte limit must be a positive integer.");
    }
    if (
      typeof filePath !== "string" ||
      filePath === "" ||
      filePath.startsWith("/") ||
      filePath.includes("..") ||
      filePath.includes("?") ||
      filePath.includes("#") ||
      hasControlCharacter(filePath)
    ) {
      throw new TelegramApiError(
        "downloadFile",
        "the file path is not a plain relative path",
      );
    }
    const bounded = this.#boundedRequest(
      signal,
      this.#requestTimeoutMilliseconds,
    );
    let response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/file/bot${this.#botToken}/${filePath}`,
        { method: "GET", redirect: "error", signal: bounded.requestSignal },
      );
    } catch (error) {
      throw this.#requestFailure("downloadFile", error, bounded);
    }
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      throw new TelegramApiError("downloadFile", `HTTP ${response.status}`);
    }
    try {
      return await readBoundedBody(response, maximumBytes);
    } catch (error) {
      throw this.#requestFailure("downloadFile", error, bounded);
    }
  }

  async getChatMember({ chatIdentifier, userIdentifier, signal }) {
    return this.#call(
      "getChatMember",
      { chat_id: chatIdentifier, user_id: userIdentifier },
      { signal },
    );
  }

  async sendMessage({ chatIdentifier, messageThreadIdentifier, text, signal }) {
    return this.#call(
      "sendMessage",
      {
        chat_id: chatIdentifier,
        message_thread_id: messageThreadIdentifier,
        text,
      },
      { signal },
    );
  }
}
