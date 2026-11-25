import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InspectableMergeRequestStore } from "../repository/test-support/merge-request-state.mjs";
import { openDatabase } from "../repository/sqlite.mjs";
import {
  createMergeRequests,
  mergeConfirmationIntent,
  mergeQuestionLifetimeMilliseconds,
} from "./merge-request.mjs";
import { mergeReports } from "../policy/development.mjs";
import {
  deliveredPreviews,
  mergedPullRequest,
  mergeGithub,
  openPullRequest,
} from "./test-support/github.mjs";

const repository = "rboixaderg/mountain-runners";
const groupIdentifier = "-1001234567890";
const sessionKey = `${groupIdentifier}:7`;
const memberIdentifier = 555;
const pullRequestNumber = 200;
const commit = "a".repeat(40);
const mergeCommit = "b".repeat(40);
const target = { pullRequestNumber, commit };
const reviewUrl = `https://github.com/${repository}/pull/${pullRequestNumber}`;
const mergedTarget = {
  pullRequestNumber,
  mergeCommit,
  pullRequestUrl: reviewUrl,
};
const publicationUpdateIdentifier = 12;
const noticeMessageIdentifier = 800;
const questionMessageIdentifier = 900;
const validationText = "La feina està validada";
const confirmationText = "Sí, a producció";

function deliveredPreviewRow({
  publicationUpdate = publicationUpdateIdentifier,
  pullRequest = pullRequestNumber,
  commitSha = commit,
  notice = noticeMessageIdentifier,
} = {}) {
  return {
    update_identifier: publicationUpdate,
    pull_request_number: pullRequest,
    commit_sha: commitSha,
    notice_message_identifier: notice,
  };
}

function setup(context, { github = mergeGithub() } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mr-merge-confirmation-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const storePath = join(directory, "merge.sqlite");
  const stores = [];
  const openStore = () => {
    const store = new InspectableMergeRequestStore(storePath);
    stores.push(store);
    return store;
  };
  context.after(() => {
    for (const store of stores) {
      try {
        store.close();
      } catch {
        // The connection is already released.
      }
    }
  });

  const previews = deliveredPreviews();
  const attempts = [];
  const membership = {
    result: { verified: true, status: "member" },
    calls: [],
  };
  const newerWork = { value: false, calls: [] };
  const intervening = { value: false, calls: [] };
  const telegram = {
    sendError: null,
    messageIdentifier: questionMessageIdentifier,
    onSend: null,
    async sendMessage(message) {
      attempts.push(message);
      telegram.onSend?.(message);
      if (telegram.sendError) throw telegram.sendError;
      if (telegram.messageIdentifier === undefined) return {};
      return { message_id: telegram.messageIdentifier };
    },
  };
  const traces = [];
  const notes = [];
  const synchronization = {
    calls: [],
    result: { outcome: "answered", report: "Preparant la branca." },
  };

  function buildHandler(store) {
    return createMergeRequests({
      store,
      findDeliveredPreview: (topicSessionKey) => previews.find(topicSessionKey),
      hasNewerWork: (query) => {
        newerWork.calls.push(query);
        return newerWork.value;
      },
      synchronizeBehind: async (requestArgument, target, options) => {
        synchronization.calls.push({ requestArgument, target, options });
        return synchronization.result;
      },
      hasInterveningInstructions: (range) => {
        intervening.calls.push(range);
        return intervening.value;
      },
      verifyMembership: async (authorIdentifier) => {
        membership.calls.push(authorIdentifier);
        return membership.result;
      },
      github,
      repository,
      requiredChecks: ["Validate"],
      telegram,
      retryDelayMilliseconds: 0,
      recordTrace: (entry) => traces.push(entry),
      recordServiceNote: (note) => notes.push(note),
    });
  }

  const scenario = {
    storePath,
    github,
    previews,
    attempts,
    membership,
    newerWork,
    intervening,
    telegram,
    traces,
    notes,
    synchronization,
    deliverPreview: (row = deliveredPreviewRow()) =>
      previews.deliver(sessionKey, row),
    clearPreview: () => previews.clear(sessionKey),
    reopen() {
      scenario.store = openStore();
      scenario.handler = buildHandler(scenario.store);
      return scenario.handler;
    },
  };
  scenario.store = openStore();
  scenario.handler = buildHandler(scenario.store);
  return scenario;
}

