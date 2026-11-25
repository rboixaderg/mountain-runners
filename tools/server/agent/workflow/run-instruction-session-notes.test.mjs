import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  instructionReports,
  serviceNotesHeader,
} from "../policy/development.mjs";
import { runAgent } from "../runtime/agent.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import { SandboxCleanupError } from "../sandbox/errors.mjs";
import { publicationGithub } from "./test-support/github.mjs";
import {
  fixture,
  configFor,
  topicSessionKey,
  promptOf,
  noteStore,
  request,
} from "./test-support/run-instruction.mjs";

const otherSessionKey = "-1009999999999:3";

test("prepends the service events of the topic once", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const report =
    "Pull request creada: https://github.com/rboixaderg/mountain-runners/pull/200";
  notes.addNote({ sessionKey: topicSessionKey, text: report });
  notes.addNote({ sessionKey: otherSessionKey, text: "Un altre tema." });
  const messages = [];
  const runner = createTestProjectRunner({
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
    executeAgent: async (_config, options) => {
      messages.push(promptOf(options));
      return { text: "Resposta." };
    },
  });

  await runner(request());
  await runner(request({ updateIdentifier: 1002 }));

  assert.equal(messages.length, 2);
  assert.match(messages[0], new RegExp(serviceNotesHeader, "u"));
  assert.match(messages[0], /pull\/200/u);
  assert.doesNotMatch(messages[0], /Un altre tema/u);
  assert.ok(
    messages[0].indexOf(serviceNotesHeader) < messages[0].indexOf("Request:"),
    "the service events come before the request",
  );
  assert.doesNotMatch(
    messages[1],
    /Service events since your previous turn/u,
    "the same effect is never delivered twice",
  );
  assert.deepEqual(
    notes.claim(otherSessionKey).map((note) => note.text),
    ["Un altre tema."],
    "the events of another topic stay undelivered",
  );
});

test("keeps the service events of a preparation that failed", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({
    sessionKey: topicSessionKey,
    text: "Pull request creada: https://example.test/pull/200",
  });
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 1, timedOut: false }),
    executeAgent: async () => assert.fail("the model must not start"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.deepEqual(
    notes.claim(topicSessionKey).map((note) => note.text),
    [
      "Pull request creada: https://example.test/pull/200",
      instructionReports.preparationFailed,
    ],
    "a turn that never started returns its events",
  );
});

// T8.7 review round 1: the operational sequences of the pilot, the note
// lifecycle and the provenance of everything the session receives.

test("keeps the service events when the sandbox preparation runs out of time", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: -1, timedOut: true }),
    executeAgent: async () => assert.fail("the model must not start"),
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.modelTimedOut);
  const undelivered = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    undelivered[0],
    "Efecte pendent.",
    "a turn that never started keeps the effect undelivered",
  );
  assert.equal(
    undelivered.includes(instructionReports.modelTimedOut),
    true,
    "the failure of the turn is its own effect",
  );
});

test("never returns the service events once the model received them", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const prompts = [];
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      prompts.push(promptOf(options));
      throw new Error("the sandbox cleanup failed after the turn");
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.match(
    prompts[0],
    /Efecte pendent/u,
    "the prompt that reached Pi carried the effect",
  );
  const remaining = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    remaining.includes("Efecte pendent."),
    false,
    "a failure after the prompt is never a redelivery",
  );
});

test("carries the question of the model into the next turn of the same session", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  const prompts = [];
  let turn = 0;
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (_config, options) => {
      prompts.push({ ...options, message: promptOf(options) });
      turn += 1;
      if (turn === 1) {
        return { text: "Quins són els fets de la notícia?" };
      }
      return { text: "Gràcies, ja els tinc." };
    },
    runChecks: async () => assert.fail("the model changed no file"),
  });

  const first = await runner(request());
  const facts = "els fets són: 42 participants i 18 km";
  const second = await runner(
    request({ updateIdentifier: 1002, instruction: facts }),
  );

  assert.equal(first.outcome, "answered");
  assert.equal(first.report, "Quins són els fets de la notícia?");
  assert.equal(second.outcome, "answered");
  assert.equal(second.report, "Gràcies, ja els tinc.");
  assert.equal(
    prompts[0].sessionIdentifier,
    prompts[1].sessionIdentifier,
    "both turns belong to the same Pi session",
  );
  assert.match(
    prompts[1].message,
    new RegExp(facts, "u"),
    "the facts reach the model",
  );
});

