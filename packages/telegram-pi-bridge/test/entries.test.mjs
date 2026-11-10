// Public module boundaries must work in fresh processes, without loading the
// dependencies of the other entries. Node's loader makes those imports fail.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const executeFile = promisify(execFile);
const packageDirectory = fileURLToPath(new URL("../", import.meta.url));

for (const entry of ["telegram", "sessions", "pi"]) {
  test(`loads the public ${entry} entry without unrelated runtime dependencies`, async () => {
    const script = `
      import assert from 'node:assert/strict';
      import {registerHooks} from 'node:module';
      const entry = ${JSON.stringify(entry)};
      registerHooks({resolve(specifier, context, nextResolve) {
        if (entry !== 'sessions' && specifier === 'node:sqlite') throw new Error('Unexpected SQLite dependency');
        if (entry !== 'pi' && specifier === 'node:child_process') throw new Error('Unexpected Pi process dependency');
        const resolved = nextResolve(specifier, context);
        if (entry !== 'telegram' && resolved.url.includes('/src/telegram/')) throw new Error('Unexpected Telegram dependency');
        if (entry !== 'pi' && resolved.url.includes('/src/pi/')) throw new Error('Unexpected Pi dependency');
        return resolved;
      }});
      const module = await import('telegram-pi-bridge/' + entry);
      const required = {telegram:['AgentBridge','TelegramApi'],sessions:['AdmissionQueue','sessionIdentifier'],pi:['runPiPrompt','buildPiArguments']};
      for (const name of required[entry]) assert.equal(typeof module[name], 'function');
    `;
    const { stdout } = await executeFile(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: packageDirectory,
        env: { PATH: process.env.PATH },
      },
    );
    assert.equal(stdout, "");
  });
}
