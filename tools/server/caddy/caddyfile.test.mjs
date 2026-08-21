import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { contentSecurityPolicy } from "./content-security-policy.mjs";

const caddyDirectory = dirname(fileURLToPath(import.meta.url));
const caddyfile = readFileSync(join(caddyDirectory, "Caddyfile"), "utf8");

test("Caddyfile CSP matches the shared policy string", () => {
  const headerLine = [...caddyfile.split("\n")].find((line) =>
    line.includes("header Content-Security-Policy"),
  );
  assert.equal(
    headerLine,
    `\theader Content-Security-Policy "${contentSecurityPolicy}"`,
  );
  assert.doesNotMatch(contentSecurityPolicy, /unsafe-eval/u);
});

test("Caddyfile redirects only the unprefixed root before serving files", () => {
  const rootMatcher = "\t@unprefixed_root path /";
  const rootRedirect = "\tredir @unprefixed_root /ca/ permanent";
  const rootMatcherIndex = caddyfile.indexOf(rootMatcher);
  const rootRedirectIndex = caddyfile.indexOf(rootRedirect);
  const fileServerIndex = caddyfile.indexOf("\tfile_server");

  assert.notEqual(rootMatcherIndex, -1);
  assert.equal(caddyfile.indexOf(rootMatcher, rootMatcherIndex + 1), -1);
  assert.equal(rootRedirectIndex, rootMatcherIndex + rootMatcher.length + 1);
  assert.ok(rootRedirectIndex < fileServerIndex);
});