test("keeps the service events when the Pi profile cannot be prepared", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  // A file where the profile root belongs: the runtime fails before it claims
  // anything, so no prompt ever existed.
  writeFileSync(join(paths.state, "profiles"), "not a directory");
  const runner = createTestProjectRunner({
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  assert.equal(
    notes.claim(topicSessionKey).map((note) => note.text)[0],
    "Efecte pendent.",
    "an effect is never consumed by a turn that never started",
  );
});

test("keeps the service events when the turn stops before the prompt", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const controller = new AbortController();
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github: publicationGithub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (config, options) => {
      // The stop arrives while the runtime prepares the profile: the prompt is
      // never sent.
      controller.abort();
      return runAgent(config, options);
    },
  });

  const result = await runner(request(), { signal: controller.signal });

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.aborted);
  assert.equal(
    notes.claim(topicSessionKey).map((note) => note.text)[0],
    "Efecte pendent.",
    "a stopped turn keeps the effect undelivered",
  );
});

test("keeps the service events when Pi never starts", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const config = configFor(paths);
  const runner = createTestProjectRunner({
    config: {
      ...config,
      model: {
        ...config.model,
        piCommand: join(paths.directory, "missing-pi"),
      },
      paths: { ...config.paths, sessions: join(paths.directory, "sessions") },
    },
    github: publicationGithub(),
    sessionNotes: notes,
    // The sandbox cleanup is not what this test checks: it runs no container.
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    stopCommands: async () => {},
  });

  const result = await runner(request());

  assert.equal(result.outcome, "failed");
  const undelivered = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    undelivered[0],
    "Efecte pendent.",
    "a process that never started never received the prompt",
  );
  assert.equal(
    undelivered.includes(instructionReports.executionFailed),
    true,
    "the failed turn is its own effect",
  );
});

test("keeps the service events when Pi never starts and the cleanup also fails", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const config = configFor(paths);
  const runner = createTestProjectRunner({
    config: {
      ...config,
      model: {
        ...config.model,
        piCommand: join(paths.directory, "missing-pi"),
      },
      paths: { ...config.paths, sessions: join(paths.directory, "sessions") },
    },
    github: publicationGithub(),
    sessionNotes: notes,
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    // The cleanup that runs after a failed launch also fails: the launch fact
    // must survive it.
    stopCommands: async () => {
      throw new SandboxCleanupError({ cause: new Error("podman is down") });
    },
  });

  const result = await runner(request());

  assert.equal(result.outcome, "uncertain");
  assert.equal(result.report, instructionReports.sandboxUncertain);
  const undelivered = notes.claim(topicSessionKey).map((note) => note.text);
  assert.equal(
    undelivered[0],
    "Efecte pendent.",
    "no prompt reached Pi, whatever error wins after the launch",
  );
});

test("keeps the service events when the turn stops before the prompt is written", async (context) => {
  const paths = await fixture(context);
  const notes = noteStore(context, paths);
  notes.addNote({ sessionKey: topicSessionKey, text: "Efecte pendent." });
  const config = configFor(paths);
  const controller = new AbortController();
  const runner = createTestProjectRunner({
    config: {
      ...config,
      // A real executable: the child exists, and the prompt must still not be
      // written.
      model: { ...config.model, piCommand: process.execPath },
      paths: { ...config.paths, sessions: join(paths.directory, "sessions") },
    },
    github: publicationGithub(),
    sessionNotes: notes,
    stopCommands: async () => {},
    executeSandbox: async () => ({ exitCode: 0, timedOut: false }),
    executeAgent: async (agentConfig, options) =>
      runAgent(agentConfig, {
        ...options,
        // The stop is queued while the prompt is built: it lands after the
        // claim and before the runtime writes the prompt.
        buildMessage: (serviceNotes) => {
          queueMicrotask(() => controller.abort());
          return options.buildMessage(serviceNotes);
        },
      }),
  });

  const result = await runner(request(), { signal: controller.signal });

  assert.equal(result.outcome, "failed");
  assert.equal(result.report, instructionReports.aborted);
  assert.equal(
    notes.claim(topicSessionKey).map((note) => note.text)[0],
    "Efecte pendent.",
    "a prompt that was never written never reached Pi",
  );
});
