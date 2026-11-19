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

// A reservation is claimable only once its announcement is delivered.
function requestQueued(store, repairDetails) {
  const requested = store.requestRepair(repairDetails);
  if (requested !== null) {
    store.queueRepair(requested.sequence);
  }
  return requested;
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
  const first = requestQueued(store, repairRequest);
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

  const second = requestQueued(store, {
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
    requestQueued(store, { ...repairRequest, commitSha: "c".repeat(40) }),
    null,
  );

  // A different failing check set has its own consecutive budget.
  assert.equal(
    requestQueued(store, {
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
  const first = requestQueued(store, repairRequest);
  const second = requestQueued(store, {
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
  const repair = requestQueued(store, repairRequest);
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

test("forgets a finished or reserved repair but keeps a running or queued attempt", (context) => {
  const store = new CiWatchStore(fixture(context));
  const finished = requestQueued(store, repairRequest);
  store.claimNextRepair();
  store.finishRepair(finished.sequence, {
    status: "done",
    outcome: "declined",
  });
  const running = requestQueued(store, {
    ...repairRequest,
    failureFingerprint: JSON.stringify(["Gitleaks"]),
    failedChecks: ["Gitleaks"],
  });
  const queued = requestQueued(store, {
    ...repairRequest,
    failureFingerprint: JSON.stringify(["CodeQL"]),
    failedChecks: ["CodeQL"],
  });
  const reserved = store.requestRepair({
    ...repairRequest,
    failureFingerprint: JSON.stringify(["Cypress"]),
    failedChecks: ["Cypress"],
  });
  store.claimNextRepair();

  store.resetRepairs(repairRequest.pullRequestNumber);

  // The topic already received these attempts and their result must arrive.
  assert.equal(store.repair(running.sequence).status, "running");
  assert.equal(store.repair(queued.sequence).status, "queued");
  // A reservation that never ran is superseded by the new publication.
  assert.equal(store.repair(reserved.sequence), undefined);
  assert.equal(store.repair(finished.sequence), undefined);
  store.close();
});

test("a green CI or a new publication unblocks a topic whose only repair never ran", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.requestRepair(repairRequest);
  assert.equal(store.hasUnreportedWork(request.sessionKey), true);

  store.resetRepairs(repairRequest.pullRequestNumber);

  assert.equal(store.hasUnreportedWork(request.sessionKey), false);
  store.close();
});

test("an uncertain repair survives a green CI or a new human publication", (context) => {
  const store = new CiWatchStore(fixture(context));
  const attempt = requestQueued(store, repairRequest);
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
  const first = requestQueued(store, repairRequest);
  store.close();

  store = new CiWatchStore(path);
  const repeated = requestQueued(store, repairRequest);
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
  const second = requestQueued(store, {
    ...repairRequest,
    commitSha: "b".repeat(40),
  });
  assert.equal(second.attemptNumber, 2);
  store.claimNextRepair();
  store.finishRepair(second.sequence, { status: "done", outcome: "published" });
  assert.equal(
    requestQueued(store, { ...repairRequest, commitSha: "c".repeat(40) }),
    null,
  );
  store.close();
});

test("keeps an uncertain repair blocking after more than one restart", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  requestQueued(store, repairRequest);
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
  const queued = requestQueued(store, repairRequest);
  const second = requestQueued(store, {
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
    requestQueued(store, { ...repairRequest, commitSha: "c".repeat(40) }),
    null,
  );
  store.close();
});

test("keeps a reservation unclaimable until its announcement is queued", (context) => {
  const store = new CiWatchStore(fixture(context));
  const reserved = store.requestRepair(repairRequest);

  assert.equal(store.repair(reserved.sequence).status, "reserved");
  assert.equal(store.claimNextRepair(), null);

  assert.equal(store.queueRepair(reserved.sequence), true);
  assert.equal(store.queueRepair(reserved.sequence), false);
  assert.equal(store.claimNextRepair().sequence, reserved.sequence);
  store.close();
});

test("closes a reservation whose announcement failed and counts the attempt", (context) => {
  const store = new CiWatchStore(fixture(context));
  const reserved = store.requestRepair(repairRequest);

  assert.equal(
    store.abortReservedRepair(reserved.sequence, "announcement_failed"),
    true,
  );
  // Only a reservation can be aborted, and only once.
  assert.equal(
    store.abortReservedRepair(reserved.sequence, "announcement_failed"),
    false,
  );
  const row = store.repair(reserved.sequence);
  assert.equal(row.status, "aborted");
  assert.equal(row.outcome, "announcement_failed");
  assert.equal(store.claimNextRepair(), null);
  assert.equal(store.hasUnreportedWork(request.sessionKey), false);

  // The attempt was taken: it spends the budget of the same failure.
  assert.equal(
    store.requestRepair({
      ...repairRequest,
      commitSha: "b".repeat(40),
    }).attemptNumber,
    2,
  );
  store.close();
});

test("aborts every reservation a restart found unannounced", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  const reserved = store.requestRepair(repairRequest);
  const queued = requestQueued(store, {
    ...repairRequest,
    failureFingerprint: JSON.stringify(["Gitleaks"]),
    failedChecks: ["Gitleaks"],
  });
  store.close();

  store = new CiWatchStore(path);
  const interrupted = store.abortInterruptedReservations(
    "interrupted_before_queue",
  );
  assert.deepEqual(
    interrupted.map((row) => row.sequence),
    [reserved.sequence],
  );
  assert.equal(store.repair(reserved.sequence).status, "aborted");
  assert.equal(
    store.repair(reserved.sequence).outcome,
    "interrupted_before_queue",
  );
  // An announced repair keeps waiting for its turn.
  assert.equal(store.repair(queued.sequence).status, "queued");
  assert.deepEqual(
    store.abortInterruptedReservations("interrupted_before_queue"),
    [],
  );
  store.close();
});

test("reuses an unannounced reservation after a restart without spending another attempt", (context) => {
  const path = fixture(context);
  let store = new CiWatchStore(path);
  const reserved = store.requestRepair(repairRequest);
  store.close();

  store = new CiWatchStore(path);
  const reused = store.requestRepair(repairRequest);
  assert.deepEqual(reused, reserved);
  assert.equal(reused.attemptNumber, 1);
  assert.equal(store.repair(reserved.sequence).status, "reserved");
  assert.equal(store.claimNextRepair(), null);

  // The next failure still gets attempt 2, not 3: the reservation never ran.
  const next = store.requestRepair({
    ...repairRequest,
    commitSha: "b".repeat(40),
  });
  assert.equal(next.attemptNumber, 1);
  store.close();
});

test("reports the last delivered notice of the session, never a pending one", (context) => {
  const store = new CiWatchStore(fixture(context));
  assert.equal(store.lastReported("-100123:7"), undefined);

  store.add(request);
  assert.equal(store.lastReported("-100123:7"), undefined);
  store.beginSend(12, "success");
  assert.equal(store.lastReported("-100123:7"), undefined);
  store.finishSend(12);
  assert.deepEqual(
    { ...store.lastReported("-100123:7") },
    {
      pull_request_number: 123,
      commit_sha: request.commitSha,
      result: "success",
    },
  );

  store.add({
    ...request,
    updateIdentifier: 13,
    commitSha: "b".repeat(40),
  });
  store.beginSend(13, "failure");
  store.finishSend(13);
  assert.equal(store.lastReported("-100123:7").result, "failure");
  assert.equal(store.lastReported("-100123:8"), undefined);
  store.close();
});

test("reports the last delivered notice of one pull request, never of another", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  store.beginSend(12, "success");
  store.finishSend(12);
  store.add({
    ...request,
    updateIdentifier: 13,
    pullRequestNumber: 124,
    commitSha: "b".repeat(40),
  });
  store.beginSend(13, "failure");
  store.finishSend(13);

  assert.deepEqual(
    {
      ...store.lastReportedForPullRequest({
        sessionKey: request.sessionKey,
        pullRequestNumber: 123,
      }),
    },
    {
      pull_request_number: 123,
      commit_sha: request.commitSha,
      result: "success",
    },
  );
  assert.equal(
    store.lastReportedForPullRequest({
      sessionKey: request.sessionKey,
      pullRequestNumber: 124,
    }).commit_sha,
    "b".repeat(40),
  );
  assert.equal(
    store.lastReportedForPullRequest({
      sessionKey: request.sessionKey,
      pullRequestNumber: 125,
    }),
    undefined,
  );
  store.close();
});

test("tells whether the topic has work newer than its last notice", (context) => {
  const store = new CiWatchStore(fixture(context));
  const topic = "-100123:7";
  assert.equal(store.hasUnreportedWork(topic), false);

  store.add(request);
  assert.equal(store.hasUnreportedWork(topic), true);
  assert.equal(store.hasUnreportedWork("-100123:8"), false);
  store.beginSend(12, "failure");
  assert.equal(store.hasUnreportedWork(topic), true);
  store.finishSend(12);
  assert.equal(store.hasUnreportedWork(topic), false);

  const repair = store.requestRepair(repairRequest);
  assert.equal(store.hasUnreportedWork(topic), true);
  store.queueRepair(repair.sequence);
  assert.equal(store.hasUnreportedWork(topic), true);
  store.claimNextRepair();
  assert.equal(store.hasUnreportedWork(topic), true);
  store.finishRepair(repair.sequence, { status: "done", outcome: "published" });
  assert.equal(store.hasUnreportedWork(topic), false);
  store.close();
});

test("names the newest work that the topic was not reported yet", (context) => {
  let current = new Date("2026-11-14T10:00:00Z");
  const store = new CiWatchStore(fixture(context), { now: () => current });
  const topic = "-100123:7";
  assert.equal(store.newestUnreportedWork(topic), undefined);

  // A delivered notice is reported work: it cannot be named as newer.
  store.add(request);
  store.beginSend(12, "success");
  store.finishSend(12);
  assert.equal(store.newestUnreportedWork(topic), undefined);

  current = new Date("2026-11-14T10:01:00Z");
  store.add({ ...request, updateIdentifier: 13, commitSha: "b".repeat(40) });
  assert.deepEqual(
    { ...store.newestUnreportedWork(topic) },
    {
      kind: "notice",
      pull_request_number: 123,
      commit_sha: "b".repeat(40),
      created_at: "2026-11-14T10:01:00.000Z",
    },
  );

  // A repair publishes a new commit that does not exist yet: the older commit
  // it repairs is not the newer work.
  current = new Date("2026-11-14T10:02:00Z");
  store.requestRepair(repairRequest);
  assert.deepEqual(
    { ...store.newestUnreportedWork(topic) },
    {
      kind: "repair",
      pull_request_number: 123,
      commit_sha: null,
      created_at: "2026-11-14T10:02:00.000Z",
    },
  );
  // Of two rows of the same instant, the notice wins: it already has the commit
  // the person can be told about.
  current = new Date("2026-11-14T10:02:00Z");
  store.add({ ...request, updateIdentifier: 14, commitSha: "c".repeat(40) });
  assert.equal(store.newestUnreportedWork(topic).kind, "notice");
  assert.equal(store.newestUnreportedWork(topic).commit_sha, "c".repeat(40));

  assert.equal(store.newestUnreportedWork("-100123:8"), undefined);
  store.close();
});

test("counts an unknown notice as unreported work until a person reconciles it", (context) => {
  const store = new CiWatchStore(fixture(context));
  const topic = "-100123:7";
  store.add(request);
  store.beginSend(12, "success");
  store.finishSend(12);

  // A newer publication may or may not have reached the topic.
  store.add({ ...request, updateIdentifier: 13, commitSha: "b".repeat(40) });
  store.beginSend(13, "success");
  store.markUncertain(13);

  assert.equal(store.state(13), "uncertain");
  assert.equal(store.hasUnreportedWork(topic), true);
  assert.equal(store.hasUnreportedWork("-100123:8"), false);

  // Only the person's decision clears it, and the old notice stays the last one
  // until then.
  assert.equal(store.lastReported(topic).commit_sha, request.commitSha);
  store.resolveUncertainNoticeDelivered(13);
  assert.equal(store.state(13), "sent");
  assert.equal(store.lastReported(topic).commit_sha, "b".repeat(40));
  assert.equal(store.hasUnreportedWork(topic), false);
  store.close();
});

test("counts an unknown notice even when the notices arrived out of order", (context) => {
  let instant = Date.parse("2026-11-16T10:00:00Z");
  const store = new CiWatchStore(fixture(context), {
    now: () => new Date(instant),
  });
  const topic = "-100123:7";
  const nextInstant = () => {
    instant += 1000;
    return store;
  };
  const add = (updateIdentifier) => {
    nextInstant().add({
      ...request,
      updateIdentifier,
      commitSha: String(updateIdentifier).padStart(40, "a"),
    });
  };
  // A, B and C are published, in that order.
  add(10);
  add(11);
  add(12);
  // C is reported first and A afterwards; B may or may not have been reported.
  nextInstant().beginSend(12, "success");
  nextInstant().finishSend(12);
  nextInstant().beginSend(10, "success");
  nextInstant().finishSend(10);
  nextInstant().beginSend(11, "success");
  nextInstant().markUncertain(11);

  // The last delivered notice is A, and the older unknown notice still blocks
  // it: the reference of `lastReported` is not compared with the unknown one.
  assert.equal(store.lastReported(topic).pull_request_number, 123);
  assert.equal(store.lastReported(topic).commit_sha, "10".padStart(40, "a"));
  assert.equal(store.hasUnreportedWork(topic), true);

  nextInstant().resolveUncertainNoticeDelivered(11);
  assert.equal(store.hasUnreportedWork(topic), false);
  store.close();
});

test("keeps the delivered order when a person confirms an older notice", (context) => {
  const store = new CiWatchStore(fixture(context));
  const topic = "-100123:7";
  // The older publication ended unknown.
  store.add(request);
  store.beginSend(12, "success");
  store.markUncertain(12);
  // A newer publication was delivered afterwards.
  store.add({ ...request, updateIdentifier: 13, commitSha: "b".repeat(40) });
  store.beginSend(13, "success");
  store.finishSend(13);

  store.resolveUncertainNoticeDelivered(12);

  assert.equal(store.state(12), "sent");
  // The newer notice is still the last one the topic received.
  assert.equal(store.lastReported(topic).commit_sha, "b".repeat(40));
  assert.equal(store.hasUnreportedWork(topic), false);
  store.close();
});

test("reports the status of the attempt a repeated failure reuses", (context) => {
  const store = new CiWatchStore(fixture(context));
  const reserved = store.requestRepair(repairRequest);
  assert.equal(reserved.status, "reserved");
  assert.equal(store.requestRepair(repairRequest).status, "reserved");

  store.abortReservedRepair(reserved.sequence, "announcement_failed");

  // The same watch, commit and failure reuse the aborted attempt instead of
  // reserving a new one.
  const repeated = store.requestRepair(repairRequest);
  assert.equal(repeated.sequence, reserved.sequence);
  assert.equal(repeated.status, "aborted");
  store.close();
});

test("counts an unknown notice older than the last delivered one", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  store.beginSend(12, "success");
  store.markUncertain(12);
  store.add({ ...request, updateIdentifier: 13, commitSha: "b".repeat(40) });
  store.beginSend(13, "success");
  store.finishSend(13);

  assert.equal(store.hasUnreportedWork(request.sessionKey), true);
  store.close();
});

test("lists the unknown notices of every topic, oldest first", (context) => {
  const store = new CiWatchStore(fixture(context));
  assert.deepEqual(store.uncertainNotices(), []);

  store.add({ ...request, updateIdentifier: 13, commitSha: "b".repeat(40) });
  store.beginSend(13, "failure");
  store.markUncertain(13);
  store.add(request);
  store.markUncertain(12);

  const [first, second] = store.uncertainNotices();
  assert.equal(first.update_identifier, 12);
  assert.equal(first.session_key, request.sessionKey);
  assert.equal(first.pull_request_number, request.pullRequestNumber);
  assert.equal(first.commit_sha, request.commitSha);
  assert.equal(first.result, null);
  assert.equal(second.update_identifier, 13);
  assert.equal(second.result, "failure");
  store.close();
});

test("queues an unknown notice for a new delivery only when a person asks for it", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  store.beginSend(12, "success");
  store.markUncertain(12);

  assert.deepEqual(store.pending(), []);
  const resolved = store.resolveUncertainNoticeResend(12);
  assert.equal(resolved.update_identifier, 12);
  assert.deepEqual(
    store.pending().map((row) => row.update_identifier),
    [12],
  );
  // The decision is guarded by the uncertain state.
  assert.equal(store.resolveUncertainNoticeResend(12), null);
  assert.equal(store.resolveUncertainNoticeDelivered(12), null);
  store.close();
});

test("reports the topic of the most recent publication of a pull request", (context) => {
  const store = new CiWatchStore(fixture(context));
  assert.equal(store.latestPublication(123), undefined);

  store.add(request);
  assert.equal(store.latestPublication(123).session_key, request.sessionKey);
  assert.equal(store.latestPublication(124), undefined);

  store.add({
    ...request,
    updateIdentifier: 13,
    sessionKey: "-100123:8",
  });
  assert.equal(store.latestPublication(123).session_key, "-100123:8");
  store.close();
});

test("lists the latest watch of each published pull request and its owner", (context) => {
  const store = new CiWatchStore(fixture(context));
  assert.deepEqual(store.latestPublications(), []);

  // Two topics publish two pull requests; the later publication of one topic
  // leaves its previous pull request without a local branch.
  store.add(request);
  store.add({
    ...request,
    updateIdentifier: 13,
    sessionKey: "-100123:8",
  });
  store.add({
    ...request,
    updateIdentifier: 14,
    pullRequestNumber: 124,
    commitSha: "b".repeat(40),
  });

  const published = store.latestPublications().map((row) => ({ ...row }));
  assert.deepEqual(published, [
    {
      pull_request_number: 123,
      session_key: "-100123:8",
      delivered_result: null,
      is_owner_latest: 1,
    },
    {
      pull_request_number: 124,
      session_key: request.sessionKey,
      delivered_result: null,
      is_owner_latest: 1,
    },
  ]);

  store.add({
    ...request,
    updateIdentifier: 15,
    pullRequestNumber: 125,
    commitSha: "c".repeat(40),
  });
  const publications = store.latestPublications();
  assert.deepEqual(
    publications.map(({ pull_request_number, is_owner_latest }) => [
      pull_request_number,
      is_owner_latest,
    ]),
    [
      [123, 1],
      [124, 0],
      [125, 1],
    ],
  );
  store.close();
});

test("keeps the result of the latest delivered notice of a pull request", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  assert.equal(store.beginSend(12, "pull-request-closed"), true);
  assert.equal(store.finishSend(12), true);

  const [publication] = store.latestPublications().map((row) => ({ ...row }));
  assert.deepEqual(publication, {
    pull_request_number: 123,
    session_key: request.sessionKey,
    delivered_result: "pull-request-closed",
    is_owner_latest: 1,
  });
  store.close();
});

test("does not treat an interrupted or unknown notice as delivered", (context) => {
  const store = new CiWatchStore(fixture(context));
  store.add(request);
  assert.equal(store.beginSend(12, "pull-request-closed"), true);
  const [sending] = store.latestPublications();
  assert.equal(sending.delivered_result, null, "a send in progress is unknown");

  assert.equal(store.markUncertain(12), true);
  const [uncertain] = store.latestPublications();
  assert.equal(uncertain.delivered_result, null);

  // A delivered notice of a later commit still counts.
  assert.equal(store.beginSend(12, "success"), false);
  store.close();
});

test("resolves an uncertain repair only with its update, sequence and failed commit", (context) => {
  const store = new CiWatchStore(fixture(context));
  const attempt = requestQueued(store, repairRequest);
  store.claimNextRepair();
  store.interruptRepairs();
  const resolve = (identifiers) =>
    store.resolveUncertainRepair({
      ...identifiers,
      outcome: "reconciled_not_published",
    });
  assert.equal(
    resolve({
      updateIdentifier: repairRequest.updateIdentifier,
      sequence: attempt.sequence,
      failedCommit: repairRequest.commitSha,
    }).sequence,
    attempt.sequence,
  );
  assert.equal(store.repair(attempt.sequence).status, "done");

  // A later repair reuses the sequence once the finished row is cleared.
  store.resetRepairs(repairRequest.pullRequestNumber);
  const reused = requestQueued(store, {
    ...repairRequest,
    commitSha: "b".repeat(40),
  });
  store.claimNextRepair();
  store.interruptRepairs();
  assert.equal(reused.sequence, attempt.sequence);
  assert.equal(
    resolve({
      updateIdentifier: repairRequest.updateIdentifier,
      sequence: attempt.sequence,
      failedCommit: repairRequest.commitSha,
    }),
    null,
  );
  assert.equal(
    resolve({
      updateIdentifier: repairRequest.updateIdentifier + 1,
      sequence: attempt.sequence,
      failedCommit: "b".repeat(40),
    }),
    null,
  );
  assert.equal(
    resolve({
      updateIdentifier: repairRequest.updateIdentifier,
      sequence: attempt.sequence,
      failedCommit: "b".repeat(40),
    }).sequence,
    attempt.sequence,
  );
  assert.equal(store.repair(attempt.sequence).status, "done");
  assert.equal(store.uncertainRepairCount(), 0);
  store.close();
});