function validationRequest({
  updateIdentifier = 20,
  replyMessageIdentifier: reply = noticeMessageIdentifier,
  authorIdentifier: member = memberIdentifier,
} = {}) {
  return {
    updateIdentifier,
    sessionKey,
    authorIdentifier: member,
    instruction: validationText,
    replyMessageIdentifier: reply,
  };
}

function confirmationRequest({
  updateIdentifier = 21,
  replyMessageIdentifier: reply = questionMessageIdentifier,
  authorIdentifier: member = memberIdentifier,
  instruction = confirmationText,
} = {}) {
  return {
    updateIdentifier,
    sessionKey,
    authorIdentifier: member,
    instruction,
    replyMessageIdentifier: reply,
  };
}

function validate(scenario, options = {}) {
  const request = validationRequest(options);
  return scenario.handler.handleConfirmation(
    request,
    mergeConfirmationIntent(request.instruction),
  );
}

function confirm(scenario, options = {}) {
  const request = confirmationRequest(options);
  return scenario.handler.handleConfirmation(
    request,
    mergeConfirmationIntent(request.instruction),
  );
}

function assertQuiet(result) {
  assert.deepEqual(result, { outcome: "merge_context" });
}

function assertInvalidQuestion(result) {
  assert.deepEqual(result, {
    outcome: "merge_context",
    report: mergeReports.invalidQuestion,
  });
}

function assertAlreadyHandled(result) {
  assert.deepEqual(result, {
    outcome: "merge_context",
    report: mergeReports.alreadyHandled,
  });
}

function storedQuestion(scenario, identifier = questionMessageIdentifier) {
  return scenario.store.question({
    sessionKey,
    questionMessageIdentifier: identifier,
  });
}

test("recognises only the closed validation literal and the normalized confirmation reply", () => {
  for (const text of [
    "Sí, a producció",
    "sí, a producció",
    "  SÍ, A PRODUCCIÓ  ",
    "\tSí, a producció\n",
    "si, produccio",
    "sí, Produccio",
    "Si, a produccio",
    "si a produccio",
    "si produccio",
    "si,produccio",
    "Sí ,  a   producció!",
    "Sí, a producció.",
    "SI, PRODUCCIO!!!",
  ]) {
    assert.equal(mergeConfirmationIntent(text), "confirm", text);
  }
  for (const text of [
    "La feina està validada",
    "la feina està validada",
    "  La feina   està validada  ",
    "La feina està validada.",
    "La feina està validada!!!",
  ]) {
    assert.equal(mergeConfirmationIntent(text), "validate", text);
  }
  for (const text of [
    "",
    "Perfecte",
    "Sí",
    "sí",
    "si",
    "Sí gràcies",
    "a producció",
    "producció",
    "Sí, a producció?",
    "No, a producció",
    "Sí, a producció ara",
    "La feina està validada, si us plau",
    "He fet la feina està validada",
  ]) {
    assert.equal(mergeConfirmationIntent(text), null, text);
  }
});

