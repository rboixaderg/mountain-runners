import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  createDisclosureApprovals,
  disclosureApprovalReply,
  disclosureCancellationReply,
} from "./disclosure-approvals.mjs";

const question = {
  sessionKey: "-100123:7",
  authorIdentifier: 42,
  questionMessageIdentifier: 900,
  operation: "read",
  destination: "https://example.test",
  input: "https://example.test/page?signature=synthetic&name=example",
};

function reply(overrides = {}) {
  return {
    sessionKey: question.sessionKey,
    authorIdentifier: question.authorIdentifier,
    replyMessageIdentifier: question.questionMessageIdentifier,
    instruction: disclosureApprovalReply,
    ...overrides,
  };
}

test("an exact attributed reply consumes only the immutable request offered", () => {
  const approvals = createDisclosureApprovals();
  const offered = { ...question };
  assert.equal(approvals.offer(offered), true);
  offered.operation = "search";
  offered.destination = "https://other.example.test";
  offered.input = "changed query";

  const result = approvals.take({
    ...reply(),
    operation: offered.operation,
    destination: offered.destination,
    input: offered.input,
  });
  assert.deepEqual(result, {
    operation: "read",
    destination: "https://example.test",
    input: "https://example.test/page?signature=synthetic&name=example",
  });
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => (result.input = "changed"), TypeError);
  assert.equal(approvals.take(reply()), null);
  assert.equal(approvals.offer(question), false);
  assert.equal(approvals.take(reply()), null);
});

test("only the exact fixed reply from the original author and topic approves", () => {
  const approvals = createDisclosureApprovals();
  assert.equal(approvals.offer(question), true);
  for (const instruction of [
    "Sí",
    "Si, envia-ho",
    "sí, envia-ho",
    "Sí, envia-ho ara",
    " Sí, envia-ho",
    "Cancel·la l’enviament",
  ]) {
    assert.equal(approvals.take(reply({ instruction })), null, instruction);
  }
  for (const mismatch of [
    { sessionKey: "-100123:8" },
    { authorIdentifier: 43 },
    { replyMessageIdentifier: 901 },
    { replyMessageIdentifier: undefined },
    { replyMessageIdentifier: 900n },
  ]) {
    assert.equal(approvals.take(reply(mismatch)), null);
  }
  assert.equal(approvals.take(reply()).input, question.input);
});

test("the same message identifier is isolated by topic and author", () => {
  const approvals = createDisclosureApprovals();
  assert.equal(approvals.offer(question), true);
  assert.equal(
    approvals.offer({ ...question, sessionKey: "-100123:8", input: "topic" }),
    true,
  );
  assert.equal(
    approvals.offer({ ...question, authorIdentifier: 43, input: "author" }),
    true,
  );
  assert.equal(
    approvals.take(reply({ sessionKey: "-100123:8" })).input,
    "topic",
  );
  assert.equal(approvals.take(reply({ authorIdentifier: 43 })).input, "author");
  assert.equal(approvals.take(reply()).input, question.input);
});

test("a new question invalidates the previous request and cannot rearm it", () => {
  const approvals = createDisclosureApprovals();
  assert.equal(approvals.offer(question), true);
  assert.equal(
    approvals.offer({
      ...question,
      questionMessageIdentifier: 901,
      operation: "search",
      destination: "Brave Search",
      input: "a changed query",
    }),
    true,
  );
  assert.equal(approvals.take(reply()), null);
  assert.equal(approvals.offer(question), false);
  assert.deepEqual(approvals.take(reply({ replyMessageIdentifier: 901 })), {
    operation: "search",
    destination: "Brave Search",
    input: "a changed query",
  });
});

test("reoffering a question with a changed request fails closed", () => {
  const approvals = createDisclosureApprovals();
  assert.equal(approvals.offer(question), true);
  assert.equal(approvals.offer({ ...question, input: "changed query" }), false);
  assert.equal(approvals.take(reply()), null);
});

