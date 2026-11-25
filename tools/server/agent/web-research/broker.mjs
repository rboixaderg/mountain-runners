import { searchBrave } from "./brave-search.mjs";
import { requestBrave as nativeRequestBrave } from "./brave-sender.mjs";
import { navigatePublicPage } from "./page-navigation.mjs";
import {
  preparePublicDestination,
  validatePublicDestinationExclusions,
} from "./public-destination.mjs";

const BRAVE_DESTINATION = "https://api.search.brave.com";
const MAX_TEXT_LENGTH = 24_000;
const failure = () => ({ kind: "unavailable", data: null, sources: [] });

function containsSecret(value, secrets, privateIdentifiers = []) {
  // Telegram links and clients write an identifier without its sign, and a
  // supergroup also without its "-100" prefix: compare digits with every form.
  const privateNumbers = new Set(
    privateIdentifiers.flatMap((identifier) => [
      identifier.replace(/^-/u, ""),
      identifier.replace(/^-(?:100)?/u, ""),
    ]),
  );
  const forbidden = (text) =>
    secrets.some((secret) => text.includes(secret)) ||
    (privateNumbers.size > 0 &&
      text.match(/\d+/gu)?.some((number) => privateNumbers.has(number)));
  let decoded = value;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (forbidden(decoded)) return true;
    for (const token of decoded.matchAll(/[A-Za-z0-9+/_-]{8,}={0,2}/gu)) {
      for (let offset = 0; offset < 4; offset += 1) {
        if (
          forbidden(
            Buffer.from(token[0].slice(offset), "base64").toString("utf8"),
          )
        )
          return true;
      }
    }
    const next = new URLSearchParams(
      `value=${decoded.replaceAll("&", "%26")}`,
    ).get("value");
    if (next === decoded) return false;
    decoded = next;
  }
  return true;
}