test("contextualIntent matches the current preview notice or any confirmation reply", async (context) => {
  const scenario = setup(context);
  assert.equal(
    scenario.handler.contextualIntent(validationRequest()),
    null,
    "validation without a delivered preview follows ordinary conversation",
  );

  scenario.deliverPreview();
  assert.equal(
    scenario.handler.contextualIntent(validationRequest()),
    "validate",
  );
  assert.equal(
    scenario.handler.contextualIntent(
      validationRequest({
        replyMessageIdentifier: noticeMessageIdentifier + 1,
      }),
    ),
    null,
    "validation replying to another bot message follows ordinary conversation",
  );
  assert.equal(
    scenario.handler.contextualIntent(
      validationRequest({ replyMessageIdentifier: null }),
    ),
    null,
  );
  assert.equal(
    scenario.handler.contextualIntent(confirmationRequest()),
    "confirm",
    "a confirmation reply without a stored question never reaches the model",
  );
  assert.equal(
    scenario.handler.contextualIntent(
      confirmationRequest({ replyMessageIdentifier: null }),
    ),
    null,
  );

  await validate(scenario);
  assert.equal(
    scenario.handler.contextualIntent(
      confirmationRequest({ instruction: "si, produccio" }),
    ),
    "confirm",
  );

  scenario.deliverPreview(
    deliveredPreviewRow({ notice: 801, publicationUpdate: 13 }),
  );
  assert.equal(
    scenario.handler.contextualIntent(validationRequest()),
    null,
    "validation replying to a superseded notice is no longer contextual",
  );
});

test("asks the fixed question as a reply to the delivered notice", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();

  const result = await validate(scenario);

  assert.deepEqual(result, { outcome: "merge_context" });
  assert.equal(scenario.attempts.length, 1);
  assert.equal(scenario.attempts[0].text, mergeReports.question);
  assert.equal(scenario.attempts[0].chatIdentifier, Number(groupIdentifier));
  assert.equal(scenario.attempts[0].messageThreadIdentifier, 7);
  const question = storedQuestion(scenario);
  assert.equal(question.notice_message_identifier, noticeMessageIdentifier);
  assert.equal(
    question.publication_update_identifier,
    publicationUpdateIdentifier,
  );
  assert.equal(question.validation_update_identifier, 20);
  assert.equal(question.author_identifier, memberIdentifier);
  assert.equal(question.pull_request_number, pullRequestNumber);
  assert.equal(question.commit_sha, commit);
  assert.equal(question.consumed_at, null);
  assert.deepEqual(scenario.github.merges, []);
});

for (const [name, { deliver = true, prepare, options }] of [
  ["a reply to another message", { options: { replyMessageIdentifier: 801 } }],
  [
    "a reply without an identifier",
    { options: { replyMessageIdentifier: null } },
  ],
  [
    "a reply with a zero identifier",
    { options: { replyMessageIdentifier: 0 } },
  ],
  ["no delivered notice", { deliver: false }],
  [
    "a substituted delivered notice",
    {
      deliver: false,
      prepare: (scenario) =>
        scenario.deliverPreview(
          deliveredPreviewRow({ notice: 801, publicationUpdate: 13 }),
        ),
    },
  ],
]) {
  test(`does not ask the question for ${name}`, async (context) => {
    const scenario = setup(context);
    if (deliver) scenario.deliverPreview();
    prepare?.(scenario);

    const result = await validate(scenario, options);

    assert.deepEqual(result, { outcome: "merge_context" });
    assert.equal(scenario.attempts.length, 0);
    assert.equal(storedQuestion(scenario), undefined);
    assert.deepEqual(scenario.github.merges, []);
  });
}

