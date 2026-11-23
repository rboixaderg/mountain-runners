import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesPublicPeer,
  preparePublicDestination,
  selectPublicDestination,
} from "./public-destination.mjs";

const exclusions = {
  hostnames: ["Production.Example."],
  networks: ["8.8.4.0/24", "2606:4700:4700::/48"],
};
const publicAnswers = [
  { address: "8.8.8.8", family: 4 },
  { address: "2606:4700:1111::1111", family: 6 },
];

test("normalizes a public URL and selects the first of all-public DNS answers", () => {
  const url = "HTTPS://Example.COM.:443/a/../page?q=1#fragment";
  assert.deepEqual(preparePublicDestination(url, exclusions), {
    url: "https://example.com/page?q=1",
    hostname: "example.com",
    family: 0,
  });
  assert.deepEqual(selectPublicDestination(url, publicAnswers, exclusions), {
    url: "https://example.com/page?q=1",
    address: "8.8.8.8",
    family: 4,
  });
});

test("normalizes IP literals and never accepts DNS answers for them", () => {
  assert.deepEqual(preparePublicDestination("http://0x08080808/", exclusions), {
    url: "http://8.8.8.8/",
    hostname: "8.8.8.8",
    family: 4,
  });
  assert.deepEqual(
    selectPublicDestination("http://0x08080808/", [], exclusions),
    {
      url: "http://8.8.8.8/",
      address: "8.8.8.8",
      family: 4,
    },
  );
  assert.deepEqual(
    selectPublicDestination(
      "https://[2606:4700:1111:0:0:0:0:1111]/",
      [],
      exclusions,
    ),
    {
      url: "https://[2606:4700:1111::1111]/",
      address: "2606:4700:1111::1111",
      family: 6,
    },
  );
  assert.throws(() =>
    selectPublicDestination("http://8.8.8.8/", publicAnswers, exclusions),
  );
});

test("rejects malformed, ambiguous or non-HTTP destinations before DNS", () => {
  for (const url of [
    "ftp://example.com/",
    "https:example.com",
    "//example.com/",
    "http://example.com:8080/",
    "https://example.com:80/",
    "http://example.com:/",
    "http://@example.com/",
    "http://name@example.com/",
    "http://%65xample.com/",
    "http://example.com\\@other.example/",
    "http://example.com\n.evil/",
    "http://ex\u200bample.com/",
    "http://example.com\ufeff/",
    "http://localhost/",
    "http://example..com/",
    "http://-example.com/",
    `https://example.com/${"a".repeat(2048)}`,
  ]) {
    assert.throws(() => preparePublicDestination(url, exclusions), url);
  }
});

test("rejects malformed URLs without exposing the supplied input in the error", () => {
  assert.throws(
    () =>
      preparePublicDestination(
        "https://[invalid/?marker=private-payload",
        exclusions,
      ),
    (error) => {
      assert.equal(error.message, "Invalid URL");
      assert.equal("input" in error, false);
      assert.equal("cause" in error, false);
      assert.doesNotMatch(error.stack, /private-payload/u);
      return true;
    },
  );
});

test("requires a valid deployment production inventory and blocks normalized names and subdomains", () => {
  for (const invalid of [
    undefined,
    {},
    { hostnames: [], networks: ["8.8.8.8"] },
    { hostnames: ["example.com"], networks: [] },
    { hostnames: ["bad/name"], networks: ["8.8.8.8"] },
    { hostnames: ["production\u200b.example"], networks: ["8.8.8.8"] },
    { hostnames: ["example.com"], networks: ["8.8.8.8/33"] },
    { hostnames: ["example.com"], networks: ["8.8.8.8/"] },
  ]) {
    assert.throws(() =>
      preparePublicDestination("https://example.com/", invalid),
    );
  }
  for (const url of [
    "https://PRODUCTION.EXAMPLE./",
    "http://www.production.example/",
  ]) {
    assert.throws(() => preparePublicDestination(url, exclusions), url);
  }
  assert.equal(
    preparePublicDestination("https://notproduction.example/", exclusions)
      .hostname,
    "notproduction.example",
  );
});

