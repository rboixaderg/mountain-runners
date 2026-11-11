import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const systemdPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../systemd",
);
const workUnit = "var-lib-mountain\\x2drunners\\x2dagent.mount";
const stateUnit = "var-lib-mountain\\x2drunners\\x2dagent-state.mount";

test("requires both bounded volumes and verifies them before starting the agent", () => {
  const service = readFileSync(
    join(systemdPath, "mountain-agent.service"),
    "utf8",
  );
  assert.ok(service.includes(`BindsTo=${workUnit} ${stateUnit}`));
  assert.match(
    service,
    /^AssertPathIsMountPoint=\/var\/lib\/mountain-runners-agent$/mu,
  );
  assert.match(
    service,
    /^AssertPathIsMountPoint=\/var\/lib\/mountain-runners-agent\/state$/mu,
  );
  assert.match(
    service,
    /^ExecStartPre=.*\/agent\/storage\/verify-volumes\.mjs$/mu,
  );
  assert.match(
    service,
    /^Environment=TMPDIR=\/var\/lib\/mountain-runners-agent\/tmp$/mu,
  );
  assert.match(service, /^DelegateSubgroup=main$/mu);
});

test("mounts distinct preallocated ext4 images without device or setuid access", () => {
  const work = readFileSync(join(systemdPath, workUnit), "utf8");
  const state = readFileSync(join(systemdPath, stateUnit), "utf8");
  assert.match(
    work,
    /^What=\/var\/lib\/mountain-runners-agent-volumes\/work\.ext4$/mu,
  );
  assert.match(
    state,
    /^What=\/var\/lib\/mountain-runners-agent-volumes\/state\.ext4$/mu,
  );
  assert.ok(state.includes(`Requires=${workUnit}`));
  for (const unit of [work, state]) {
    assert.match(unit, /^Type=ext4$/mu);
    assert.match(unit, /^Options=loop,nosuid,nodev$/mu);
  }
});