for (const [name, prepare] of [
  [
    "a pull request that is not mergeable",
    (scenario) => {
      scenario.github.pullRequest = openPullRequest({
        mergeableState: "blocked",
      });
    },
  ],
  [
    "a pull request without the preview label",
    (scenario) => {
      scenario.github.pullRequest = openPullRequest({ previewLabeled: false });
    },
  ],
  [
    "a revoked preview",
    (scenario) => {
      scenario.github.pullRequest = openPullRequest({ previewRevoked: true });
    },
  ],
  [
    "a moved head",
    (scenario) => {
      scenario.github.pullRequest = openPullRequest({
        headSha: "c".repeat(40),
      });
    },
  ],
  [
    "checks that are not green",
    (scenario) => {
      scenario.github.checkRuns = [
        { name: "Validate", status: "completed", conclusion: "failure" },
      ];
    },
  ],
  [
    "newer work in the topic",
    (scenario) => {
      scenario.newerWork.value = true;
    },
  ],
  [
    "an open merge of the pull request",
    (scenario) => {
      scenario.store.begin({
        updateIdentifier: 40,
        sessionKey,
        authorIdentifier: memberIdentifier,
        pullRequestNumber,
        commitSha: commit,
      });
    },
  ],
  [
    "a person who is no longer a member",
    (scenario) => {
      scenario.membership.result = {
        verified: false,
        reason: "not_a_group_member",
      };
    },
  ],
]) {
  test(`does not ask the question for ${name}`, async (context) => {
    const scenario = setup(context);
    scenario.deliverPreview();
    prepare(scenario);

    const result = await validate(scenario);

    assert.deepEqual(result, { outcome: "merge_context" });
    assert.equal(scenario.attempts.length, 0);
    assert.equal(storedQuestion(scenario), undefined);
    assert.deepEqual(scenario.github.merges, []);
  });
}

test("validating a pull request that changes infrastructure refuses instead of asking", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  scenario.github.changedPaths = ["apps/web/package.json"];

  const result = await validate(scenario);

  assert.equal(result.outcome, "merge_context");
  assert.equal(
    result.report,
    mergeReports.infrastructureChanges({ reviewUrl }),
  );
  assert.equal(scenario.attempts.length, 0);
  assert.equal(storedQuestion(scenario), undefined);
  assert.equal(scenario.traces.at(-1).action, "merge_refused");
  assert.equal(
    scenario.traces.at(-1).detail,
    "infrastructure_changes #200 aaaaaaa",
  );
});

for (const [name, configureSend] of [
  [
    "a failed send",
    (telegram) => {
      telegram.sendError = new Error("network");
    },
  ],
  [
    "a send without an identifier",
    (telegram) => {
      telegram.messageIdentifier = undefined;
    },
  ],
  [
    "a send with a zero identifier",
    (telegram) => {
      telegram.messageIdentifier = 0;
    },
  ],
  [
    "a send with a negative identifier",
    (telegram) => {
      telegram.messageIdentifier = -1;
    },
  ],
  [
    "a send with a textual identifier",
    (telegram) => {
      telegram.messageIdentifier = String(questionMessageIdentifier);
    },
  ],
]) {
  test(`a question with ${name} never authorizes a merge`, async (context) => {
    const scenario = setup(context);
    scenario.deliverPreview();
    configureSend(scenario.telegram);

    await validate(scenario);

    assert.equal(scenario.attempts.length, 1);
    assert.equal(storedQuestion(scenario), undefined);

    const result = await confirm(scenario);

    assertInvalidQuestion(result);
    assert.deepEqual(scenario.github.merges, []);
  });
}

test("a notice replaced while the question is sent is not stored", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  scenario.telegram.onSend = () => {
    scenario.deliverPreview(
      deliveredPreviewRow({ notice: 801, publicationUpdate: 13 }),
    );
  };

  await validate(scenario);

  assert.equal(scenario.attempts.length, 1);
  assert.equal(storedQuestion(scenario), undefined);
  assert.equal(
    scenario.handler.contextualIntent(confirmationRequest()),
    "confirm",
  );
  assertInvalidQuestion(await confirm(scenario));
  assert.deepEqual(scenario.github.merges, []);
});

test("the matching reply from the same member merges the pinned preview once", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);

  const result = await confirm(scenario);

  assert.equal(result.outcome, "merge_context");
  assert.equal(result.report, mergeReports.merged(mergedTarget));
  assert.deepEqual(scenario.github.merges, [
    { number: pullRequestNumber, sha: commit },
  ]);
  assert.equal(scenario.store.state(21), "merged");
  assert.notEqual(storedQuestion(scenario).consumed_at, null);

  const repeated = await confirm(scenario, { updateIdentifier: 22 });

  assertAlreadyHandled(repeated);
  assert.deepEqual(scenario.github.merges, [
    { number: pullRequestNumber, sha: commit },
  ]);
  assert.equal(scenario.store.state(22), undefined);
});