test("rejects private, reserved, special and transition addresses for both families", () => {
  const forbidden = [
    "0.1.2.3",
    "10.1.2.3",
    "100.64.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.0.0.9",
    "192.0.2.1",
    "192.31.196.1",
    "192.52.193.1",
    "192.88.99.1",
    "192.168.1.1",
    "192.175.48.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "64:ff9b:1::1",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "2002:808:808::1",
    "2620:4f:8000::1",
    "3fff::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ];
  for (const address of forbidden) {
    const family = address.includes(":") ? 6 : 4;
    assert.throws(
      () =>
        selectPublicDestination(
          "https://example.com/",
          [{ address, family }],
          exclusions,
        ),
      address,
    );
    const host = family === 6 ? `[${address}]` : address;
    assert.throws(
      () => preparePublicDestination(`https://${host}/`, exclusions),
      address,
    );
    assert.throws(
      () => selectPublicDestination(`https://${host}/`, [], exclusions),
      address,
    );
  }
});

test("rejects every mixed or malformed answer, including production subnets", () => {
  for (const answer of [
    { address: "10.0.0.1", family: 4 },
    { address: "::ffff:8.8.8.8", family: 6 },
    { address: "8.8.4.4", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "8.8.8.8", family: 6 },
    { address: "fe80::1%en0", family: 6 },
    { address: "not-an-address", family: 4 },
    null,
  ]) {
    assert.throws(() =>
      selectPublicDestination(
        "https://example.com/",
        [...publicAnswers, answer],
        exclusions,
      ),
    );
  }
  assert.throws(() =>
    selectPublicDestination("https://example.com/", [], exclusions),
  );
  const sparseAnswers = [publicAnswers[0]];
  sparseAnswers.length = 2;
  assert.throws(() =>
    selectPublicDestination("https://example.com/", sparseAnswers, exclusions),
  );
  assert.throws(() =>
    selectPublicDestination("http://8.8.4.4/", [], exclusions),
  );
  assert.throws(() => preparePublicDestination("http://8.8.4.4/", exclusions));
  assert.throws(() =>
    preparePublicDestination("http://[2606:4700:4700::1111]/", exclusions),
  );
  assert.throws(() =>
    selectPublicDestination("http://[2606:4700:4700::1111]/", [], exclusions),
  );
});

test("returns the exact canonical request URL for disclosure and connection", () => {
  const input = "HTTPS://EXAMPLE.COM.:443/a/../caf\u00e9?x=a%2Fb&empty=#hidden";
  const canonical = "https://example.com/caf%C3%A9?x=a%2Fb&empty=";
  assert.equal(preparePublicDestination(input, exclusions).url, canonical);
  assert.equal(
    selectPublicDestination(input, publicAnswers, exclusions).url,
    canonical,
  );
  assert.equal(new URL(canonical).href, canonical);
  const pathFormatCharacter = "https://example.com/a\u200bb?x=1#fragment";
  assert.equal(
    preparePublicDestination(pathFormatCharacter, exclusions).url,
    "https://example.com/a%E2%80%8Bb?x=1",
  );
  assert.equal(
    selectPublicDestination(pathFormatCharacter, publicAnswers, exclusions).url,
    "https://example.com/a%E2%80%8Bb?x=1",
  );
});

test("applies exact and subnet exclusions at both family boundaries", () => {
  const localExclusions = {
    hostnames: ["production.example"],
    networks: ["8.8.4.4", "2606:4700:4700::/48"],
  };
  assert.throws(() =>
    preparePublicDestination("http://8.8.4.4/", localExclusions),
  );
  assert.equal(
    preparePublicDestination("http://8.8.4.5/", localExclusions).family,
    4,
  );
  assert.throws(() =>
    preparePublicDestination(
      "http://[2606:4700:4700:ffff::1]/",
      localExclusions,
    ),
  );
  assert.equal(
    preparePublicDestination("http://[2606:4700:4701::1]/", localExclusions)
      .family,
    6,
  );
  assert.throws(() =>
    preparePublicDestination("http://8.8.8.8/", {
      hostnames: ["production.example"],
      networks: ["0.0.0.0/0"],
    }),
  );
  assert.throws(() =>
    preparePublicDestination("http://[2606:4700:1111::1111]/", {
      hostnames: ["production.example"],
      networks: ["::/0"],
    }),
  );
  assert.throws(() =>
    preparePublicDestination("http://8.8.8.8/", {
      hostnames: ["production.example"],
      networks: ["::/0"],
    }),
  );
  assert.equal(
    preparePublicDestination("http://[2606:4700:1111::1111]/", {
      hostnames: ["production.example"],
      networks: ["0.0.0.0/0"],
    }).family,
    6,
  );
  assert.throws(() =>
    preparePublicDestination("http://8.8.4.5/", {
      hostnames: ["production.example"],
      networks: ["8.8.4.8/24"],
    }),
  );
});

test("mapped IPv6 production exclusions also reject equivalent IPv4 destinations", () => {
  for (const network of [
    "::ffff:8.8.4.4",
    "::ffff:8.8.4.4/128",
    "::ffff:808:400/120",
    "::ffff:808:0/112",
  ]) {
    const mappedExclusions = {
      hostnames: ["production.example"],
      networks: [network],
    };
    assert.throws(
      () => preparePublicDestination("http://8.8.4.4/", mappedExclusions),
      network,
    );
    assert.throws(
      () => selectPublicDestination("http://8.8.4.4/", [], mappedExclusions),
      network,
    );
    assert.throws(
      () =>
        selectPublicDestination(
          "https://example.com/",
          [{ address: "8.8.4.4", family: 4 }],
          mappedExclusions,
        ),
      network,
    );
    assert.equal(
      preparePublicDestination("http://8.9.4.4/", mappedExclusions).family,
      4,
    );
  }
});

test("requires fresh validation when DNS changes or a redirect changes the destination", () => {
  assert.equal(
    selectPublicDestination("https://example.com/", publicAnswers, exclusions)
      .address,
    "8.8.8.8",
  );
  assert.throws(() =>
    selectPublicDestination(
      "https://example.com/",
      [{ address: "127.0.0.1", family: 4 }],
      exclusions,
    ),
  );
  assert.throws(() =>
    selectPublicDestination(
      "https://production.example/",
      publicAnswers,
      exclusions,
    ),
  );
  assert.throws(() =>
    selectPublicDestination("https://[::1]/", [], exclusions),
  );
});

test("compares the effective peer by address value, including mapped IPv4", () => {
  const ipv4 = selectPublicDestination("http://8.8.8.8/", [], exclusions);
  const ipv6 = selectPublicDestination(
    "http://[2606:4700:1111::1111]/",
    [],
    exclusions,
  );
  assert.equal(matchesPublicPeer(ipv4, "8.8.8.8"), true);
  assert.equal(matchesPublicPeer(ipv4, "::ffff:8.8.8.8"), true);
  assert.equal(matchesPublicPeer(ipv4, "::FFFF:808:808"), true);
  assert.equal(matchesPublicPeer(ipv4, "::ffff:8.8.4.4"), false);
  assert.equal(matchesPublicPeer(ipv4, "::808:808"), false);
  assert.equal(matchesPublicPeer(ipv6, "8.8.8.8"), false);
  assert.equal(matchesPublicPeer(ipv6, "2606:4700:1111:0000:0:0:0:1111"), true);
  assert.equal(matchesPublicPeer(ipv6, "2606:4700:1111::1112"), false);
  assert.equal(matchesPublicPeer(ipv6, "2606:4700:1111::1111%en0"), false);
  assert.equal(matchesPublicPeer(ipv6, undefined), false);
});
