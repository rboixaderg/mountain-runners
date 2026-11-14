// The extraction is real only if a separate consumer can use the archive and
// the service's installed layout resolves it without the workspace symlink.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const executeFile = promisify(execFile);
const packageSource = fileURLToPath(
  new URL("../../../../packages/telegram-pi-bridge/", import.meta.url),
);
const agentSource = fileURLToPath(new URL("../", import.meta.url));

const consumerSource = `
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdmissionQueue, sessionIdentifier } from 'telegram-pi-bridge/sessions';
import { AgentBridge, TelegramApi } from 'telegram-pi-bridge/telegram';
import { runPiPrompt } from 'telegram-pi-bridge/pi';
const directory = process.cwd();
const executable = join(directory, 'fake-pi');
writeFileSync(executable, '#!/usr/bin/env node\\n' +
  'if (!process.argv.includes("--no-tools") || !process.argv.includes("--no-extensions")) process.exit(2);\\n' +
  'process.stdin.once("data", () => { process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"independent answer"}]}})+"\\\\n"); process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false})+"\\\\n"); });\\n');
chmodSync(executable, 0o755);
assert.equal(typeof TelegramApi, 'function');
const queue = new AdmissionQueue(join(directory, 'queue.sqlite'), {maxPending:10});
const sent = [];
const update = {update_id:1,message:{message_id:2,chat:{id:-100,type:'supergroup'},from:{id:42,is_bot:false},is_topic_message:true,message_thread_id:7,text:'@example_bot hello',entities:[{type:'mention',offset:0,length:12}]}};
const telegram = {
  async getUpdates(){return [update];},
  async getChatMember(){return {status:'member'};},
  async sendMessage({chatIdentifier,messageThreadIdentifier,text}){sent.push({chatIdentifier,messageThreadIdentifier,text});},
};
const bridge = new AgentBridge({
  telegram, queue, groupIdentifier:'-100',botUsername:'example_bot',botIdentifier:999,
  async runInstruction(request, {signal}) {
    const profileDirectory = join(directory, 'profile');
    mkdirSync(profileDirectory);
    const result = await runPiPrompt({command:executable,model:'example/model',cwd:directory,profileDirectory,sessionIdentifier:sessionIdentifier(request.sessionKey),sessionDirectory:join(directory,'sessions'),message:request.instruction,timeoutMilliseconds:5000,signal});
    return {outcome:'answered',report:result.text};
  },
});
try {
  await bridge.pollOnce();
  await bridge.executeNext();
  assert.equal(queue.status(1),'done');
  assert.equal(queue.readOffset(),2);
  assert.deepEqual(sent,[{chatIdentifier:-100,messageThreadIdentifier:7,text:'Instruction received. Working on "hello". The result will arrive in this topic.'},{chatIdentifier:-100,messageThreadIdentifier:7,text:'independent answer'}]);
} finally {queue.close();}
`;

test(
  "runs the package suite outside the repository and consumes its tarball without GitHub or Docker",
  { timeout: 60000 },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "telegram-pi-package-"));
    context.after(() =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    );
    const standalone = join(directory, "standalone");
    await cp(packageSource, standalone, {
      recursive: true,
      filter: (path) => basename(path) !== "node_modules",
    });
    const binaries = join(directory, "bin");
    await mkdir(binaries);
    await symlink(process.execPath, join(binaries, "node"));
    // Only Node is discoverable: Git and Docker are not available to the consumer.
    const testEnvironment = {
      PATH: binaries,
      HOME: directory,
      TMPDIR: directory,
    };
    await executeFile(process.execPath, ["--test", "test/**/*.test.mjs"], {
      cwd: standalone,
      env: testEnvironment,
    });
    const manifest = JSON.parse(
      await readFile(join(standalone, "package.json"), "utf8"),
    );
    assert.equal(manifest.license, "MIT");
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(
      manifest.private,
      true,
      "publishing still requires an explicit decision",
    );

    // pnpm is an existing project tool; no install, registry lookup or lifecycle script.
    await executeFile(
      "pnpm",
      ["--dir", standalone, "pack", "--pack-destination", directory],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          COREPACK_ENABLE_NETWORK: "0",
          npm_config_ignore_scripts: "true",
        },
      },
    );
    const archiveName = (await readdir(directory)).find((name) =>
      name.endsWith(".tgz"),
    );
    assert.ok(archiveName);
    const consumer = join(directory, "consumer");
    const installedPackage = join(
      consumer,
      "node_modules",
      "telegram-pi-bridge",
    );
    await mkdir(installedPackage, { recursive: true });
    await executeFile("tar", [
      "-xzf",
      join(directory, archiveName),
      "--strip-components=1",
      "-C",
      installedPackage,
    ]);
    assert.match(
      await readFile(join(installedPackage, "LICENSE"), "utf8"),
      /MIT License/u,
    );
    assert.ok(
      (await readFile(join(installedPackage, "README.md"), "utf8")).length > 0,
    );
    assert.deepEqual((await readdir(installedPackage)).sort(), [
      "LICENSE",
      "README.md",
      "examples",
      "package.json",
      "src",
    ]);
    await writeFile(join(consumer, "consumer.mjs"), consumerSource);
    await executeFile(process.execPath, ["consumer.mjs"], {
      cwd: consumer,
      env: testEnvironment,
    });

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
    const profile=await preparePiProfile({profileRoot:join(root,'profiles'),sessionIdentifier:'synthetic'});
    assert.ok(profile);
  `,
    );
    await executeFile(process.execPath, ["installed-layout.mjs"], {
      cwd: consumer,
      env: testEnvironment,
    });
  },
);