// This is inert text extraction, not a browser or an HTML sanitization boundary.
// Incomplete tags or suppressed elements fail closed rather than exposing code.
function extractText(text, contentType) {
  if (contentType === "text/plain") return text.slice(0, MAX_TEXT_LENGTH);
  let output = "";
  let position = 0;
  const suppressed = new Set([
    "script",
    "style",
    "noscript",
    "template",
    "head",
    "svg",
    "iframe",
    "object",
  ]);
  while (position < text.length && output.length < MAX_TEXT_LENGTH) {
    const start = text.indexOf("<", position);
    if (start === -1) {
      output += text.slice(position);
      break;
    }
    output += text.slice(position, start);
    if (text.startsWith("<!--", start)) {
      const end = text.indexOf("-->", start + 4);
      if (end === -1) throw new Error("Invalid HTML");
      position = end + 3;
      continue;
    }
    const doctype = /^<!doctype\s+html\s*>/iu.exec(text.slice(start));
    if (doctype) {
      position = start + doctype[0].length;
      continue;
    }
    const tag =
      /^<\/?[a-z][a-z\d:-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/iu.exec(
        text.slice(start),
      );
    if (!tag) throw new Error("Invalid HTML");
    const name = /^<\/?([a-z][a-z\d:-]*)/iu.exec(tag[0])[1].toLowerCase();
    position = start + tag[0].length;
    if (!tag[0].startsWith("</") && suppressed.has(name)) {
      const closing = new RegExp(`</${name}\\s*>`, "iu").exec(
        text.slice(position),
      );
      if (!closing) throw new Error("Invalid HTML");
      position += closing.index + closing[0].length;
    }
    output += " ";
  }
  return output
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu, (entity) => {
      const named = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const number =
        entity[2].toLowerCase() === "x"
          ? Number.parseInt(entity.slice(3, -1), 16)
          : Number.parseInt(entity.slice(2, -1), 10);
      return number > 0 &&
        number <= 0x10ffff &&
        !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : "\ufffd";
    })
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

// The trusted caller supplies operator-proven public exact inputs, consumes the
// coordinator's one-use approval, and rechecks authorization before invoking us.
export function createWebResearch({
  exclusions,
  subscriptionToken,
  publicQueries,
  publicUrls,
  neverSend,
  dnsRecipient,
  requestBrave = nativeRequestBrave,
}) {
  if (
    !Array.isArray(publicQueries) ||
    publicQueries.some((value) => typeof value !== "string") ||
    !Array.isArray(publicUrls) ||
    !Array.isArray(neverSend) ||
    neverSend.some((value) => typeof value !== "string" || !value) ||
    typeof subscriptionToken !== "string" ||
    !subscriptionToken ||
    typeof dnsRecipient !== "string" ||
    !dnsRecipient.trim() ||
    dnsRecipient.length > 200 ||
    /[\p{Cc}\p{Cf}]/u.test(dnsRecipient)
  )
    throw new TypeError("Invalid web research configuration");
  const secrets = [...neverSend, subscriptionToken];
  if (
    containsSecret(dnsRecipient, secrets) ||
    typeof requestBrave !== "function"
  )
    throw new TypeError("Invalid web research configuration");
  validatePublicDestinationExclusions(exclusions);
  const queries = new Set(publicQueries);
  const urls = new Set(
    publicUrls.map((url) => preparePublicDestination(url, exclusions).url),
  );
  const usedApprovals = new WeakSet();

  return async function webResearch(operationRequest, context) {
    try {
      const { operation, input } = operationRequest;
      const {
        signal,
        offerDisclosure,
        approvedRequest,
        recordSource,
        privateIdentifiers,
      } = context;
      const forbidden = (value) =>
        containsSecret(value, secrets, privateIdentifiers);
      if (
        (signal !== undefined && !(signal instanceof AbortSignal)) ||
        signal?.aborted ||
        typeof input !== "string" ||
        forbidden(input) ||
        typeof recordSource !== "function" ||
        typeof offerDisclosure !== "function"
      )
        return failure();
      const admit = (request, isPublic) => {
        if (forbidden(request.input)) return false;
        if (isPublic) return true;
        if (
          approvedRequest &&
          typeof approvedRequest === "object" &&
          !usedApprovals.has(approvedRequest) &&
          approvedRequest.operation === request.operation &&
          approvedRequest.destination === request.destination &&
          approvedRequest.input === request.input
        ) {
          usedApprovals.add(approvedRequest);
          return true;
        }
        return false;
      };
      const offer = async (request) => {
        if (forbidden(request.input) || signal?.aborted) return failure();
        return (await offerDisclosure(request)) === true
          ? { kind: "confirmation-required", data: null, sources: [] }
          : failure();
      };
      if (operation === "search") {
        if (
          !input ||
          input !== input.trim() ||
          !input.isWellFormed() ||
          /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(input) ||
          input.length > 400 ||
          input.split(/\s+/u).length > 50
        )
          return failure();
        const request = { operation, destination: BRAVE_DESTINATION, input };
        if (!admit(request, queries.has(input))) return await offer(request);
        const snippets = await searchBrave({
          query: input,
          subscriptionToken,
          signal,
          request: requestBrave,
        });
        const sources = snippets.map((snippet) => ({
          kind: "snippet",
          url: snippet.url,
          ...(urls.has(snippet.url) && { publicUrl: true }),
        }));
        for (const source of sources) {
          if (signal?.aborted) return failure();
          await recordSource(source);
        }
        if (signal?.aborted) return failure();
        return {
          kind: "result",
          data: { trust: "untrusted", snippets },
          sources,
        };
      }
      if (operation === "read") {
        let blockedRequest;
        const result = await navigatePublicPage({
          url: input,
          exclusions,
          signal,
          authorize: ({ url }) => {
            const prepared = preparePublicDestination(url, exclusions);
            const origin = new URL(url).origin;
            const destination = prepared.family
              ? `HTTP: ${origin}`
              : `DNS: ${dnsRecipient}; HTTP: ${origin}`;
            const request = { operation, destination, input: url };
            if (admit(request, urls.has(url))) return true;
            blockedRequest = request;
            return false;
          },
        });
        if (result.kind === "blocked") return await offer(blockedRequest);
        const source = {
          kind: "page",
          url: result.url,
          ...(urls.has(result.url) && { publicUrl: true }),
        };
        const text = extractText(result.text, result.contentType);
        await recordSource(source);
        if (signal?.aborted) return failure();
        return {
          kind: "result",
          data: { trust: "untrusted", text },
          sources: [source],
        };
      }
      return failure();
    } catch {
      return failure();
    }
  };
}