for (const [name, options, assertResult] of [
  [
    "an unknown question identifier",
    { replyMessageIdentifier: 901 },
    assertInvalidQuestion,
  ],
  [
    "a reply to the notice instead of the question",
    { replyMessageIdentifier: noticeMessageIdentifier },
    assertInvalidQuestion,
  ],
  ["a standalone reply", { replyMessageIdentifier: null }, assertQuiet],
  ["another member", { authorIdentifier: 556 }, assertQuiet],
]) {
  test(`does not merge from ${name}`, async (context) => {
    const scenario = setup(context);
    scenario.deliverPreview();
    await validate(scenario);

    const result = await confirm(scenario, options);

    assertResult(result);
    assert.deepEqual(scenario.github.merges, []);
    assert.equal(storedQuestion(scenario).consumed_at, null);
  });
}

for (const [name, age, expectedMerges] of [
  ["just before it expires", mergeQuestionLifetimeMilliseconds - 1, 1],
  ["once it expires", mergeQuestionLifetimeMilliseconds, 0],
]) {
  test(`a confirmation ${name}`, async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    const scenario = setup(context);
    scenario.deliverPreview();
    await validate(scenario);
    context.mock.timers.setTime(age);

    const result = await confirm(scenario);

    assert.equal(scenario.github.merges.length, expectedMerges);
    if (expectedMerges === 0) assertInvalidQuestion(result);
  });
}

for (const [name, age] of [
  ["while the question is valid", mergeQuestionLifetimeMilliseconds - 1],
  ["after expiry", mergeQuestionLifetimeMilliseconds],
]) {
  test(`validating again ${name} asks a new question and retires the old one`, async (context) => {
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    const scenario = setup(context);
    scenario.deliverPreview();
    await validate(scenario);
    context.mock.timers.setTime(age);
    scenario.telegram.messageIdentifier = 901;

    await validate(scenario, { updateIdentifier: 22 });

    assert.equal(scenario.attempts.length, 2);
    assertInvalidQuestion(await confirm(scenario, { updateIdentifier: 23 }));
    assert.deepEqual(scenario.github.merges, []);
    await confirm(scenario, {
      updateIdentifier: 24,
      replyMessageIdentifier: 901,
    });
    assert.deepEqual(scenario.github.merges, [
      { number: pullRequestNumber, sha: commit },
    ]);
  });
}

test("a used confirmation repeated after the lifetime was already handled", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);
  await confirm(scenario);
  context.mock.timers.setTime(mergeQuestionLifetimeMilliseconds);

  assertAlreadyHandled(await confirm(scenario, { updateIdentifier: 22 }));
  assert.equal(scenario.github.merges.length, 1);
});

test("a question with an unreadable date never merges", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);
  const database = openDatabase(scenario.storePath);
  database.exec("UPDATE merge_questions SET created_at = 'unreadable'");
  database.close();

  assertInvalidQuestion(await confirm(scenario));
  assert.deepEqual(scenario.github.merges, []);
});

test("another member's reply leaves the question for the member it was fixed to", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);

  await confirm(scenario, { authorIdentifier: 556 });
  assert.deepEqual(scenario.github.merges, []);
  assert.equal(storedQuestion(scenario).consumed_at, null);

  const result = await confirm(scenario);

  assert.equal(result.report, mergeReports.merged(mergedTarget));
  assert.deepEqual(scenario.github.merges, [
    { number: pullRequestNumber, sha: commit },
  ]);
});

