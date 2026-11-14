import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CiWatchStore } from "./ci-watch-store.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-ci-watch-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "state.sqlite");
}

const request = {
  updateIdentifier: 12,
  sessionKey: "-100123:7",
  pullRequestNumber: 123,
  commitSha: "a".repeat(40),
};

test("preserves a pending watch and its pinned SHA after restart", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  store.add(request);
  store.close();
  store = new CiWatchStore(path);
  const [watch] = store.pending();
  assert.equal(watch.commit_sha, request.commitSha);
  assert.equal(watch.session_key, request.sessionKey);
  assert.equal(watch.pull_request_number, request.pullRequestNumber);
  assert.ok(Date.parse(watch.created_at) > 0);
  store.close();
});

test("does not resend a notification interrupted during delivery", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.beginSend(12, "success"), true);
  assert.equal(store.state(12), "sending");
  store.close();
  store = new CiWatchStore(path);
  const interrupted = store.recoverSending();
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].update_identifier, request.updateIdentifier);
  assert.equal(interrupted[0].session_key, request.sessionKey);
  assert.equal(interrupted[0].commit_sha, request.commitSha);
  assert.deepEqual(store.recoverSending(), []);
  assert.deepEqual(store.pending(), []);
  assert.equal(store.state(12), "uncertain");
  assert.equal(store.finishSend(12), false);
  store.close();
});

test("does not send a successfully recorded notification twice", (context) => {
  const path = fixture(context);
  const store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.beginSend(12, "failure"), true);
  assert.equal(store.beginSend(12, "success"), false);
  assert.equal(store.finishSend(12), true);
  assert.equal(store.beginSend(12, "failure"), false);
  assert.deepEqual(store.pending(), []);
  assert.equal(store.state(12), "sent");
  store.close();
});

test("keeps an uncertain delivery out of the pending queue", (context) => {
  const path = fixture(context);
  const store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.markUncertain(12), true);
  assert.equal(store.markUncertain(12), false);
  assert.deepEqual(store.pending(), []);
  assert.equal(store.state(12), "uncertain");
  store.close();
});

const repairRequest = {
  updateIdentifier: 12,
  sessionKey: "-100123:7",
  pullRequestNumber: 123,
  failureFingerprint: JSON.stringify(["Validate"]),
  failedChecks: ["Validate"],
  evidence: [{ name: "Validate", detail: "lint error" }],
  commitSha: "a".repeat(40),
  maximumAttempts: 2,
};

test("follows the repaired commit in the same conversation slot", (context) => {
  const path = fixture(context);
  const store = new CiWatchStore(path);
  store.add(request);
  assert.equal(store.beginSend(12, "repairing"), true);
  assert.equal(store.finishSend(12), true);

  const nextCommit = "b".repeat(40);
  assert.equal(
    store.reopen({
      updateIdentifier: 12,
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
      commitSha: nextCommit,
    }),
    true,
  );
  assert.equal(store.pending()[0].commit_sha, nextCommit);
  // A pending watch is never overwritten by a later publication.
  assert.equal(
    store.reopen({
      updateIdentifier: 12,
      sessionKey: request.sessionKey,
      pullRequestNumber: request.pullRequestNumber,
      commitSha: "c".repeat(40),
    }),
    false,
  );
  assert.equal(store.pending()[0].commit_sha, nextCommit);
  store.close();
});

test("counts the repairs of a failure across commits and stops at the budget", (context) => {
  const path = fixture(context);
  const store = new CiWatchStore(path);
  const first = store.requestRepair(repairRequest);
  assert.deepEqual(first.attemptNumber, 1);
  assert.equal(store.repair(first.sequence).status, "queued");
  assert.deepEqual(
    JSON.parse(store.repair(first.sequence).evidence),
    repairRequest.evidence,
  );
  store.claimNextRepair();
  assert.equal(
    store.finishRepair(first.sequence, {
      status: "done",
      outcome: "published",
    }),
    true,
  );

  const second = store.requestRepair({
    ...repairRequest,
    commitSha: "b".repeat(40),
  });
  assert.equal(second.attemptNumber, 2);
  store.claimNextRepair();
  assert.equal(
    store.finishRepair(second.sequence, { status: "done", outcome: "failed" }),
    true,
  );
  assert.equal(
    store.requestRepair({ ...repairRequest, commitSha: "c".repeat(40) }),
    null,
  );

  // A different failing check set has its own consecutive budget.
  assert.equal(
    store.requestRepair({
      ...repairRequest,
      failureFingerprint: JSON.stringify(["Gitleaks"]),
      failedChecks: ["Gitleaks"],
    }).attemptNumber,
    1,
  );
  store.close();
});

