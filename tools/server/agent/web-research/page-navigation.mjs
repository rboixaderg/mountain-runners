import { preparePublicDestination } from "./public-destination.mjs";
import { readPublicPage } from "./public-page.mjs";

const FAILURE = "Page read failed";
const MAX_REDIRECTS = 5;
const DEADLINE_MS = 30_000;

function resolveLocation(location, base) {
  if (
    typeof location !== "string" ||
    !location ||
    Buffer.byteLength(location) > 2048 ||
    /[\s\p{Cc}\\]/u.test(location)
  ) {
    throw new Error(FAILURE);
  }
  // Keep raw authorities for the destination validator: URL would erase empty
  // credentials and other malformed authority syntax before validation.
  if (/^[a-z][a-z\d+.-]*:/iu.test(location)) return location;
  if (location.startsWith("//")) return `${new URL(base).protocol}${location}`;
  return new URL(location, base).href;
}

// authorize is trusted policy. It must settle without waiting for a human and
// obey signal. Only true permits disclosure to DNS or an IP connection.
export async function navigatePublicPage({
  url,
  exclusions,
  authorize,
  signal,
} = {}) {
  let timer;
  try {
    if (
      typeof authorize !== "function" ||
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      signal?.aborted
    ) {
      throw new Error(FAILURE);
    }
    const deadline = new AbortController();
    timer = setTimeout(() => deadline.abort(), DEADLINE_MS);
    const combined = signal
      ? AbortSignal.any([signal, deadline.signal])
      : deadline.signal;
    const visited = new Set();
    let target = url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const destination = preparePublicDestination(target, exclusions);
      if (combined.aborted || visited.has(destination.url))
        throw new Error(FAILURE);
      visited.add(destination.url);
      const approved = await authorize({
        url: destination.url,
        hostname: destination.hostname,
        signal: combined,
      });
      if (combined.aborted) throw new Error(FAILURE);
      if (approved !== true) return { kind: "blocked", url: destination.url };
      const result = await readPublicPage({
        url: destination.url,
        exclusions,
        signal: combined,
      });
      if (combined.aborted) throw new Error(FAILURE);
      if (result.kind === "text") return { ...result, url: destination.url };
      if (redirects === MAX_REDIRECTS) throw new Error(FAILURE);
      target = resolveLocation(result.location, destination.url);
    }
    throw new Error(FAILURE);
  } catch {
    throw new Error(FAILURE);
  } finally {
    clearTimeout(timer);
  }
}