for (const [name, prepare, expected] of [
  [
    "the notice is replaced",
    (scenario) =>
      scenario.deliverPreview(
        deliveredPreviewRow({ notice: 801, publicationUpdate: 13 }),
      ),
    mergeReports.staleQuestion,
  ],
  [
    "the delivered commit changes",
    (scenario) =>
      scenario.deliverPreview(
        deliveredPreviewRow({ commitSha: "c".repeat(40) }),
      ),
    mergeReports.staleQuestion,
  ],
  [
    "instructions arrive after the question",
    (scenario) => {
      scenario.intervening.value = true;
    },
    mergeReports.staleQuestion,
  ],
  [
    "the pull request changes infrastructure",
    (scenario) => {
      scenario.github.changedPaths = ["apps/web/package.json"];
    },
    mergeReports.infrastructureChanges({ reviewUrl }),
  ],
  [
    "the changed files cannot be read",
    (scenario) => {
      scenario.github.changedPathsError = new Error("network");
    },
    mergeReports.unreadable(target),
  ],
  [
    "the preview label is removed",
    (scenario) => {
      scenario.github.pullRequest = openPullRequest({ previewLabeled: false });
    },
    mergeReports.noPreviewLabel(target),
  ],
  [
    "the preview is revoked",
    (scenario) => {
      scenario.github.pullRequest = openPullRequest({ previewRevoked: true });
    },
    mergeReports.previewRevoked(target),
  ],
  [
    "the checks stop being green",
    (scenario) => {
      scenario.github.checkRuns = [
        { name: "Validate", status: "completed", conclusion: "failure" },
      ];
    },
    mergeReports.checksNotGreen(target),
  ],
  [
    "the head moves",
    (scenario) => {
      scenario.github.pullRequest = openPullRequest({
        headSha: "c".repeat(40),
      });
    },
    mergeReports.headMoved(target),
  ],
  [
    "newer work appears",
    (scenario) => {
      scenario.newerWork.value = true;
    },
    mergeReports.newerWork(target),
  ],
]) {
  test(`a confirmation is refused when ${name}`, async (context) => {
    const scenario = setup(context);
    scenario.deliverPreview();
    await validate(scenario);
    prepare(scenario);

    const result = await confirm(scenario);

    assert.equal(result.outcome, "merge_context");
    assert.equal(result.report, expected);
    assert.deepEqual(scenario.github.merges, []);
    assert.notEqual(storedQuestion(scenario).consumed_at, null);
  });
}

test("a confirmation with intervening instructions names the exact range", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);
  scenario.intervening.value = true;

  await confirm(scenario);

  assert.deepEqual(scenario.intervening.calls, [
    {
      sessionKey,
      afterUpdateIdentifier: 20,
      updateIdentifier: 21,
    },
  ]);
});

for (const [
  name,
  seedPrevious,
  expectedReport,
  expectedState,
  expectedDetail,
] of [
  [
    "a previous uncertain merge GitHub shows merged",
    (scenario) => {
      scenario.store.begin({
        updateIdentifier: 40,
        sessionKey,
        authorIdentifier: memberIdentifier,
        pullRequestNumber,
        commitSha: commit,
      });
      scenario.store.markUncertain(40);
      scenario.github.pullRequest = mergedPullRequest();
    },
    mergeReports.reconciled(mergedTarget),
    "merged",
  ],
  [
    "a previous uncertain merge GitHub shows open",
    (scenario) => {
      scenario.store.begin({
        updateIdentifier: 40,
        sessionKey,
        authorIdentifier: memberIdentifier,
        pullRequestNumber,
        commitSha: commit,
      });
      scenario.store.markUncertain(40);
    },
    mergeReports.uncertainOpen(target),
    "uncertain",
    new RegExp(`/merge ${pullRequestNumber} ${commit}`, "u"),
  ],
  [
    "a merge that is still running",
    (scenario) => {
      scenario.store.begin({
        updateIdentifier: 40,
        sessionKey,
        authorIdentifier: memberIdentifier,
        pullRequestNumber,
        commitSha: commit,
      });
    },
    mergeReports.alreadyInProgress(target),
    "merging",
  ],
]) {
  test(`the confirmation handles ${name} without merging again`, async (context) => {
    const scenario = setup(context);
    scenario.deliverPreview();
    await validate(scenario);
    seedPrevious(scenario);

    const result = await confirm(scenario);

    assert.equal(result.outcome, "merge_context");
    assert.equal(result.report, expectedReport);
    if (expectedDetail !== undefined) {
      assert.match(result.report, expectedDetail);
    }
    assert.equal(scenario.store.state(40), expectedState);
    assert.deepEqual(scenario.github.merges, []);
    assert.notEqual(storedQuestion(scenario).consumed_at, null);
  });
}

