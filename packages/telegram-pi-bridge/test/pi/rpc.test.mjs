import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildPiArguments, runPiPrompt } from "../../src/pi/rpc.mjs";

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "telegram-pi-pi-"));
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return {
    directory,
    worktreePath: directory,
    sessions: join(directory, "sessions"),
    profile: join(directory, "profile"),
  };
}

function fakePi(context, { script, name = "pi" }) {
  const { directory } = fixture(context);
  const executable = join(directory, name);
  const invocation = join(directory, "invocation.json");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd()
}));
${script}
`,
  );
  chmodSync(executable, 0o755);
  context.after(() =>
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  return { executable, invocation };
}

function optionsFor(command, timeoutMilliseconds = 5000) {
  return {
    command,
    model: "example/model",
    sessionDirectory: "/sessions",
    timeoutMilliseconds,
  };
}

const settleScript = `
process.stdout.write(JSON.stringify({ type: "response", id: "prompt-1", command: "prompt", success: true, data: { disposition: "started" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ANSWER: synthetic" }] } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_settled", aborted: false }) + "\\n");
`;

test("runs a prompt and returns the settled assistant answer", async (context) => {
  const directory = fixture(context);
  const { executable, invocation } = fakePi(context, { script: settleScript });
  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    sessionIdentifier: "topic_n1001234567890_7",
    message: "revisa el README",
    cwd: directory.worktreePath,
    environment: {
      PATH: process.env.PATH,
      HOME: directory.directory,

      PROVIDER_KEY: "provider-secret",
    },
  });

  assert.equal(result.text, "ANSWER: synthetic");
  assert.equal(result.timedOut, false);

  const recorded = JSON.parse(readFileSync(invocation, "utf8"));
  assert.equal(recorded.cwd, realpathSync(directory.worktreePath));

  assert.deepEqual(recorded.argv, [
    "--mode",
    "rpc",
    "--model",
    "example/model",
    "--no-approve",
    "--no-context-files",
    "--no-skills",
    "--no-extensions",
    "--no-mcp",
    "--no-prompt-templates",
    "--session-id",
    "topic_n1001234567890_7",
    "--session-dir",
    "/sessions",
    "--no-tools",
  ]);

  assert.equal(recorded.env.PROVIDER_KEY, "provider-secret");
  assert.equal(recorded.env.PI_CODING_AGENT_DIR, directory.profile);

  assert.equal(recorded.env.GITHUB_TOKEN, undefined);
  assert.equal(recorded.env.TELEGRAM_BOT_TOKEN, undefined);
});

test("kills a run that does not settle within the execution limit", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `
process.stdout.write(JSON.stringify({ type: "response", id: "prompt-1", command: "prompt", success: true, data: { disposition: "started" } }) + "\\n");
setInterval(() => {}, 1000);
`,
  });

  const result = await runPiPrompt({
    ...optionsFor(executable, 300),
    profileDirectory: directory.profile,
    sessionIdentifier: "topic_n1001234567890_7",
    message: "tasca lenta",
    cwd: directory.worktreePath,
    environment: { PATH: process.env.PATH, HOME: directory.directory },
  });

  assert.equal(result.timedOut, true);
});

test("rejects a prompt that Pi refuses before accepting it", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `
process.stdout.write(JSON.stringify({ type: "response", id: "prompt-1", command: "prompt", success: false, error: "Model not found" }) + "\\n");
process.exit(1);
`,
  });

  await assert.rejects(
    runPiPrompt({
      ...optionsFor(executable),
      profileDirectory: directory.profile,
      sessionIdentifier: "topic_n1001234567890_7",
      message: "consulta",
      cwd: directory.worktreePath,
      environment: { PATH: process.env.PATH, HOME: directory.directory },
    }),
    { message: /Model not found/u },
  );
});

test("aborts the Pi process when the service stops", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `setInterval(() => {}, 1000);`,
  });
  const controller = new AbortController();

  const running = runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    sessionIdentifier: "topic_n1001234567890_7",
    message: "consulta",
    cwd: directory.worktreePath,
    environment: { PATH: process.env.PATH, HOME: directory.directory },
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(running, { message: /aborted/u });
});

test("returns when a prompt was handled without starting an agent run", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `process.stdout.write(JSON.stringify({type:"response",id:"prompt-1",command:"prompt",success:true,data:{disposition:"handled"}})+"\\n");`,
  });
  const result = await runPiPrompt({
    ...optionsFor(executable),
    cwd: directory.worktreePath,
    profileDirectory: directory.profile,
    message: "/handled",
  });
  assert.equal(result.handled, true);
  assert.equal(result.timedOut, false);
});

test("rejects a refused prompt without waiting for the still-running RPC process", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `process.stdin.resume(); process.stdout.write(JSON.stringify({type:"response",id:"prompt-1",command:"prompt",success:false,error:"Synthetic refusal"})+"\\n");`,
  });
  await assert.rejects(
    runPiPrompt({
      ...optionsFor(executable),
      cwd: directory.worktreePath,
      profileDirectory: directory.profile,
      message: "question",
    }),
    /Synthetic refusal/u,
  );
});

test("denies tools and resources unless the caller explicitly selects them", () => {
  const argumentsList = buildPiArguments({ model: "example/model" });
  for (const flag of [
    "--no-tools",
    "--no-extensions",
    "--no-mcp",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-session",
  ]) {
    assert.equal(argumentsList.includes(flag), true, flag);
  }
  for (const tool of ["+bash", "*", "read,bash"]) {
    assert.throws(
      () => buildPiArguments({ model: "example/model", tools: [tool] }),
      /explicit names/u,
    );
  }
  assert.throws(
    () =>
      buildPiArguments({
        model: "example/model",
        extensions: ["./untrusted.ts"],
      }),
    /absolute/u,
  );
  assert.throws(
    () =>
      buildPiArguments({ model: "example/model", sessionIdentifier: "topic7" }),
    /sessionDirectory/u,
  );
});

test("preserves Unicode line separators inside JSON strings", async (context) => {
  const directory = fixture(context);
  const answer = "first\u2028second\u2029third";
  const { executable } = fakePi(context, {
    script: `process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:${JSON.stringify(answer)}}]}})+"\\n"+JSON.stringify({type:"agent_settled",aborted:false})+"\\n");`,
  });
  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    cwd: directory.worktreePath,
    message: "question",
  });
  assert.equal(result.text, answer);
});

test("separates assistant messages without joining unrelated words", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `
for (const text of ["First answer", "SUMMARY: fix(agent): keep separate messages"]) {
 process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text}]}})+"\\n");
}
process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false})+"\\n");
`,
  });
  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    cwd: directory.worktreePath,
    message: "question",
  });
  assert.equal(
    result.text,
    "First answer\n\nSUMMARY: fix(agent): keep separate messages",
  );
});

for (const stream of ["stdout", "stderr", "combined"]) {
  test(`stops Pi and cleans up when ${stream} exceeds the output budget`, async (context) => {
    const directory = fixture(context);
    const { executable } = fakePi(context, {
      script:
        stream === "combined"
          ? "process.stdout.write('x'.repeat(600*1024));process.stderr.write('y'.repeat(600*1024));setInterval(()=>{},1000);"
          : `process.${stream}.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000);`,
    });
    let cleanups = 0;
    await assert.rejects(
      runPiPrompt({
        ...optionsFor(executable),
        profileDirectory: directory.profile,
        cwd: directory.worktreePath,
        message: "question",
        onInterrupted: async () => {
          cleanups += 1;
        },
      }),
      { diagnostics: { reason: "output_limit" }, message: /output limit/u },
    );
    assert.equal(cleanups, 1);
  });
}

test("reports the exit code when Pi exits without settling", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, { script: "process.exitCode = 7;" });
  await assert.rejects(
    runPiPrompt({
      ...optionsFor(executable),
      profileDirectory: directory.profile,
      cwd: directory.worktreePath,
      message: "question",
    }),
    { diagnostics: { reason: "premature_exit", exitCode: 7, signal: null } },
  );
});

test("never reports a sent prompt for an unavailable Pi executable", async (context) => {
  const directory = fixture(context);
  const sent = [];
  await assert.rejects(
    runPiPrompt({
      command: join(directory.directory, "missing-pi"),
      model: "example/model",
      cwd: directory.directory,
      profileDirectory: directory.profile,
      message: "question",
      onPromptSent: () => sent.push("prompt-sent"),
    }),
    { code: "ENOENT" },
  );
  assert.deepEqual(sent, [], "the prompt never reached a process");
});

test("never reports a sent prompt when the turn stops before the write", async (context) => {
  const directory = fixture(context);
  const writes = [];
  const sent = [];
  const controller = new AbortController();
  const running = runPiPrompt({
    command: "pi",
    model: "example/model",
    cwd: directory.directory,
    profileDirectory: directory.profile,
    message: "question",
    timeoutMilliseconds: 5000,
    signal: controller.signal,
    onPromptSent: () => sent.push("prompt-sent"),
    spawnImpl: () => {
      const child = fakeChild({
        events: writes,
        writeEvent: "prompt",
      });
      setImmediate(() => child.emit("spawn"));
      return child;
    },
  });
  // The stop lands after the process exists and before the prompt is written.
  controller.abort();

  await assert.rejects(running, { message: /aborted/u });
  assert.deepEqual(writes, [], "nothing is written to a stopped turn");
  assert.deepEqual(sent, [], "a prompt that is not written was not sent");
});

// A child that never spawns a process: the caller decides which events it emits.
function fakeChild({ events, writeEvent = "write", closeOnKill = true }) {
  const child = new EventEmitter();
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} });
  child.stdin = Object.assign(new EventEmitter(), {
    write: () => events.push(writeEvent),
    end: () => {},
  });
  // A killed child reports that it closed, like the real one.
  child.kill = () => {
    if (closeOnKill) setImmediate(() => child.emit("close", null));
  };
  return child;
}

test("reports the prompt right before it is written and after the spawn", async (context) => {
  const directory = fixture(context);
  const launchError = new Error("synthetic spawn failure");
  launchError.code = "EACCES";
  const events = [];
  await assert.rejects(
    runPiPrompt({
      command: "pi",
      model: "example/model",
      cwd: directory.directory,
      profileDirectory: directory.profile,
      message: "question",
      timeoutMilliseconds: 5000,
      onPromptSent: () => events.push("prompt-sent"),
      spawnImpl: () => {
        const child = fakeChild({ events });
        setImmediate(() => {
          child.emit("error", launchError);
        });
        return child;
      },
    }),
    launchError,
  );
  assert.deepEqual(
    events,
    [],
    "a process that never existed receives no prompt",
  );

  const runtimeError = new Error("synthetic failure after spawn");
  const afterSpawn = [];
  await assert.rejects(
    runPiPrompt({
      command: "pi",
      model: "example/model",
      cwd: directory.directory,
      profileDirectory: directory.profile,
      message: "question",
      timeoutMilliseconds: 5000,
      onPromptSent: () => afterSpawn.push("prompt-sent"),
      spawnImpl: () => {
        const child = fakeChild({ events: afterSpawn, writeEvent: "prompt" });
        setImmediate(() => {
          child.emit("spawn");
          child.emit("error", runtimeError);
        });
        return child;
      },
    }),
    runtimeError,
  );
  assert.deepEqual(
    afterSpawn,
    ["prompt-sent", "prompt"],
    "the fact is reported immediately before the write",
  );
});

test("writes the image input of the prompt in the RPC record", async (context) => {
  const directory = fixture(context);
  const promptPath = join(directory.directory, "prompt.json");
  const { executable } = fakePi(context, {
    script: `