test("the exact cancellation consumes the offer and cannot be replayed", () => {
  const approvals = createDisclosureApprovals();
  assert.equal(approvals.offer(question), true);
  assert.equal(
    approvals.take(reply({ instruction: disclosureCancellationReply })),
    null,
  );
  assert.equal(approvals.take(reply()), null);
  assert.equal(approvals.offer(question), false);
  assert.equal(approvals.take(reply()), null);
});

test("offers expire at five minutes and a new instance starts empty", () => {
  let time = 1_000;
  const approvals = createDisclosureApprovals({ now: () => time });
  assert.equal(approvals.offer(question), true);
  assert.equal(
    createDisclosureApprovals({ now: () => time }).take(reply()),
    null,
  );
  time += 5 * 60 * 1000 - 1;
  assert.equal(approvals.take(reply()).input, question.input);

  assert.equal(
    approvals.offer({ ...question, questionMessageIdentifier: 901 }),
    true,
  );
  time += 5 * 60 * 1000;
  assert.equal(approvals.take(reply({ replyMessageIdentifier: 901 })), null);
});

test("the default expiry follows elapsed time despite wall-clock changes", (context) => {
  let wallTime = 1_000_000;
  let elapsedTime = 1_000;
  context.mock.method(Date, "now", () => wallTime);
  context.mock.method(performance, "now", () => elapsedTime);
  const backwardJump = createDisclosureApprovals();
  assert.equal(backwardJump.offer(question), true);

  wallTime += 24 * 60 * 60 * 1000;
  elapsedTime += 1;

  wallTime = 1_010_000;
  elapsedTime = 301_000;
  assert.equal(backwardJump.take(reply()), null);

  const forwardJump = createDisclosureApprovals();
  assert.equal(forwardJump.offer(question), true);
  wallTime += 24 * 60 * 60 * 1000;
  elapsedTime += 1;
  assert.equal(forwardJump.take(reply()).input, question.input);
});

test("a clock moving backwards invalidates pending requests", () => {
  let time = 1_000;
  const approvals = createDisclosureApprovals({ now: () => time });
  assert.equal(approvals.offer(question), true);
  time -= 1;
  assert.equal(approvals.take(reply()), null);
});

test("capacity counts consumed questions and expiry frees space", () => {
  let time = 1_000;
  const approvals = createDisclosureApprovals({ now: () => time });
  for (let identifier = 1; identifier <= 100; identifier += 1) {
    assert.equal(
      approvals.offer({ ...question, questionMessageIdentifier: identifier }),
      true,
    );
  }
  assert.equal(
    approvals.take(reply({ replyMessageIdentifier: 100 })).input,
    question.input,
  );
  assert.equal(
    approvals.offer({ ...question, questionMessageIdentifier: 101 }),
    false,
  );
  time += 5 * 60 * 1000;
  assert.equal(
    approvals.offer({ ...question, questionMessageIdentifier: 101 }),
    true,
  );
  assert.equal(
    approvals.take(reply({ replyMessageIdentifier: 101 })).input,
    question.input,
  );
});

test("oversized or non-string payloads fail closed and invalidate prior offers", () => {
  for (const invalidInput of ["é".repeat(8193), { url: "example" }]) {
    const approvals = createDisclosureApprovals();
    assert.equal(approvals.offer(question), true);
    assert.equal(
      approvals.offer({
        ...question,
        questionMessageIdentifier: 901,
        input: invalidInput,
      }),
      false,
    );
    assert.equal(approvals.take(reply()), null);
  }
  const approvals = createDisclosureApprovals();
  assert.equal(
    approvals.offer({ ...question, questionMessageIdentifier: 0 }),
    false,
  );
  assert.equal(approvals.offer({ ...question, authorIdentifier: 0 }), false);
  assert.equal(approvals.offer({ ...question, sessionKey: "" }), false);
});
