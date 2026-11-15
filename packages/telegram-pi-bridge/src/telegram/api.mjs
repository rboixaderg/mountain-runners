// Minimal Telegram Bot API client for the private agent.
//
// Only the methods the bridge needs are exposed. The bot token travels in the
// request path, so errors never include the request URL or the token. Long
// polling avoids an inbound port, a domain and webhooks.

const defaultBaseUrl = "https://api.telegram.org";

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

  constructor({ botToken, baseUrl = defaultBaseUrl, fetchImpl = fetch }) {
    if (!botToken) {
      throw new Error("A bot token is required.");
    }
    this.#botToken = botToken;
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
  }

  async #call(method, body = {}, { signal } = {}) {
    let response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/bot${this.#botToken}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      throw new TelegramApiError(method, "network error");
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new TelegramApiError(method, `HTTP ${response.status}`);
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
    return this.#call(
      "getUpdates",
      {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ["message"],
      },
      { signal },
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
    if (typeof filePath !== "string" || filePath === "") {
      throw new TelegramApiError("downloadFile", "the file path is missing");
    }
    let response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/file/bot${this.#botToken}/${filePath}`,
        { method: "GET", redirect: "error", signal },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      throw new TelegramApiError("downloadFile", "network error");
    }
    if (!response.ok || response.body === null) {
      throw new TelegramApiError("downloadFile", `HTTP ${response.status}`);
    }
    try {
      return await readBoundedBody(response, maximumBytes);
    } catch (error) {
      if (error instanceof TelegramApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      throw new TelegramApiError("downloadFile", "network error");
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
