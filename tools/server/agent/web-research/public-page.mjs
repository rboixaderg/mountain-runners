import { Resolver } from "node:dns/promises";
import { readPageHop } from "./page-hop.mjs";
import {
  preparePublicDestination,
  selectPublicDestination,
} from "./public-destination.mjs";

const DNS_TIMEOUT_MS = 10_000;
const FAILURE = "Page read failed";

async function resolveAddresses(hostname, signal) {
  const resolver = new Resolver();
  let timer;
  let onAbort;
  try {
    const interrupted = new Promise((resolve, reject) => {
      onAbort = () => {
        try {
          resolver.cancel();
        } finally {
          reject(new Error(FAILURE));
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(onAbort, DNS_TIMEOUT_MS);
    });
    const name = `${hostname}.`;
    const results = await Promise.race([
      Promise.allSettled([resolver.resolve4(name), resolver.resolve6(name)]),
      interrupted,
    ]);
    const answers = [];
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        if (result.reason?.code !== "ENODATA") throw new Error(FAILURE);
      } else {
        if (!Array.isArray(result.value) || result.value.length === 0) {
          throw new Error(FAILURE);
        }
        for (const address of result.value) {
          answers.push({ address, family: index === 0 ? 4 : 6 });
        }
      }
    }
    return answers;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// The caller must admit this exact canonical URL before calling, including
// disclosure of its hostname to DNS. Redirects require separate admission.
export async function readPublicPage(options) {
  try {
    const { url, exclusions, signal } = options;
    if (
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      signal?.aborted
    ) {
      throw new Error(FAILURE);
    }
    const prepared = preparePublicDestination(url, exclusions);
    if (prepared.url !== url) throw new Error(FAILURE);
    const answers = prepared.family
      ? []
      : await resolveAddresses(prepared.hostname, signal);
    const destination = selectPublicDestination(url, answers, exclusions);
    return await readPageHop({ destination, signal });
  } catch {
    throw new Error(FAILURE);
  }
}