test("runs one repair at a time and resumes it after a restart", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  const first = store.requestRepair(repairRequest);
  const second = store.requestRepair({
    ...repairRequest,
    failureFingerprint: JSON.stringify(["Gitleaks"]),
    failedChecks: ["Gitleaks"],
  });

  assert.equal(store.claimNextRepair().sequence, first.sequence);
  assert.equal(store.claimNextRepair(), null);
  store.close();

  store = new CiWatchStore(path);
  // The interrupted repair is never replayed automatically.
  const interrupted = store.interruptRepairs();
  assert.deepEqual(
    interrupted.map((repair) => repair.sequence),
    [first.sequence],
  );
  assert.equal(store.repair(first.sequence).status, "uncertain");
  assert.deepEqual(store.interruptRepairs(), []);
  // The queued repair is untouched and still runs.
  assert.equal(store.claimNextRepair().sequence, second.sequence);
  store.close();
});

test("refuses to close a repair that never started", (context) => {
  const store = new CiWatchStore(fixture(context));
  const repair = store.requestRepair(repairRequest);
  assert.equal(
    store.finishRepair(repair.sequence, {
      status: "done",
      outcome: "published",
    }),
    false,
  );
  assert.throws(
    () =>
      store.finishRepair(repair.sequence, {
        status: "published",
        outcome: "published",
      }),
    { message: /Invalid repair status published/u },
  );
  store.close();
});

test("forgets a finished repair budget but keeps a running or queued attempt", (context) => {
  const store = new CiWatchStore(fixture(context));
  const finished = store.requestRepair(repairRequest);
  store.claimNextRepair();
  store.finishRepair(finished.sequence, {
    status: "done",
    outcome: "declined",
  });
  const running = store.requestRepair({
    ...repairRequest,
    failureFingerprint: JSON.stringify(["Gitleaks"]),
    failedChecks: ["Gitleaks"],
  });
  const queued = store.requestRepair({
    ...repairRequest,
    failureFingerprint: JSON.stringify(["CodeQL"]),
    failedChecks: ["CodeQL"],
  });
  store.claimNextRepair();

  store.resetRepairs(repairRequest.pullRequestNumber);

  // The topic already received these attempts and their result must arrive.
  assert.equal(store.repair(running.sequence).status, "running");
  assert.equal(store.repair(queued.sequence).status, "queued");
  assert.equal(store.repair(finished.sequence), undefined);
  store.close();
});

test("an uncertain repair survives a green CI or a new human publication", (context) => {
  const store = new CiWatchStore(fixture(context));
  const attempt = store.requestRepair(repairRequest);
  store.claimNextRepair();
  store.interruptRepairs();

  store.resetRepairs(repairRequest.pullRequestNumber);

  assert.equal(store.repair(attempt.sequence).status, "uncertain");
  assert.equal(store.uncertainRepairCount(), 1);
  store.close();
});

test("reserves the same watch and commit only once across a restart", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  const first = store.requestRepair(repairRequest);
  store.close();

  store = new CiWatchStore(path);
  const repeated = store.requestRepair(repairRequest);
  assert.equal(repeated.sequence, first.sequence);
  assert.equal(repeated.attemptNumber, 1);

  // Only an attempt that was taken counts towards the limit.
  store.claimNextRepair();
  assert.equal(
    store.finishRepair(first.sequence, {
      status: "done",
      outcome: "published",
    }),
    true,
  );
  const second = store.requestRepair({
    ...repairRequest,
    commitSha: "b".repeat(40),
  });
  assert.equal(second.attemptNumber, 2);
  store.claimNextRepair();
  store.finishRepair(second.sequence, { status: "done", outcome: "published" });
  assert.equal(
    store.requestRepair({ ...repairRequest, commitSha: "c".repeat(40) }),
    null,
  );
  store.close();
});

test("keeps an uncertain repair blocking after more than one restart", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  store.requestRepair(repairRequest);
  store.claimNextRepair();
  store.close();

  store = new CiWatchStore(path);
  assert.equal(store.interruptRepairs().length, 1);
  assert.equal(store.uncertainRepairCount(), 1);
  store.close();

  store = new CiWatchStore(path);
  assert.deepEqual(store.interruptRepairs(), []);
  assert.equal(store.uncertainRepairCount(), 1);
  store.close();
});

test("does not count a reservation that never ran", (context) => {
  const store = new CiWatchStore(fixture(context));
  const queued = store.requestRepair(repairRequest);
  const second = store.requestRepair({
    ...repairRequest,
    commitSha: "b".repeat(40),
  });

  // Neither queued attempt was taken: neither spends the budget.
  assert.equal(second.attemptNumber, 1);

  for (const attempt of [queued, second]) {
    store.claimNextRepair();
    store.finishRepair(attempt.sequence, {
      status: "done",
      outcome: "declined",
    });
  }
  assert.equal(
    store.requestRepair({ ...repairRequest, commitSha: "c".repeat(40) }),
    null,
  );
  store.close();
});
