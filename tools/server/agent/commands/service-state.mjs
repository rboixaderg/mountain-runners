// Whether the service is stopped, for the operator commands that must not run
// beside it.

import { spawnSync } from "node:child_process";

/** What systemd reports for the service unit. */
export function serviceState() {
  const result = spawnSync("systemctl", ["is-active", "mountain-agent"], {
    encoding: "utf8",
  });
  return result.stdout?.trim() ?? "";
}

// Fails closed: only a unit systemd reports as stopped is safe to work beside.
export function isStoppedServiceState(state) {
  return state === "inactive" || state === "failed";
}
