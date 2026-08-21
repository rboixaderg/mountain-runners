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
