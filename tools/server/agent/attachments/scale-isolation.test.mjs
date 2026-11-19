// Optional real-sandbox contract for the downscale path (T8.8).
//
// It needs Linux with rootless Podman and a local image that already carries
// the offline pnpm store, exactly like the installed service. Without
// MR_ISOLATION_TEST_IMAGE it is skipped, also in ordinary CI.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { sandboxPrepareCommand } from "../policy/development.mjs";
import {
  runSandboxedCommand,
  stopSandboxedCommands,
} from "../sandbox/commands.mjs";
import { scaleImageAttachments } from "./scale.mjs";

const image = process.env.MR_ISOLATION_TEST_IMAGE;
const repositoryPath = realpathSync(new URL("../../../..", import.meta.url));

const limits = {
  sandboxProcessLimit: 64,
  sandboxMemoryMegabytes: 2048,
  sandboxCpuCount: 1,
  executionTimeoutMs: 5 * 60 * 1000,
};

function workspaceFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "mr-agent-scale-isolation-"));
  const worktreeRoot = join(directory, "worktrees");
  const workspace = join(worktreeRoot, "topic-0123456789abcdef");
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return { worktreeRoot, workspace };
}

test(
  "downscales a real image inside the sandbox with the offline dependency store",
  { skip: !image, timeout: 10 * 60 * 1000 },
  async (context) => {
    const { worktreeRoot, workspace } = workspaceFixture(context);
    for (const file of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ]) {
      cpSync(join(repositoryPath, file), join(workspace, file));
    }
    for (const directory of ["apps/web", "packages/telegram-pi-bridge"]) {
      mkdirSync(join(workspace, directory), { recursive: true });
      cpSync(
        join(repositoryPath, directory, "package.json"),
        join(workspace, directory, "package.json"),
      );
    }
    const sessionIdentifier = "topic-0123456789abcdef";
    context.after(() => stopSandboxedCommands(sessionIdentifier));

    // sharp needs real pixel data; the synthetic header fixtures are not a
    // decodable image. The repository already installs sharp for apps/web.
    const sharp = createRequire(join(repositoryPath, "apps/web/package.json"))(
      "sharp",
    );
    const original = await sharp({
      create: {
        width: 3000,
        height: 2000,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const result = await scaleImageAttachments({
      worktreePath: workspace,
      images: [
        {
          type: "png",
          mimeType: "image/png",
          extension: ".png",
          width: 3000,
          height: 2000,
          bytes: original,
          origin: "message",
        },
      ],
      prepareCommand: sandboxPrepareCommand,
      execute: (command, { signal }) =>
        runSandboxedCommand({
          image,
          workspacePath: workspace,
          worktreeRoot,
          command,
          limits,
          sessionIdentifier,
          timeoutMilliseconds: limits.executionTimeoutMs,
          signal,
        }),
    });

    assert.equal(result.refusal, undefined, JSON.stringify(result.refusal));
    assert.equal(result.images[0].width, 2400);
    assert.equal(result.images[0].height, 1600);
  },
);
