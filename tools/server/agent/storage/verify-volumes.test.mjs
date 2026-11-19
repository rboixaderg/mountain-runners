import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { isMainModule } from "./verify-volumes.mjs";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-volumes.mjs",
);

test("recognises the entry through a symbolic link", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-volumes-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = join(directory, "verify-volumes.mjs");
  writeFileSync(script, "");
  const link = join(directory, "verify-volumes-link.mjs");
  symlinkSync(script, link);
  const moduleUrl = pathToFileURL(script).href;

  assert.equal(isMainModule(moduleUrl, script), true);
  assert.equal(isMainModule(moduleUrl, link), true);
  assert.equal(isMainModule(moduleUrl, join(directory, "missing.mjs")), false);
  assert.equal(isMainModule(moduleUrl, null), false);
});

test("reports the reason the storage verification failed", (context) => {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  if (result.status === 0) {
    context.skip("the real agent volumes are present in this environment");
    return;
  }

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Agent storage verification failed; refusing to start: \S/u,
  );
});