test("a restart keeps the question usable and never consumes it twice", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);
  assert.equal(storedQuestion(scenario).consumed_at, null);

  scenario.reopen();

  const result = await confirm(scenario);
  assert.equal(result.report, mergeReports.merged(mergedTarget));
  assert.deepEqual(scenario.github.merges, [
    { number: pullRequestNumber, sha: commit },
  ]);

  scenario.reopen();
  const repeated = await confirm(scenario, { updateIdentifier: 22 });

  assertAlreadyHandled(repeated);
  assert.deepEqual(scenario.github.merges, [
    { number: pullRequestNumber, sha: commit },
  ]);
  assert.notEqual(storedQuestion(scenario).consumed_at, null);
});

test("re-verifies membership at confirmation and leaves the question unconsumed when denied", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);
  const readsAfterValidation = scenario.github.reads;

  scenario.membership.result = {
    verified: false,
    reason: "not_a_group_member",
  };
  const revoked = await confirm(scenario, { updateIdentifier: 21 });
  assert.equal(revoked.outcome, "merge_context");
  assert.equal(revoked.report, mergeReports.membershipRevoked);
  assert.equal(scenario.github.reads, readsAfterValidation);
  assert.deepEqual(scenario.github.merges, []);
  assert.equal(storedQuestion(scenario).consumed_at, null);

  scenario.membership.result = {
    verified: false,
    reason: "membership_check_failed",
  };
  const unavailable = await confirm(scenario, { updateIdentifier: 22 });
  assert.equal(unavailable.outcome, "merge_context");
  assert.equal(unavailable.report, mergeReports.membershipUnavailable);
  assert.equal(scenario.github.reads, readsAfterValidation);
  assert.deepEqual(scenario.github.merges, []);
  assert.equal(storedQuestion(scenario).consumed_at, null);

  scenario.membership.result = { verified: true, status: "member" };
  const retried = await confirm(scenario, {
    updateIdentifier: 23,
    instruction: "si, produccio",
  });
  assert.equal(retried.outcome, "merge_context");
  assert.equal(retried.report, mergeReports.merged(mergedTarget));
  assert.deepEqual(scenario.github.merges, [
    { number: pullRequestNumber, sha: commit },
  ]);
  assert.notEqual(storedQuestion(scenario).consumed_at, null);
});

test("refuses cleanly on GitHub read errors during validation and confirmation", async (context) => {
  const validationScenario = setup(context);
  validationScenario.deliverPreview();
  validationScenario.github.readError = new Error("network");

  const validationResult = await validate(validationScenario);
  assert.deepEqual(validationResult, { outcome: "merge_context" });
  assert.equal(validationScenario.attempts.length, 0);
  assert.equal(storedQuestion(validationScenario), undefined);

  const confirmScenario = setup(context);
  confirmScenario.deliverPreview();
  await validate(confirmScenario);
  confirmScenario.github.readError = new Error("network");

  const confirmResult = await confirm(confirmScenario);
  assert.equal(confirmResult.outcome, "merge_context");
  assert.equal(confirmResult.report, mergeReports.unreadable(target));
  assert.deepEqual(confirmScenario.github.merges, []);
  assert.notEqual(storedQuestion(confirmScenario).consumed_at, null);
});

