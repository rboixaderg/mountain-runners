import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { serveWebResearch } from "./web-wire-server.mjs";

test("tool cancellation closes the channel and concurrent calls never reach the service", async () => {
  const clientUrl = new URL("./web-wire-client.mjs", import.meta.url).href;
  const script = `
    import { requestWebResearch } from ${JSON.stringify(clientUrl)};
    const controller = new AbortController();
    process.stdin.once('data', () => controller.abort());
    const first = requestWebResearch({operation:'search',input:'first'}, controller.signal);
    const second = await requestWebResearch({operation:'read',input:'second'});
    const stopped = await first;
    process.stdout.write(JSON.stringify({second,stopped}));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  let operationSignal;
  const calls = [];
  const close = serveWebResearch(child.stdio[3], (request, { signal }) => {
    calls.push(request);
    operationSignal = signal;
    child.stdin.end("cancel\n");
    return new Promise(() => {});
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const [exitCode] = await once(child, "close");
  close();
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ operation: "search", input: "first" }]);
  assert.equal(operationSignal.aborted, true);
  assert.deepEqual(JSON.parse(output), {
    second: "Web research unavailable or refused. No details are available.",
    stopped: "Web research unavailable or refused. No details are available.",
  });
});
