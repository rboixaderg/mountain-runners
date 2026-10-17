import assert from "node:assert/strict";
import test from "node:test";
import {
  hstsPresentFinding,
  indexableFinding,
  legacyRedirectFinding,
  rootLocaleRedirectFinding,
  wwwRedirectFinding,
} from "./site-contract.mjs";

const apexOrigin = "https://mountainrunners.cat";
const wwwUrl = "https://www.mountainrunners.cat/ca/";

test("indexableFinding rejects noindex on HTML and 404", () => {
  const withNoIndex = new Headers({
    "x-robots-tag": "noindex, nofollow, noarchive",
  });
  assert.match(indexableFinding("/ca/", withNoIndex), /must not send/);
  assert.match(indexableFinding("404", withNoIndex), /must not send/);
  assert.equal(indexableFinding("/ca/", new Headers()), undefined);
});

test("hstsPresentFinding requires max-age=31536000 without includeSubDomains", () => {
  const approved = new Headers({
    "strict-transport-security": "max-age=31536000",
  });
  assert.equal(hstsPresentFinding("apex", approved), undefined);

  const missing = new Headers();
  assert.match(hstsPresentFinding("apex", missing), /max-age=31536000/);

  const withSubdomains = new Headers({
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  });
  assert.match(hstsPresentFinding("apex", withSubdomains), /includeSubDomains/);
});

test("rootLocaleRedirectFinding requires a 301 or 308 to /ca/", () => {
  const rootUrl = `${apexOrigin}/`;

  for (const [status, location] of [
    [308, "/ca/"],
    [301, `${apexOrigin}/ca/`],
  ]) {
    assert.equal(
      rootLocaleRedirectFinding({ status, location, rootUrl }),
      undefined,
    );
  }

  for (const [status, location] of [
    [200, ""],
    [308, "/"],
    [308, "/ca/?source=root"],
    [308, "https://example.com/ca/"],
  ]) {
    assert.match(
      rootLocaleRedirectFinding({ status, location, rootUrl }),
      /expected a redirect/,
    );
  }
});

test("wwwRedirectFinding requires a 301 or 308 that preserves /ca/", () => {
  assert.equal(
    wwwRedirectFinding({
      status: 308,
      location: "https://mountainrunners.cat/ca/",
      apexOrigin,
      wwwUrl,
    }),
    undefined,
  );
  assert.equal(
    wwwRedirectFinding({
      status: 301,
      location: "https://mountainrunners.cat/ca/",
      apexOrigin,
      wwwUrl,
    }),
    undefined,
  );
  assert.match(
    wwwRedirectFinding({
      status: 308,
      location: "https://mountainrunners.cat/",
      apexOrigin,
      wwwUrl,
    }),
    /expected a redirect/,
  );
  assert.match(
    wwwRedirectFinding({
      status: 308,
      location: "/ca/",
      apexOrigin,
      wwwUrl,
    }),
    /expected a redirect/,
  );
});

test("legacyRedirectFinding requires a 301 or 308 to the mapped page", () => {
  const requestedUrl = `${apexOrigin}/el-club/`;

  assert.equal(
    legacyRedirectFinding({
      status: 301,
      location: "/ca/qui-som/",
      requestedUrl,
      targetPath: "/ca/qui-som/",
    }),
    undefined,
  );
  assert.equal(
    legacyRedirectFinding({
      status: 308,
      location: `${apexOrigin}/ca/qui-som/`,
      requestedUrl,
      targetPath: "/ca/qui-som/",
    }),
    undefined,
  );

  for (const [status, location] of [
    [200, ""],
    [404, ""],
    [301, "/ca/"],
    [301, "/ca/qui-som/?utm_source=legacy"],
    [301, "/ca/qui-som/#history"],
    [301, "https://example.com/ca/qui-som/"],
  ]) {
    assert.match(
      legacyRedirectFinding({
        status,
        location,
        requestedUrl,
        targetPath: "/ca/qui-som/",
      }),
      /expected a redirect/,
    );
  }
});
