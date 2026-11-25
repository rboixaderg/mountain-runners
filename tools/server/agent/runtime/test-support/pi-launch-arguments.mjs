import assert from "node:assert/strict";
import { runPiPrompt } from "telegram-pi-bridge/pi";

/** The arguments the transport would launch Pi with; nothing is started. */
export async function piLaunchArguments(options) {
  let launched;
  await assert.rejects(
    runPiPrompt({
      ...options,
      message: "synthetic",
      spawnImpl: (_command, argumentsList) => {
        launched = argumentsList;
        throw new Error("synthetic launch");
      },
    }),
    /synthetic launch/u,
  );
  return launched;
}