process.stdin.once("data", (chunk) => {
  require("node:fs").writeFileSync(${JSON.stringify(promptPath)}, chunk);
  process.stdout.write(JSON.stringify({ type: "agent_settled", aborted: false }) + "\\n");
});
`,
  });
  const images = [
    { type: "image", data: "c3ludGhldGlj", mimeType: "image/jpeg" },
  ];

  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    message: "mira la imatge",
    images,
    cwd: directory.worktreePath,
    environment: { PATH: process.env.PATH, HOME: directory.directory },
  });

  assert.equal(result.text, "");
  assert.deepEqual(JSON.parse(readFileSync(promptPath, "utf8")), {
    id: "prompt-1",
    type: "prompt",
    message: "mira la imatge",
    images,
  });
});

test("a timed-out run never settles on a record that arrives after the deadline", async (context) => {
  const directory = fixture(context);
  let cleanups = 0;

  const running = runPiPrompt({
    command: "pi",
    model: "example/model",
    cwd: directory.directory,
    profileDirectory: directory.profile,
    message: "question",
    timeoutMilliseconds: 10,
    onInterrupted: async () => {
      cleanups += 1;
    },
    spawnImpl: () => {
      const child = fakeChild({ events: [], closeOnKill: false });
      setImmediate(() => child.emit("spawn"));
      setTimeout(() => {
        child.stdout.emit(
          "data",
          `${JSON.stringify({ type: "agent_settled", aborted: false })}\n`,
        );
        setImmediate(() => child.emit("close", 0));
      }, 30);
      return child;
    },
  });

  const result = await running;
  assert.equal(result.timedOut, true);
  assert.equal(
    cleanups,
    1,
    "the interrupted run still cleaned up its resources",
  );
});

test("ignores records that are not JSON objects and text blocks that are not text", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `
process.stdout.write("not json\\n");
process.stdout.write("null\\n");
process.stdout.write("42\\n");
process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[null,{type:"text",text:42},{type:"text",text:"usable"}]}})+"\\n");
process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false})+"\\n");
`,
  });

  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    cwd: directory.worktreePath,
    message: "question",
  });

  assert.equal(result.text, "usable");
});

test("reports the provider error of a turn that settled without an answer", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `
process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[],stopReason:"error",errorMessage:"429: rate limit reached"}})+"\\n");
process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false})+"\\n");
`,
  });
  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    cwd: directory.worktreePath,
    message: "question",
  });
  assert.equal(result.text, "");
  assert.equal(result.errorMessage, "429: rate limit reached");
});

test("keeps the answer of a turn whose earlier attempt failed", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `
process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[],stopReason:"error",errorMessage:"429: rate limit reached"}})+"\\n");
process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"ANSWER: synthetic"}]}})+"\\n");
process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false})+"\\n");
`,
  });
  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    cwd: directory.worktreePath,
    message: "question",
  });
  assert.equal(result.text, "ANSWER: synthetic");
  assert.equal(result.errorMessage, null);
});

test("reads a trailing record without a newline at the end of the stream", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `
process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"first answer"}]}})+"\\n");
process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false}));
`,
  });

  const result = await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    cwd: directory.worktreePath,
    message: "question",
  });

  assert.equal(result.text, "first answer");
  assert.equal(result.timedOut, false);
});

test("rejects the turn when reporting the sent prompt fails", async (context) => {
  const directory = fixture(context);
  const { executable } = fakePi(context, {
    script: `process.stdin.resume(); setInterval(() => {}, 1000);`,
  });

  await assert.rejects(
    runPiPrompt({
      ...optionsFor(executable),
      profileDirectory: directory.profile,
      cwd: directory.worktreePath,
      message: "question",
      onPromptSent: () => {
        throw new Error("synthetic hook failure");
      },
    }),
    /synthetic hook failure/u,
  );
});

test("stops a settled Pi process that keeps running", async (context) => {
  const directory = fixture(context);
  const pidPath = join(directory.directory, "pi-process-id");
  const { executable } = fakePi(context, {
    script: `
fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
process.stdin.once("data", () => {
  process.stdout.write(JSON.stringify({type:"agent_settled",aborted:false})+"\\n");
});
setInterval(()=>{},1000);
`,
  });

  await runPiPrompt({
    ...optionsFor(executable),
    profileDirectory: directory.profile,
    cwd: directory.worktreePath,
    message: "question",
  });

  const processIdentifier = Number(readFileSync(pidPath, "utf8"));
  let alive = true;
  for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
    try {
      process.kill(processIdentifier, 0);
    } catch {
      alive = false;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(alive, false, "the settled Pi process did not exit");
});
