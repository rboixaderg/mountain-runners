import { BlockList, isIP } from "node:net";

const MAX_URL_BYTES = 2048;

// Conservative exclusions from the IANA special-purpose registries. IPv6 is
// additionally restricted to global unicast; transition ranges are not trusted.
const SPECIAL_NETWORKS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.31.196.0/24",
  "192.52.193.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "192.175.48.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "2620:4f:8000::/48",
  "3fff::/20",
];

function parseAddress(address) {
  if (typeof address !== "string" || address.includes("%")) {
    throw new Error("Invalid IP address");
  }
  const family = isIP(address);
  if (!family) throw new Error("Invalid IP address");
  return {
    address:
      family === 6
        ? new URL(`http://[${address}]/`).hostname.slice(1, -1)
        : address,
    family,
  };
}

function networkBlockList(networks) {
  // BlockList also matches IPv4 against IPv4-mapped IPv6 exclusions.
  const list = new BlockList();
  for (const input of networks) {
    if (typeof input !== "string") throw new Error("Invalid network");
    const parts = input.split("/");
    if (parts.length > 2) throw new Error("Invalid network");
    const address = parseAddress(parts[0]);
    const bits = address.family === 4 ? 32 : 128;
    const prefix = parts.length === 1 ? bits : Number(parts[1]);
    if (
      parts.length === 2 &&
      (!/^(0|[1-9]\d*)$/u.test(parts[1]) || prefix > bits)
    ) {
      throw new Error("Invalid network prefix");
    }
    list.addSubnet(address.address, prefix, `ipv${address.family}`);
  }
  return list;
}

function inNetworks(address, list) {
  return list.check(address.address, `ipv${address.family}`);
}

const specialNetworks = networkBlockList(SPECIAL_NETWORKS);
const globalUnicast = networkBlockList(["2000::/3"]);

function validateAddress(input, family, productionNetworks) {
  const address = parseAddress(input);
  if (
    address.family !== family ||
    (family === 6 && !inNetworks(address, globalUnicast)) ||
    inNetworks(address, specialNetworks) ||
    inNetworks(address, productionNetworks)
  ) {
    throw new Error("Non-public or excluded address");
  }
  return address;
}

function normalizedHostname(hostname) {
  if (
    typeof hostname !== "string" ||
    !hostname ||
    /[\s\p{Cc}\p{Cf}\\/@%?#:[\]]/u.test(hostname)
  ) {
    throw new Error("Invalid hostname");
  }
  const normalized = new URL(`http://${hostname}/`).hostname.replace(
    /\.$/u,
    "",
  );
  const labels = normalized.split(".");
  if (
    isIP(normalized) ||
    labels.length < 2 ||
    normalized.length > 253 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label),
    )
  ) {
    throw new Error("Invalid hostname");
  }
  return normalized;
}

function parseExclusions(exclusions) {
  if (
    !exclusions ||
    !Array.isArray(exclusions.hostnames) ||
    !exclusions.hostnames.length ||
    !Array.isArray(exclusions.networks) ||
    !exclusions.networks.length
  ) {
    throw new Error("Production hostname and network exclusions are required");
  }
  return {
    hostnames: Array.from(exclusions.hostnames, normalizedHostname),
    networks: networkBlockList(exclusions.networks),
  };
}

export function validatePublicDestinationExclusions(exclusions) {
  parseExclusions(exclusions);
}

function parseDestination(input, exclusions) {
  const production = parseExclusions(exclusions);
  if (
    typeof input !== "string" ||
    Buffer.byteLength(input) > MAX_URL_BYTES ||
    /[\s\p{Cc}\\]/u.test(input)
  ) {
    throw new Error("Invalid URL");
  }
  const authority = /^https?:\/\/([^/?#]*)/iu.exec(input)?.[1];
  if (
    !authority ||
    authority.includes("@") ||
    authority.includes("%") ||
    authority.endsWith(":") ||
    /\p{Cf}/u.test(authority)
  ) {
    throw new Error("Invalid URL authority");
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("Invalid URL scheme, credentials or port");
  }
  const hostname = url.hostname.startsWith("[")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const family = isIP(hostname);
  let normalizedHost = hostname;
  if (family) {
    validateAddress(hostname, family, production.networks);
  } else {
    normalizedHost = normalizedHostname(hostname);
    if (
      production.hostnames.some(
        (excluded) =>
          normalizedHost === excluded ||
          normalizedHost.endsWith(`.${excluded}`),
      )
    ) {
      throw new Error("Production hostname excluded");
    }
    url.hostname = normalizedHost;
  }
  url.hash = "";
  if (Buffer.byteLength(url.href) > MAX_URL_BYTES)
    throw new Error("URL too long");
  return { url: url.href, hostname: normalizedHost, family, production };
}

/** Validate before DNS; excludes non-public literal IPs immediately. The returned
 * canonical, fragment-free url is the exact URL to disclose and to request.
 * Exclusions must contain the complete deployment inventory.
 * hostnames block the name and its subdomains; networks accept IPs or CIDRs,
 * including any deployment-specific translation prefixes and production IPs.
 */
export function preparePublicDestination(input, exclusions) {
  const { url, hostname, family } = parseDestination(input, exclusions);
  return { url, hostname, family };
}

/** Revalidate the URL and every fresh DNS answer. Literal IPs require [].
 * For DNS names answers are the complete lookup result: [{ address, family }].
 * Disclose and request the returned canonical url verbatim. Pin the returned
 * address and family, verify the connected peer using
 * matchesPublicPeer before sending HTTP data, and repeat for every redirect.
 * The caller controls the HTTP method, resolver, TLS verification and transport.
 */
export function selectPublicDestination(input, answers, exclusions) {
  const destination = parseDestination(input, exclusions);
  if (
    !Array.isArray(answers) ||
    (destination.family ? answers.length !== 0 : answers.length === 0)
  ) {
    throw new Error("Invalid DNS answers");
  }
  const entries = destination.family
    ? [{ address: destination.hostname, family: destination.family }]
    : answers;
  const addresses = Array.from(entries, (entry) => {
    return validateAddress(
      entry?.address,
      entry?.family,
      destination.production.networks,
    );
  });
  return {
    url: destination.url,
    address: addresses[0].address,
    family: addresses[0].family,
  };
}

/** Compare the actual socket peer, accepting an IPv4-mapped representation of IPv4. */
export function matchesPublicPeer(selected, peerAddress) {
  try {
    const expected = parseAddress(selected.address);
    const peer = parseAddress(peerAddress);
    if (selected.family !== expected.family) return false;
    if (expected.family === 6 && peer.family !== 6) return false;
    const peerList = new BlockList();
    peerList.addAddress(expected.address, `ipv${expected.family}`);
    return peerList.check(peer.address, `ipv${peer.family}`);
  } catch {
    return false;
  }
}
