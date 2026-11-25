// The temporary installation the instruction runner tests share.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionNoteStore } from "../../repository/session-note-store.mjs";
import { createTestProjectRunner } from "./project-runner.mjs";
import { openIdentifierNames } from "../../repository/identifiers.mjs";
import {
  createGitRepository,
  git,
} from "../../repository/test-support/git-repository.mjs";

export async function fixture(context, { ignoreAttachments = true } = {}) {
  const { directory, repository } = await createGitRepository(
    context,
    "mr-agent-job-",
    {
      "README.md": "synthetic\n",
      ...(ignoreAttachments && { ".gitignore": ".agent-attachments/\n" }),
    },
  );

  return {
    directory,
    repository,
    worktrees: join(directory, "worktrees"),
    state: join(directory, "state"),
  };
}

export function configFor(paths) {
  return {
    telegram: { botToken: "telegram-secret" },
    github: {
      token: "github-secret",
      repository: "rboixaderg/mountain-runners",
    },
    model: {
      sandboxImage: "mountain-agent-pi:1.5.0",
      providerEnvironment: {},
    },
    paths: {
      repository: paths.repository,
      worktrees: paths.worktrees,
      state: paths.state,
    },
    limits: {
      executionTimeoutMs: 60000,
      sandboxProcessLimit: 64,
      sandboxMemoryMegabytes: 256,
      sandboxCpuCount: 1,
    },
  };
}

export const topicSessionKey = "-1001234567890:7";

/** The installation names of the fixture: the runner reads the same salt file. */
export function identifiersFor(paths) {
  return openIdentifierNames(paths.state);
}

export function topicWorktreePath(paths, sessionKey = topicSessionKey) {
  return join(paths.worktrees, identifiersFor(paths).worktreeName(sessionKey));
}

/**
 * The prompt the injected runtime would send: the real adapter claims the
 * effects of the topic, reports that it is about to write the prompt and builds
 * the message with them, so a test does the same in that order.
 */
export function promptOf(options) {
  const serviceNotes = options.claimServiceNotes();
  options.onPromptSent();
  return options.buildMessage(serviceNotes);
}

/** The durable conversation state of the fixture: real SQLite, temporary file. */
export function noteStore(context, paths) {
  mkdirSync(paths.state, { recursive: true });
  const store = new SessionNoteStore(join(paths.state, "session-notes.sqlite"));
  context.after(() => store.close());
  return store;
}

export function request(overrides = {}) {
  return {
    updateIdentifier: 1001,
    messageIdentifier: 2001,
    sessionKey: "-1001234567890:7",
    authorIdentifier: 42,
    instruction: "afegeix una prova sintètica",
    ...overrides,
  };
}

export async function publishedWorktree(context, paths, github, ciWatches) {
  const runner = createTestProjectRunner({
    config: configFor(paths),
    github,
    ciWatches,
    runModel: async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, "change.txt"), "canvi\n");
      return { text: "Canvi fet.\nSUMMARY: feat(tools): add synthetic change" };
    },
    runChecks: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });
  await runner(request());
  return git(topicWorktreePath(paths), ["rev-parse", "HEAD"]);
}

export function attachmentRequest(overrides = {}) {
  return request({
    instruction: "usa la imatge adjunta a la portada",
    attachments: [
      {
        fileIdentifier: "telegram-file",
        fileUniqueIdentifier: "telegram-unique-file",
        fileName: "Portada.PNG",
        mimeType: "image/png",
        fileSize: 1200000,
        origin: "message",
      },
    ],
    ...overrides,
  });
}

export function telegramAttachment(bytes) {
  return {
    async getFile() {
      return { file_id: "telegram-file", file_path: "documents/file_1.png" };
    },
    async downloadFile() {
      return bytes;
    },
  };
}

export async function advanceMain(paths, path, content) {
  writeFileSync(join(paths.repository, path), content);
  await git(paths.repository, ["add", path]);
  await git(paths.repository, ["commit", "-m", `chore: advance ${path}`]);
  await git(join(paths.directory, "origin.git"), [
    "fetch",
    paths.repository,
    "+refs/heads/main:refs/heads/main",
  ]);
  return git(paths.repository, ["rev-parse", "HEAD"]);
}
