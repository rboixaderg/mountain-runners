const SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_QUERY_LENGTH = 400;
const MAX_QUERY_WORDS = 50;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULTS = 5;
const TIMEOUT_MS = 10_000;
const FAILURE = "Brave search failed";

function parseResults(payload) {
  if (
    !Array.isArray(payload?.web?.results) ||
    payload.web.results.length > MAX_RESULTS
  ) {
    throw new Error(FAILURE);
  }

  return payload.web.results.map((result) => {
    if (
      typeof result?.title !== "string" ||
      !result.title.trim() ||
      result.title.length > 500 ||
      typeof result.description !== "string" ||
      result.description.length > 2_000 ||
      typeof result.url !== "string" ||
      !result.url.isWellFormed() ||
      result.url.length > 2_048
    ) {
      throw new Error(FAILURE);
    }
    const authority = /^https?:\/\/([^/?#]+)/iu.exec(result.url)?.[1];
    if (
      !authority ||
      authority.includes("@") ||
      /[\s\p{Cc}\p{Cf}\\]/u.test(result.url)
    ) {
      throw new Error(FAILURE);
    }
    const url = new URL(result.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2_048
    ) {
      throw new Error(FAILURE);
    }
    return {
      title: result.title,
      url: url.href,
      description: result.description,
    };
  });
}

// Before wiring, the caller must enforce trusted admission and review the network boundary.
// The sender must preserve raw entity encoding headers and bytes without decompression,
// enforce wire and decoded limits, and honor redirect refusal and abort. With identity
// encoding the streamed entity bound excludes HTTP framing; it is not a fetch guarantee.
export async function searchBrave(options) {
  let reader;
  let timer;
  let onAbort;
  try {
    const { query, subscriptionToken, signal, request } = options ?? {};
    if (
      typeof query !== "string" ||
      !query ||
      query !== query.trim() ||
      !query.isWellFormed() ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(query) ||
      query.length > MAX_QUERY_LENGTH ||
      query.split(/\s+/u).length > MAX_QUERY_WORDS ||
      typeof subscriptionToken !== "string" ||
      !/^[\x21-\x7e]{1,512}$/u.test(subscriptionToken) ||
      typeof request !== "function" ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    ) {
      throw new Error(FAILURE);
    }

    const controller = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    if (combinedSignal.aborted) throw new Error(FAILURE);
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const aborted = new Promise((resolve, reject) => {
      onAbort = () => {
        if (reader) void reader.cancel().catch(() => {});
        reject(new Error(FAILURE));
      };
      combinedSignal.addEventListener("abort", onAbort, { once: true });
    });

    const operation = async () => {
      const url = new URL(SEARCH_ENDPOINT);
      url.search = new URLSearchParams({
        q: query,
        count: String(MAX_RESULTS),
        text_decorations: "false",
        result_filter: "web",
      }).toString();
      const response = await request(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          "X-Subscription-Token": subscriptionToken,
        },
        redirect: "error",
        credentials: "omit",
        signal: combinedSignal,
      });
      const contentType = response.headers.get("content-type");
      const contentLength = response.headers.get("content-length");
      const contentEncoding = response.headers.get("content-encoding");
      if (
        combinedSignal.aborted ||
        !response.ok ||
        !response.body ||
        !contentType ||
        !/^application\/json(?:\s*;|$)/iu.test(contentType) ||
        (contentEncoding !== null &&
          contentEncoding.toLowerCase() !== "identity") ||
        (contentLength !== null &&
          (!/^\d+$/u.test(contentLength) ||
            !Number.isSafeInteger(Number(contentLength)) ||
            Number(contentLength) > MAX_RESPONSE_BYTES))
      ) {
        if (response.body) void response.body.cancel().catch(() => {});
        throw new Error(FAILURE);
      }
      reader = response.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          throw new Error(FAILURE);
        }
        chunks.push(value);
      }
      const json = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks, totalBytes),
      );
      return parseResults(JSON.parse(json));
    };

    try {
      return await Promise.race([operation(), aborted]);
    } finally {
      combinedSignal.removeEventListener("abort", onAbort);
    }
  } catch {
    throw new Error(FAILURE);
  } finally {
    clearTimeout(timer);
  }
}
