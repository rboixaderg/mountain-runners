import assert from "node:assert/strict";
import test from "node:test";
import {
  hstsPresentFinding,
  indexableFinding,
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
