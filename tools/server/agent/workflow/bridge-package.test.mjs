// The VPS has no workspace symlink: the installed service must resolve the
// bridge from the `node_modules` directory beside it.
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const executeFile = promisify(execFile);
const packageSource = fileURLToPath(
  new URL("../../../../packages/telegram-pi-bridge/", import.meta.url),
);
const agentSource = fileURLToPath(new URL("../", import.meta.url));

test(
  "starts the service from the installed layout",
  { timeout: 60000 },
  async (context) => {
    const consumer = await mkdtemp(join(tmpdir(), "mr-agent-layout-"));
    context.after(() =>
      rm(consumer, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    );
    for (const entry of ["src", "package.json"]) {
      await cp(
        join(packageSource, entry),
        join(consumer, "node_modules", "telegram-pi-bridge", entry),
        { recursive: true },
      );
    }
    const installedAgent = join(consumer, "agent");
    await cp(agentSource, installedAgent, {
      recursive: true,
      filter: (path) => !path.endsWith(".test.mjs"),
    });
    await writeFile(
      join(consumer, "installed-layout.mjs"),
      `
    import assert from 'node:assert/strict';
    import {startService} from './agent/processes/telegram-bridge/main.mjs';
    import {preparePiProfile} from './agent/runtime/profile.mjs';
    import {join} from 'node:path';
    const root=process.cwd();
    const service=await startService({
      environment:{MOUNTAIN_AGENT_REPOSITORY:'example/repository',MOUNTAIN_AGENT_TELEGRAM_GROUP_ID:'-100',MOUNTAIN_AGENT_TELEGRAM_BOT_USERNAME:'example_bot',MOUNTAIN_AGENT_TELEGRAM_BOT_TOKEN:'synthetic-telegram',MOUNTAIN_AGENT_GITHUB_TOKEN:'synthetic-github',MOUNTAIN_AGENT_REQUIRED_CHECKS:'Validate',MOUNTAIN_AGENT_SANDBOX_IMAGE:'synthetic:1',MOUNTAIN_AGENT_REPOSITORY_PATH:join(root,'repository'),MOUNTAIN_AGENT_WORKTREE_PATH:join(root,'worktrees'),MOUNTAIN_AGENT_SESSION_PATH:join(root,'sessions'),MOUNTAIN_AGENT_STATE_PATH:join(root,'state')},
      telegram:{async getMe(){return {id:999,username:'example_bot'};}},github:{},runner:async()=>({outcome:'answered',report:'ok'}),
    });
    service.ciWatches.close();
    service.queue.close();
    const profile=await preparePiProfile({profileRoot:join(root,'profiles'),profileIdentifier:'topic-0123456789abcdef'});
    assert.ok(profile);
  `,
    );
    await executeFile(process.execPath, ["installed-layout.mjs"], {
      cwd: consumer,
      env: { PATH: process.env.PATH, HOME: consumer, TMPDIR: consumer },
    });
  },
);
