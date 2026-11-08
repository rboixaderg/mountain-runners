import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const image = process.env.MR_ISOLATION_TEST_IMAGE;

test(
  "a restricted local container can write its workspace but not access host canaries",
  { skip: !image },
  (context) => {
    const directory = mkdtempSync(join(tmpdir(), "mr-isolation-"));
    context.after(() => rmSync(directory, { recursive: true, force: true }));
    const canaryPath = join(directory, "canary");
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    chmodSync(workspace, 0o777);
    writeFileSync(canaryPath, "synthetic");
    const probe = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const os = require('node:os');
    assert.equal(process.getuid(), 65534);
    assert.equal(process.env.MR_ISOLATION_CANARY, undefined);
    assert.equal(fs.existsSync(process.env.CANARY_PATH), false);
    assert.equal(fs.existsSync('/var/run/docker.sock'), false);
    const status = fs.readFileSync('/proc/self/status', 'utf8');
    assert.match(status, /^NoNewPrivs:\\s+1$/m);
    assert.match(status, /^CapEff:\\s+0+$/m);
    assert.deepEqual(Object.keys(os.networkInterfaces()), ['lo']);
    fs.writeFileSync('/work/result.txt', 'synthetic result');
    assert.throws(() => fs.writeFileSync('/write-probe', 'x'), { code: 'EROFS' });
    assert.throws(() => fs.readFileSync('/etc/shadow'), { code: 'EACCES' });
  `;
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--pull=never",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=32",
        "--memory=128m",
        "--cpus=0.5",
        "--user=65534:65534",
        "-e",
        `CANARY_PATH=${canaryPath}`,
        "--mount",
        `type=bind,src=${workspace},dst=/work`,
        image,
        "node",
        "-e",
        probe,
      ],
      {
        encoding: "utf8",
        timeout: 30000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          MR_ISOLATION_CANARY: "synthetic",
        },
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(workspace, "result.txt"), "utf8"),
      "synthetic result",
    );
  },
);
