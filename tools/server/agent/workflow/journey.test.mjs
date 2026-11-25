import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { InspectableQueue as AdmissionQueue } from "../../../../packages/telegram-pi-bridge/test/inspectable-queue.mjs";
import { AgentBridge } from "telegram-pi-bridge/telegram";
import { CiWatchStore } from "../repository/ci-watch-store.mjs";
import { GitHubTrust } from "../repository/github.mjs";
import { openIdentifierNames } from "../repository/identifiers.mjs";
import { savedNotice } from "../policy/development.mjs";
import { createTestProjectRunner } from "./test-support/project-runner.mjs";
import {
  createGitRepository,
  git,
  useGitHubRemote,
} from "../repository/test-support/git-repository.mjs";
import { telegramStub } from "../../../../packages/telegram-pi-bridge/test/telegram-stub.mjs";

const repository = "rboixaderg/mountain-runners";
const githubToken = "ghp_synthetic_journey_token";
const groupIdentifier = "-1001234567890";
const botUsername = "mountain_agent_bot";
const botIdentifier = 999;

async function fixture(context) {
  const paths = await createGitRepository(context, "mr-agent-journey-");
  await useGitHubRemote(paths, repository);
  const { directory, origin, repository: clone } = paths;

  return {
    directory,
    origin,
    repository: clone,
    worktrees: join(directory, "worktrees"),
    state: join(directory, "state"),
    sessions: join(directory, "sessions"),
  };
}

function configFor(paths) {
  return {
    telegram: {
      botToken: "telegram-synthetic-token",
      groupIdentifier,
      botUsername,
    },
    github: { token: githubToken, repository },
    model: {
      sandboxImage: "mountain-agent-pi:1.5.0",
      providerEnvironment: {},
    },
    paths: {
      repository: paths.repository,
      worktrees: paths.worktrees,
      state: paths.state,
      sessions: paths.sessions,
    },
    limits: {
      maxPendingInstructions: 10,
      executionTimeoutMs: 60000,
      sandboxProcessLimit: 64,
      sandboxMemoryMegabytes: 256,
      sandboxCpuCount: 1,
    },
  };
}

function instructionUpdate() {
  return {
    update_id: 500,
    message: {
      message_id: 1500,
      chat: { id: -1001234567890, type: "supergroup" },
      from: { id: 42, is_bot: false },
      is_topic_message: true,
      message_thread_id: 7,
      text: `@${botUsername} afegeix una prova sintètica`,
      entities: [
        { type: "mention", offset: 0, length: botUsername.length + 1 },
      ],
    },
  };
}

test("a natural request reaches a pull request from Telegram", async (context) => {
  const paths = await fixture(context);
  const config = configFor(paths);

  const telegram = telegramStub({ batches: [[instructionUpdate()]] });

  const apiCalls = [];
  const github = new GitHubTrust({
    token: githubToken,
    repository,
    fetchImpl: async (url, options) => {
      apiCalls.push({ url, options });
      if (String(url).endsWith("/git/ref/heads/main")) {
        const base = await git(paths.repository, ["rev-parse", "origin/main"]);
        return { ok: true, json: async () => ({ object: { sha: base } }) };
      }
      if (options.method === "GET") {
        return { ok: true, json: async () => [] };
      }
      return {
        ok: true,
        json: async () => ({
          number: 200,
          html_url: `https://github.com/${repository}/pull/200`,
          head: { sha: "synthetic" },
          draft: false,
          base: { ref: "main" },
        }),
      };
    },
  });

  mkdirSync(paths.state, { recursive: true });
  const ciWatches = new CiWatchStore(join(paths.state, "ci-watch.sqlite"));
  context.after(() => ciWatches.close());
  const runner = createTestProjectRunner({
    config,
    github,
    ciWatches,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "journey.txt"), "synthetic change\n");
      return { text: "Fet.\nSUMMARY: feat(agent): reach a pull request" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  const queue = new AdmissionQueue(join(paths.state, "admission.sqlite"), {
    maxPending: 10,
  });
  context.after(() => queue.close());

  const bridge = new AgentBridge({
    groupIdentifier,
    botUsername,
    telegram,
    queue,
    runInstruction: (request) => runner(request),
    botIdentifier,
    pollTimeoutSeconds: 1,
  });

  await bridge.pollOnce();
  const executed = await bridge.executeNext();

  assert.notEqual(executed, null);
  assert.equal(queue.status(500), "done");
  assert.equal(queue.readOffset(), 501);

  assert.equal(telegram.sent.length, 2);
  assert.equal(telegram.sent[0].messageThreadIdentifier, 7);
  assert.equal(
    telegram.sent[0].text,
    'Instruction received. Working on "afegeix una prova sintètica". The result will arrive in this topic.',
  );
  assert.equal(telegram.sent[1].messageThreadIdentifier, 7);
  assert.match(
    telegram.sent[1].text,
    /https:\/\/github\.com\/rboixaderg\/mountain-runners\/pull\/200/u,
  );
  assert.match(telegram.sent[1].text, new RegExp(savedNotice, "u"));
  assert.doesNotMatch(telegram.sent[1].text, /SUMMARY|feat\(agent\)/u);
  assert.equal(ciWatches.pending().length, 1, "the CI notice is durable");

  const names = openIdentifierNames(paths.state);
  const branch = `feat/agent-reach-a-pull-request-${names.changeSuffix(500)}`;
  assert.equal(
    await git(paths.origin, ["rev-parse", branch]),
    await git(
      join(paths.worktrees, names.worktreeName(`${groupIdentifier}:7`)),
      ["rev-parse", "HEAD"],
    ),
  );

  const creation = apiCalls.find((call) => call.options.method === "POST");
  assert.notEqual(creation, undefined);
  assert.equal(
    creation.url,
    `https://api.github.com/repos/${repository}/pulls`,
  );
  assert.deepEqual(JSON.parse(creation.options.body), {
    title: "feat(agent): reach a pull request",
    body: [
      "## Objectiu",
      "",
      "feat(agent): reach a pull request",
      "",
      "## Canvis",
      "",
      "```",
      '"journey.txt"',
      "```",
      "",
      "## Validació",
      "",
      "- `pnpm check` correcte dins l'entorn aïllat.",
      "",
      "Aquesta pull request l'ha preparat l'agent privat de la fase 8 a partir d'una petició al grup privat. La revisió i el merge són humans.",
    ].join("\n"),
    head: branch,
    base: "main",
    draft: false,
  });

  const actions = queue.traceEntries().map((entry) => entry.action);
  assert.deepEqual(actions, ["instruction_accepted", "instruction_completed"]);
});
