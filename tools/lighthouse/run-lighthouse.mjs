#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));
const previewPort = 4323;
const baseUrl = `http://127.0.0.1:${previewPort}`;
const artifactsDir = resolve(rootDir, "artifacts/lighthouse");
const budgetsPath = resolve(rootDir, "tools/lighthouse/budgets.json");
const budgets = JSON.parse(await readFile(budgetsPath, "utf8"));
const requiredCategories = {
  performance: 0.9,
  accessibility: 1,
  "best-practices": 1,
  seo: 1,
};

function routeName(pathname) {
  if (pathname === "/ca/") return "home";
  if (pathname === "/ca/esdeveniments/") return "events";
  const match = /^\/ca\/esdeveniments\/([^/]+)\/$/u.exec(pathname);
  return match ? `event-${match[1]}` : "page";
}

function pickRepresentativeRoutes(sitemapPaths) {
  const home = sitemapPaths.find((path) => path === "/ca/");
  const hub = sitemapPaths.find((path) => path === "/ca/esdeveniments/");
  const detail = sitemapPaths.find((path) =>
    /^\/ca\/esdeveniments\/[^/]+\/$/u.test(path),
  );
  const missing = [
    home === undefined && "home",
    hub === undefined && "events hub",
    detail === undefined && "event detail",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Sitemap lacks representative route(s): ${missing.join(", ")}`,
    );
  }
  return [home, hub, detail];
}

// Failure artifacts are uploaded to a public repository, and the spec excludes
// unreviewed DOM captures from them. The full-page screenshot that Lighthouse
// embeds by default is dropped: scores and budgets do not depend on it.
function stripUnreviewedFields(lhr) {
  const report = { ...lhr };
  delete report.fullPageScreenshot;
  return report;
}

async function waitForPreview(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Preview server did not respond at ${url}`);
}

function assertScores(lhr, route, failures) {
  for (const [category, minimum] of Object.entries(requiredCategories)) {
    const score = lhr.categories[category]?.score;
    if (typeof score !== "number" || score < minimum) {
      failures.push(`${route}: ${category} score ${score} is below ${minimum}`);
    }
  }
}

// Budgets are enforced conservatively: the astro preview server serves the
// build uncompressed and every network request of a type is counted, not only
// "initial" resources. Both make the measured figures an upper bound of the
// spec's "initial, compressed" budgets, so a passing run never hides a
// regression; a future relaxation must be documented, not silent.
function assertBudgets(lhr, route, failures) {
  const items = lhr.audits["network-requests"]?.details?.items ?? [];
  const transferByType = (type) =>
    items
      .filter((item) => (item.resourceType ?? "").toLowerCase() === type)
      .reduce((sum, item) => sum + (item.transferSize ?? 0), 0);
  const totalTransfer = items.reduce(
    (sum, item) => sum + (item.transferSize ?? 0),
    0,
  );
  const largestImage = Math.max(
    0,
    ...items
      .filter((item) => (item.resourceType ?? "").toLowerCase() === "image")
      .map((item) => item.transferSize ?? 0),
  );

  const metricAudits = {
    "largest-contentful-paint": {
      budget: budgets.timings["largest-contentful-paint"],
      label: "largest-contentful-paint (ms)",
    },
    "cumulative-layout-shift": {
      budget: budgets.timings["cumulative-layout-shift"],
      label: "cumulative-layout-shift",
    },
    "total-blocking-time": {
      budget: budgets.timings["total-blocking-time"],
      label: "total-blocking-time (ms)",
    },
  };
  for (const [auditId, { budget, label }] of Object.entries(metricAudits)) {
    const value = lhr.audits[auditId]?.numericValue;
    if (typeof value !== "number" || value > budget) {
      failures.push(`${route}: ${label} ${value} exceeds ${budget}`);
    }
  }

  const resourceChecks = [
    ["script", budgets.resourceSizes.script],
    ["stylesheet", budgets.resourceSizes.stylesheet],
    ["font", budgets.resourceSizes.font],
  ];
  for (const [type, budget] of resourceChecks) {
    const kibibytes = transferByType(type) / 1024;
    if (kibibytes > budget) {
      failures.push(
        `${route}: ${type} transfer ${kibibytes.toFixed(1)} KiB exceeds ${budget} KiB`,
      );
    }
  }
  if (largestImage / 1024 > budgets.resourceSizes.image) {
    failures.push(
      `${route}: image transfer ${(largestImage / 1024).toFixed(1)} KiB exceeds ${budgets.resourceSizes.image} KiB`,
    );
  }
  const totalKibibytes = totalTransfer / 1024;
  if (totalKibibytes > budgets.totalTransfer) {
    failures.push(
      `${route}: total transfer ${totalKibibytes.toFixed(1)} KiB exceeds ${budgets.totalTransfer} KiB`,
    );
  }
}

const preview = spawn(
  "pnpm",
  [
    "--filter",
    "@mountain-runners/web",
    "exec",
    "astro",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(previewPort),
  ],
  { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"], detached: true },
);
preview.stdout.on("data", () => {});
preview.stderr.on("data", () => {});
const stopPreview = () => {
  try {
    process.kill(-preview.pid, "SIGTERM");
  } catch {
    preview.kill();
  }
};

let chrome;
let exitCode = 0;
const scoresByRoute = {};
try {
  await waitForPreview(`${baseUrl}/ca/`, 60_000);
  const sitemap = await readFile(
    resolve(rootDir, "apps/web/dist/sitemap.xml"),
    "utf8",
  );
  const sitemapPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
    (match) => new URL(match[1]).pathname,
  );
  const routes = pickRepresentativeRoutes(sitemapPaths);

  chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const flags = {
    port: chrome.port,
    logLevel: "error",
    output: "json",
    formFactor: "mobile",
    screenEmulation: {
      mobile: true,
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
    },
    onlyCategories: Object.keys(requiredCategories),
  };

  await mkdir(artifactsDir, { recursive: true });
  for (const route of routes) {
    const result = await lighthouse(`${baseUrl}${route}`, flags);
    const lhr = result.lhr;
    scoresByRoute[route] = {
      performance: lhr.categories.performance?.score,
      accessibility: lhr.categories.accessibility?.score,
      "best-practices": lhr.categories["best-practices"]?.score,
      seo: lhr.categories.seo?.score,
    };
    await writeFile(
      resolve(artifactsDir, `${routeName(route)}.report.json`),
      JSON.stringify(stripUnreviewedFields(lhr), null, 2),
    );

    const failures = [];
    assertScores(lhr, route, failures);
    assertBudgets(lhr, route, failures);
    if (failures.length > 0) {
      exitCode = 1;
      console.error(`Lighthouse failures for ${route}:`);
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
    }
  }
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await chrome?.kill();
  stopPreview();
}

const reportDir = dirname(budgetsPath);
console.log(`Budgets: ${reportDir}/budgets.json`);
console.table(scoresByRoute);
console.log(`Reports: ${artifactsDir}/`);
process.exit(exitCode);
