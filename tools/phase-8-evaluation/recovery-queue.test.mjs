import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { RecoveryQueue } from "./recovery-queue.mjs";

function location(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-queue-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "queue.sqlite");
}

test("preserves accepted requests and deduplicates updates across restart", (context) => {
  const path = location(context);
  let queue = new RecoveryQueue(path);
  assert.equal(queue.admit(1, "topic-one", "first"), "accepted");
  assert.equal(queue.admit(2, "topic-two", "first"), "accepted");
  queue.close();
  queue = new RecoveryQueue(path);
  assert.equal(queue.admit(1, "topic-one", "first"), "duplicate");
  assert.equal(queue.startNext().update_id, 1);
  assert.equal(queue.startNext(), null);
  assert.equal(queue.complete(1), true);
  assert.equal(queue.startNext().update_id, 2);
  queue.close();
});

test("does not automatically rerun a request interrupted during execution", (context) => {
  const path = location(context);
  let queue = new RecoveryQueue(path);
  queue.admit(1, "topic-one", "first");
  queue.admit(2, "topic-two", "second");
  queue.startNext();
  queue.close();
  queue = new RecoveryQueue(path);
  assert.equal(queue.recover(), 1);
  assert.equal(queue.status(1), "uncertain");
  assert.equal(queue.startNext(), null);
  assert.equal(queue.admit(1, "topic-one", "first"), "duplicate");
  assert.equal(queue.status(2), "pending");
  assert.equal(queue.confirmReconciledCompletion(2), false);
  assert.equal(queue.confirmReconciledCompletion(1), true);
  assert.equal(queue.confirmReconciledCompletion(1), false);
  assert.equal(queue.startNext().update_id, 2);
  queue.close();
});

test("marks a running request uncertain after the process is killed", (context) => {
  const path = location(context);
  const code = `import { RecoveryQueue } from ${JSON.stringify(new URL("./recovery-queue.mjs", import.meta.url).href)}; const queue = new RecoveryQueue(process.argv[1]); queue.admit(7, 'topic', 'test'); queue.startNext(); process.kill(process.pid, 'SIGKILL');`;
  const processResult = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code, path],
    { env: { PATH: process.env.PATH } },
  );
  assert.equal(processResult.signal, "SIGKILL");
  const queue = new RecoveryQueue(path);
  assert.equal(queue.recover(), 1);
  assert.equal(queue.status(7), "uncertain");
  assert.equal(queue.startNext(), null);
  queue.close();
});

test("records caller-confirmed completion after observing a synthetic effect", (context) => {
  const path = location(context);
  const effectPath = `${path}.effect`;
  const code = `import { appendFileSync } from 'node:fs'; import { RecoveryQueue } from ${JSON.stringify(new URL("./recovery-queue.mjs", import.meta.url).href)}; const queue = new RecoveryQueue(process.argv[1]); queue.admit(7, 'topic', 'test'); queue.startNext(); appendFileSync(process.argv[2], 'effect\\n'); process.kill(process.pid, 'SIGKILL');`;
  const processResult = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code, path, effectPath],
    { env: { PATH: process.env.PATH } },
  );
  assert.equal(processResult.signal, "SIGKILL");
  const queue = new RecoveryQueue(path);
  assert.equal(queue.recover(), 1);
  assert.equal(queue.startNext(), null);
  assert.equal(readFileSync(effectPath, "utf8"), "effect\n");
  assert.equal(queue.confirmReconciledCompletion(7), true);
  assert.equal(queue.status(7), "done");
  queue.close();
});

test("rejects the eleventh pending request without losing the first ten", (context) => {
  const queue = new RecoveryQueue(location(context));
  for (let index = 1; index <= 10; index++)
    assert.equal(queue.admit(index, "topic", String(index)), "accepted");
  assert.equal(queue.admit(11, "topic", "overflow"), "full");
  assert.equal(queue.admit(1, "topic", "duplicate"), "duplicate");
  assert.equal(queue.startNext().update_id, 1);
  assert.equal(
    queue.admit(11, "topic", "accepted after capacity frees"),
    "accepted",
  );
  queue.close();
});
