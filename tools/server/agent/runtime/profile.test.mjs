import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preparePiProfile } from "./profile.mjs";

function fixture(context) {
  const profileRoot = mkdtempSync(join(tmpdir(), "mr-agent-profile-"));
  context.after(() =>
    rmSync(profileRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return { profileRoot, sessionIdentifier: "topic_n1001234567890_7" };
}

test("assembles only trusted runtime files and enables only the sandbox tool", async (context) => {
  const paths = fixture(context);
  const profile = await preparePiProfile(paths);
  assert.equal(profile, join(paths.profileRoot, paths.sessionIdentifier));
  assert.deepEqual(
    JSON.parse(readFileSync(join(profile, "settings.json"), "utf8")),
    {
      defaultProjectTrust: "never",
      defaultTools: ["sandbox_bash"],
    },
  );
  assert.equal(
    existsSync(join(profile, "extensions", "sandbox-bash.ts")),
    true,
  );
  assert.equal(existsSync(join(profile, "extensions", "arguments.mjs")), true);
  assert.equal(existsSync(join(profile, "extensions", "commands.mjs")), true);
  assert.equal(existsSync(join(profile, "skills")), false);
});

test("rebuilds the profile so stale resources from a previous run cannot load", async (context) => {
  const paths = fixture(context);
  const first = await preparePiProfile(paths);
  mkdirSync(join(first, "skills"));
  writeFileSync(join(first, "skills", "stale.md"), "stale\n");
  writeFileSync(
    join(first, "extensions", "stale.ts"),
    "throw new Error('stale');\n",
  );
  const second = await preparePiProfile(paths);
  assert.equal(second, first);
  assert.equal(existsSync(join(second, "skills")), false);
  assert.equal(existsSync(join(second, "extensions", "stale.ts")), false);
});