test("refuses confirmation when the pull request is already merged", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);
  scenario.github.pullRequest = mergedPullRequest();

  const result = await confirm(scenario);

  assert.equal(result.outcome, "merge_context");
  assert.equal(result.report, mergeReports.alreadyMerged(mergedTarget));
  assert.deepEqual(scenario.github.merges, []);
  assert.notEqual(storedQuestion(scenario).consumed_at, null);
});

test("records private trace actions without conversation text", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();

  await validate(scenario);
  await confirm(scenario, { instruction: "sí, Produccio" });

  assert.deepEqual(
    scenario.traces.map((entry) => entry.action),
    [
      "merge_question_asked",
      "merge_confirmation_used",
      "merge_membership_verified",
      "merge_requested",
      "merge_completed",
    ],
  );
  for (const entry of scenario.traces) {
    assert.equal(
      entry.detail.toLowerCase().includes("validada"),
      false,
      entry.detail,
    );
    assert.equal(
      entry.detail.toLowerCase().includes("produccio"),
      false,
      entry.detail,
    );
  }
});

test("validating a behind branch synchronises without the old question", async (context) => {
  const scenario = setup(context, {
    github: mergeGithub({
      pullRequest: openPullRequest({
        mergeableState: "behind",
        headRef: "work",
      }),
    }),
  });
  scenario.deliverPreview();

  const result = await validate(scenario);

  assert.deepEqual(result, {
    ...scenario.synchronization.result,
    outcome: "merge_context",
  });
  assert.equal(scenario.attempts.length, 0);
  assert.equal(storedQuestion(scenario), undefined);
  assert.deepEqual(scenario.github.merges, []);
  assert.deepEqual(
    scenario.synchronization.calls.map((call) => call.target),
    [{ pullRequestNumber, commit, branch: "work" }],
  );
});

for (const [name, prepare] of [
  [
    "a non-member",
    (scenario) => {
      scenario.membership.result = { verified: false, reason: "not_member" };
    },
  ],
  [
    "newer work",
    (scenario) => {
      scenario.newerWork.value = true;
    },
  ],
  ["a reply to another message", () => {}],
]) {
  test(`validating a behind branch as ${name} never synchronises`, async (context) => {
    const scenario = setup(context, {
      github: mergeGithub({
        pullRequest: openPullRequest({ mergeableState: "behind" }),
      }),
    });
    scenario.deliverPreview();
    prepare(scenario);

    await validate(
      scenario,
      name === "a reply to another message"
        ? { replyMessageIdentifier: 801 }
        : {},
    );

    assert.deepEqual(scenario.synchronization.calls, []);
  });
}

test("validating an up to date branch still asks the question and never synchronises", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();

  await validate(scenario);

  assert.equal(scenario.attempts.length, 1);
  assert.deepEqual(scenario.synchronization.calls, []);
});

test("confirming after the branch fell behind synchronises instead of merging", async (context) => {
  const scenario = setup(context);
  scenario.deliverPreview();
  await validate(scenario);
  scenario.github.pullRequest = openPullRequest({
    mergeableState: "behind",
    headRef: "work",
  });

  const result = await confirm(scenario);

  assert.equal(result.outcome, "merge_context");
  assert.equal(result.report, scenario.synchronization.result.report);
  assert.equal(scenario.synchronization.calls.length, 1);
  assert.deepEqual(scenario.github.merges, []);
  assert.notEqual(storedQuestion(scenario).consumed_at, null);
});

for (const intent of ["validate", "confirm"]) {
  test(`${intent} preserves the unknown result of a synchronization push`, async (context) => {
    const scenario = setup(context);
    scenario.deliverPreview();
    if (intent === "confirm") await validate(scenario);
    scenario.github.pullRequest = openPullRequest({ mergeableState: "behind" });
    scenario.synchronization.result = {
      outcome: "uncertain",
      report: "Push no confirmat.",
    };

    const response = await (intent === "validate"
      ? validate(scenario)
      : confirm(scenario));

    assert.deepEqual(response, scenario.synchronization.result);
    assert.deepEqual(scenario.github.merges, []);
  });
}
