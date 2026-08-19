import assert from "node:assert/strict";
import test from "node:test";
import {
  hstsPresentFinding,
  indexableFinding,
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
