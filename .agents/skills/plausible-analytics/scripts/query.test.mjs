import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import { queryStats } from "./query.mjs";

const environment = {
  PLAUSIBLE_BASE_URL: "https://analytics.example.org/",
  PLAUSIBLE_API_KEY: randomUUID(),
};
const query = {
  metrics: ["pageviews"],
  date_range: ["2026-09-01", "2026-09-30"],
  dimensions: ["event:hostname", "event:page"],
  filters: [["is", "event:hostname", ["mountainrunners.cat"]]],
  pagination: { limit: 1000, offset: 1000 },
};

function blockNetwork() {
  return mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request in an offline test.");
  });
}

afterEach(() => mock.restoreAll());

test("sends a read-only Stats v2 query for Mountain Runners and preserves response metadata", async () => {
  const result = {
    results: [{ dimensions: ["mountainrunners.cat", "/ca/"], metrics: [42] }],
    meta: { total_rows: 1001 },
    query: { ...query, site_id: "mountainrunners.cat" },
  };
  const request = mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "https://analytics.example.org/api/v2/query");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(
      options.headers.Authorization,
      `Bearer ${environment.PLAUSIBLE_API_KEY}`,
    );
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {
      ...query,
      site_id: "mountainrunners.cat",
    });
    return Response.json(result);
  });

  assert.deepEqual(await queryStats(query, environment), result);
  assert.equal(request.mock.callCount(), 1);
});

test("rejects non-object queries and other sites before making a request", async () => {
  const request = blockNetwork();
  for (const invalidQuery of [null, [], "pageviews", 42]) {
    await assert.rejects(queryStats(invalidQuery, environment), /JSON object/);
  }
  await assert.rejects(
    queryStats({ ...query, site_id: "other.example.org" }, environment),
    /only queries mountainrunners.cat/,
  );
  assert.equal(request.mock.callCount(), 0);
});

test("requires both environment variables without disclosing their values", async () => {
  const request = blockNetwork();
  for (const missingName of ["PLAUSIBLE_BASE_URL", "PLAUSIBLE_API_KEY"]) {
    await assert.rejects(
      queryStats(query, { ...environment, [missingName]: "" }),
      {
        message: "Set PLAUSIBLE_BASE_URL and PLAUSIBLE_API_KEY before running.",
      },
    );
  }
  assert.equal(request.mock.callCount(), 0);
});

test("rejects insecure origins, URL credentials, paths, queries and fragments", async () => {
  const request = blockNetwork();
  for (const baseUrl of [
    "not a URL",
    "http://analytics.example.org",
    "https://operator@analytics.example.org",
    "https://analytics.example.org/api/v2/query",
    "https://analytics.example.org?site=other",
    "https://analytics.example.org/#section",
  ]) {
    await assert.rejects(
      queryStats(query, { ...environment, PLAUSIBLE_BASE_URL: baseUrl }),
      { message: "PLAUSIBLE_BASE_URL must be an HTTPS origin." },
    );
  }
  assert.equal(request.mock.callCount(), 0);
});

test("reports HTTP failures without echoing remote bodies or retrying", async () => {
  for (const [status, explanation] of [
    [400, "Check the Stats v2 query fields and metric requirements."],
    [401, "Check the API key and its access to mountainrunners.cat."],
    [403, "The API key does not have permission for this query."],
    [429, "Rate limit reached; wait before making more queries."],
    [503, "Plausible query failed."],
  ]) {
    const request = mock.method(
      globalThis,
      "fetch",
      async () => new Response(environment.PLAUSIBLE_API_KEY, { status }),
    );
    await assert.rejects(queryStats(query, environment), {
      message: `HTTP ${status}: ${explanation}`,
    });
    assert.equal(request.mock.callCount(), 1);
    request.mock.restore();
  }
});

test("hides raw network errors and reports invalid JSON responses", async () => {
  const request = mock.method(globalThis, "fetch", async () => {
    throw new Error(environment.PLAUSIBLE_API_KEY);
  });
  await assert.rejects(queryStats(query, environment), {
    message: "Plausible request failed: network, TLS, redirect or timeout.",
  });
  request.mock.mockImplementation(async () => new Response("not JSON"));
  await assert.rejects(queryStats(query, environment), {
    message: "Plausible returned an unreadable JSON response.",
  });
});

test("the CLI rejects invalid stdin and missing configuration with a nonzero exit", () => {
  for (const [input, message] of [
    ["not JSON", "Provide a Stats v2 query as JSON on standard input."],
    [
      JSON.stringify(query),
      "Set PLAUSIBLE_BASE_URL and PLAUSIBLE_API_KEY before running.",
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [new URL("./query.mjs", import.meta.url).pathname],
      { input, encoding: "utf8", env: {} },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), message);
  }
});
