import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { AdmissionQueue } from "telegram-pi-bridge/sessions";
import { AgentBridge } from "telegram-pi-bridge/telegram";
import { GitHubTrust } from "../repository/github.mjs";
import { createProjectRunner } from "./project-runner.mjs";

const executeFile = promisify(execFile);
const repository = "rboixaderg/mountain-runners";
const githubToken = "ghp_synthetic_journey_token";
const groupIdentifier = "-1001234567890";
const botUsername = "mountain_agent_bot";
const botIdentifier = 999;

async function git(directory, argumentsList) {
  const { stdout } = await executeFile("git", [
    "-C",
    directory,
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.test",
    ...argumentsList,
  ]);
  return stdout.trim();
}

async function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-journey-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const origin = join(directory, "origin.git");
  const clone = join(directory, "repository");
  await executeFile("git", ["init", "--bare", "--initial-branch=main", origin]);
  await executeFile("git", ["clone", origin, clone]);
  writeFileSync(join(clone, "README.md"), "synthetic\n");
  await git(clone, ["add", "README.md"]);
  await git(clone, ["commit", "-m", "chore: initial"]);
  await git(clone, ["push", "origin", "main"]);
  await git(clone, [
    "remote",
    "set-url",
    "origin",
    `https://github.com/${repository}.git`,
  ]);
  await git(clone, [
    "config",
    `url.${origin}.insteadOf`,
    `https://github.com/${repository}.git`,
  ]);

  return {
    directory,
    origin,
    repository: realpathSync(clone),
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
      providerEnvironmentVariables: [],
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

  const telegram = {
    batches: [[instructionUpdate()]],
    sent: [],
    async getUpdates() {
      return this.batches.shift() ?? [];
    },
    async getChatMember() {
      return { status: "member" };
    },
    async sendMessage({ chatIdentifier, messageThreadIdentifier, text }) {
      this.sent.push({ chatIdentifier, messageThreadIdentifier, text });
    },
  };

  const apiCalls = [];
  const github = new GitHubTrust({
    token: githubToken,
    repository,
    fetchImpl: async (url, options) => {
      apiCalls.push({ url, options });
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

  const runner = createProjectRunner({
    config,
    classifyRequest: async () => "implementation",
    github,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "journey.txt"), "synthetic change\n");
      return { text: "Fet.\nSUMMARY: feat(agent): reach a pull request" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  mkdirSync(paths.state, { recursive: true });
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
  assert.match(telegram.sent[1].text, /Comprovacions: pnpm check correcte/u);

  const branch = "feat/agent-reach-a-pull-request-500";
  assert.equal(
    await git(paths.origin, ["rev-parse", branch]),
    await git(join(paths.worktrees, "topic_n1001234567890_7"), [
      "rev-parse",
      "HEAD",
    ]),
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
      "- `journey.txt`",
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
