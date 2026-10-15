import { readFileSync } from "node:fs";

const siteId = "mountainrunners.cat";

export async function queryStats(query, environment = process.env) {
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("The query must be a JSON object.");
  }
  if (query.site_id !== undefined && query.site_id !== siteId) {
    throw new Error("This skill only queries mountainrunners.cat.");
  }

  const { PLAUSIBLE_BASE_URL: baseUrl, PLAUSIBLE_API_KEY: apiKey } =
    environment;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Set PLAUSIBLE_BASE_URL and PLAUSIBLE_API_KEY before running.",
    );
  }

  let origin;
  try {
    origin = new URL(baseUrl);
  } catch {
    throw new Error("PLAUSIBLE_BASE_URL must be an HTTPS origin.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("PLAUSIBLE_BASE_URL must be an HTTPS origin.");
  }

  let response;
  try {
    response = await fetch(new URL("/api/v2/query", origin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...query, site_id: siteId }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(
      "Plausible request failed: network, TLS, redirect or timeout.",
    );
  }

  if (!response.ok) {
    const explanations = {
      400: "Check the Stats v2 query fields and metric requirements.",
      401: "Check the API key and its access to mountainrunners.cat.",
      403: "The API key does not have permission for this query.",
      429: "Rate limit reached; wait before making more queries.",
    };
    const explanation =
      explanations[response.status] ?? "Plausible query failed.";
    throw new Error(`HTTP ${response.status}: ${explanation}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Plausible returned an unreadable JSON response.");
  }
}

if (import.meta.main) {
  try {
    let query;
    try {
      query = JSON.parse(readFileSync(0, "utf8"));
    } catch {
      throw new Error("Provide a Stats v2 query as JSON on standard input.");
    }
    const result = await queryStats(query);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    // Never print the remote error body, request headers or raw network errors.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
