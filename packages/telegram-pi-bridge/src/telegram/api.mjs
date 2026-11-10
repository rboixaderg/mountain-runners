// Minimal Telegram Bot API client for the private agent.
//
// Only the four methods the bridge needs are exposed. The bot token travels in
// the request path, so errors never include the request URL or the token.
// Long polling avoids an inbound port, a domain and webhooks.

const defaultBaseUrl = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(method, description) {
    super(`Telegram ${method} failed: ${description}`);
    this.name = "TelegramApiError";
    this.method = method;
  }
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
