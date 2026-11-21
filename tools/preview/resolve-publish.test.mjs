// Tests for the authorize step of the label request (preview-label T1).
//
// The script runs as in the workflow, with a local fake GitHub API: the pull
// request number comes from the event, the head from the API (never from
// GITHUB_SHA) and the actor is the event sender.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "resolve-publish.mjs",
);
const repository = "rboixaderg/mountain-runners";
const pullNumber = 77;
const headSha = "a".repeat(40);

async function runAuthorize({
  permission = "write",
  labels = [{ name: "preview" }],
  headRepository = repository,
  state = "open",
}) {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url.endsWith("/permission")) {
      response.end(JSON.stringify({ permission }));
    } else if (request.url.endsWith(`/pulls/${pullNumber}`)) {
      response.end(
        JSON.stringify({
          state,
          labels,
          head: { sha: headSha, repo: { full_name: headRepository } },
        }),
      );
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "resolve-publish-"));
  try {
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "output");
    await writeFile(outputPath, "");
    await writeFile(
      eventPath,
      JSON.stringify({
        action: "synchronize",
        pull_request: { number: pullNumber },
        sender: { login: "maintainer" },
      }),
    );
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        PATH: process.env.PATH,
        GITHUB_EVENT_NAME: "pull_request_target",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REPOSITORY: repository,
        GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
        // The last commit of main on this event: it must never be used.
        GITHUB_SHA: "f".repeat(40),
      },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const status = await new Promise((resolve) => child.on("close", resolve));
    return { status, stderr, output: await readFile(outputPath, "utf8") };
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("a pull request event with write access resolves the head from the API", async () => {
  for (const permission of ["write", "admin"]) {
    const result = await runAuthorize({ permission });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.output, /should_publish=true/);
    assert.match(result.output, new RegExp(`pull_number=${pullNumber}`));
    assert.match(result.output, new RegExp(`head_sha=${headSha}`));
    assert.doesNotMatch(result.output, /f{40}/);
  }
});

test("a sender without write access fails and publishes nothing", async () => {
  for (const permission of ["read", "none"]) {
    const result = await runAuthorize({ permission });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no longer has repository write permission/);
    assert.doesNotMatch(result.output, /should_publish=true/);
  }
});

test("a pull request that lost the label meanwhile is not published", async () => {
  const result = await runAuthorize({ labels: [] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /should_publish=false/);
});

test("a revoked, closed or fork pull request fails", async () => {
  const cases = [
    { labels: [{ name: "preview" }, { name: "preview-revoked" }] },
    { state: "closed" },
    { headRepository: "someone/fork" },
  ];
  for (const options of cases) {
    const result = await runAuthorize(options);
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.doesNotMatch(result.output, /should_publish=true/);
  }
});
