import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runUpdate } from "./update-upstream.mjs";

const API = "https://api.test";
const LOCAL = "mountain-runners/mountain-runners";
const BOT = { login: "skills-bot[bot]", id: 4242, type: "Bot" };
const BOT_NAME = "skills-bot[bot]";
const BOT_EMAIL = `4242+${BOT_NAME}@users.noreply.github.com`;
const SOURCE = "https://github.com/antfu/skills";
const SKILL_PATH = "skills/sample-skill";
const OLD_COMMIT = "a".repeat(40);
const NEW_COMMIT = "b".repeat(40);

const SKILL = [
  "---",
  "name: sample-skill",
  "description: Sample skill.",
  "---",
  "",
  "# Sample",
  "",
].join("\n");
const OLD_GUIDE = "Removed upstream.\n";
const NEW_SKILL = [
  SKILL.trimEnd(),
  "Changed.",
  "",
  "<!-- review this -->",
  "",
  "```bash",
  "npm i -D jsdom",
  "```",
  "",
].join("\n");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function treeEntry(path, content, mode = "100644") {
  return {
    path,
    mode,
    type: "blob",
    sha: createHash("sha1").update(content).digest("hex"),
  };
}

function buildTree(files) {
  const entries = [];
  for (const [path, description] of Object.entries(files)) {
    if (description.directory) {
      entries.push({ path, mode: "040000", type: "tree", sha: "d".repeat(40) });
    } else if (description.type === "commit") {
      entries.push({
        path,
        mode: "160000",
        type: "commit",
        sha: "9".repeat(40),
      });
    } else {
      entries.push(treeEntry(path, description.content, description.mode));
    }
  }
  return entries;
}

/**
 * A GitHub fake: upstream repositories resolved by default branch, their trees
 * and blobs, and the pull request and branch state of this repository.
 */
function createGitHub(options = {}) {
  const upstream = {
    fullName: "antfu/skills",
    defaultBranch: "main",
    declaredLicense: "MIT",
    pinnedCommit: OLD_COMMIT,
    headCommit: NEW_COMMIT,
    pinned: {
      [`${SKILL_PATH}/SKILL.md`]: { content: SKILL },
      LICENSE: { content: "MIT\n" },
    },
    head: {
      [`${SKILL_PATH}/SKILL.md`]: { content: NEW_SKILL },
      LICENSE: { content: "MIT\n" },
    },
    ...options.upstream,
  };
  const state = {
    redirecting: options.redirecting ?? false,
    pullRequests: options.pullRequests ?? [],
    branches: options.branches ?? {},
    compare: options.compare ?? {},
    calls: [],
  };
  const trees = new Map([
    [upstream.pinnedCommit, buildTree(upstream.pinned)],
    [upstream.headCommit, buildTree(upstream.head)],
  ]);
  const blobs = new Map();
  for (const files of [upstream.pinned, upstream.head]) {
    for (const description of Object.values(files)) {
      if (description.directory || description.type === "commit") continue;
      const digest = createHash("sha1")
        .update(description.content)
        .digest("hex");
      blobs.set(digest, description.content);
    }
  }

  function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function respond(path) {
    if (path === `/repos/${upstream.fullName}`) {
      if (state.redirecting) {
        return new Response("", {
          status: 301,
          headers: { location: "https://api.test/moved" },
        });
      }
      return json({
        full_name: options.renamedTo ?? upstream.fullName,
        default_branch: upstream.defaultBranch,
        license: upstream.declaredLicense
          ? { spdx_id: upstream.declaredLicense }
          : null,
      });
    }
    const commitMatch = /^\/repos\/antfu\/skills\/commits\/(.+)$/u.exec(path);
    if (commitMatch) {
      return json({ sha: upstream.headCommit });
    }
    const treeMatch =
      /^\/repos\/antfu\/skills\/git\/trees\/([0-9a-f]+)\?recursive=1$/u.exec(
        path,
      );
    if (treeMatch) {
      const entries = trees.get(treeMatch[1]);
      if (!entries) return json({ message: "Not Found" }, 404);
      return json({ tree: entries, truncated: false });
    }
    const blobMatch = /^\/repos\/antfu\/skills\/git\/blobs\/([0-9a-f]+)$/u.exec(
      path,
    );
    if (blobMatch) {
      const content = blobs.get(blobMatch[1]);
      if (content === undefined) return json({ message: "Not Found" }, 404);
      return json({
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
        size: Buffer.byteLength(content),
      });
    }
    if (path === `/repos/${LOCAL}`) {
      return json({ full_name: LOCAL, default_branch: "main" });
    }
    if (path === "/user") return json(BOT);
    const refMatch =
      /^\/repos\/mountain-runners\/mountain-runners\/git\/ref\/heads\/(.+)$/u.exec(
        path,
      );
    if (refMatch) {
      const branch = decodeURIComponent(refMatch[1]);
      const sha = state.branches[branch];
      if (!sha) return json({ message: "Not Found" }, 404);
      return json({ object: { sha } });
    }
    if (path.startsWith("/repos/mountain-runners/mountain-runners/pulls?")) {
      const head = new URL(`${API}${path}`).searchParams.get("head");
      const branch = head.split(":")[1];
      return json(
        state.pullRequests.filter(
          (pullRequest) =>
            pullRequest.state !== "closed" && pullRequest.head.ref === branch,
        ),
      );
    }
    const compareMatch =
      /^\/repos\/mountain-runners\/mountain-runners\/compare\/(.+)\.\.\.(.+)$/u.exec(
        path,
      );
    if (compareMatch) {
      const branch = decodeURIComponent(compareMatch[2]);
      return json(state.compare[branch] ?? { commits: [], total_commits: 0 });
    }
    return json({ message: "Not Found" }, 404);
  }

  async function fetchImpl(url, init = {}) {
    const path = url.replace(API, "");
    const call = { method: init.method ?? "GET", path, body: init.body };
    state.calls.push(call);

    const pullPost =
      /^\/repos\/mountain-runners\/mountain-runners\/pulls$/u.exec(path);
    if (init.method === "POST" && pullPost) {
      const body = JSON.parse(init.body);
      const created = {
        number: state.pullRequests.length + 1,
        state: "open",
        title: body.title,
        body: body.body,
        html_url: `https://github.test/pull/${state.pullRequests.length + 1}`,
        user: BOT,
        head: { ref: body.head, repo: { full_name: LOCAL } },
      };
      state.pullRequests.push(created);
      state.branches[body.head] = state.branches[body.head] ?? "c".repeat(40);
      return json(created);
    }
    const pullPatch =
      /^\/repos\/mountain-runners\/mountain-runners\/pulls\/(\d+)$/u.exec(path);
    if (init.method === "PATCH" && pullPatch) {
      const body = JSON.parse(init.body);
      const pullRequest = state.pullRequests.find(
        (candidate) => candidate.number === Number(pullPatch[1]),
      );
      Object.assign(pullRequest, body);
      return json(pullRequest);
    }
    const labelsPost =
      /^\/repos\/mountain-runners\/mountain-runners\/issues\/(\d+)\/labels$/u.exec(
        path,
      );
    if (init.method === "POST" && labelsPost) {
      return json([{ name: "skills" }]);
    }
    return respond(path);
  }

  return { fetchImpl, state, upstream };
}

function createGit() {
  const state = { staged: "", head: "1".repeat(40), calls: [] };
  async function git(args) {
    state.calls.push(args);
    if (args[0] === "rev-parse") return `${state.head}\n`;
    if (args[0] === "add") {
      state.staged = "changed";
      return "";
    }
    if (args[0] === "diff") return state.staged;
    if (args.includes("commit")) {
      state.staged = "";
      state.head = "e".repeat(40);
      return "";
    }
    return "";
  }
  return { git, state };
}

function manifestEntry(overrides = {}) {
  return {
    source: SOURCE,
    commit: OLD_COMMIT,
    sourceSkillPath: SKILL_PATH,
    license: "MIT",
    sourceLicensePath: "LICENSE",
    licenseSha256: sha256("MIT\n"),
    files: {
      "SKILL.md": sha256(SKILL),
      "references/old.md": sha256(OLD_GUIDE),
    },
    ...overrides,
  };
}

function createRepository(t, { entry = manifestEntry() } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "skills-update-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(
    join(directory, ".agents", "skills", "sample-skill", "references"),
    {
      recursive: true,
    },
  );
  writeFileSync(
    join(directory, ".agents", "skills", "sample-skill", "SKILL.md"),
    SKILL,
  );
  writeFileSync(
    join(
      directory,
      ".agents",
      "skills",
      "sample-skill",
      "references",
      "old.md",
    ),
    OLD_GUIDE,
  );
  writeFileSync(
    join(directory, ".agents", "skills", "sample-skill", "LICENSE"),
    "MIT\n",
  );
  writeFileSync(
    join(directory, ".agents", "skills", "skills-manifest.json"),
    `${JSON.stringify({ reviewedAt: "2026-07-17", skills: { "sample-skill": entry } }, null, 2)}\n`,
  );
  return directory;
}

async function run(directory, github = createGitHub(), options = {}) {
  const messages = [];
  const result = await runUpdate({
    cwd: directory,
    env: options.env ?? {},
    argv: options.argv ?? ["--dry-run"],
    apiBaseUrl: API,
    fetchImpl: github.fetchImpl,
    git: options.git,
    log: (message) => messages.push(message),
  });
  return { result, messages, github };
}

function readManifest(directory) {
  return JSON.parse(
    readFileSync(
      join(directory, ".agents", "skills", "skills-manifest.json"),
      "utf8",
    ),
  );
}

test("a new revision with changes is proposed and written", async (t) => {
  const directory = createRepository(t);
  const github = createGitHub();
  const git = createGit();

  const dryRun = await run(directory, github);
  assert.equal(dryRun.result.exitCode, 0);
  assert.match(
    dryRun.messages.join("\n"),
    /chore\(skills\): update antfu-skills to bbbbbbb/u,
  );

  const applied = await run(directory, github, {
    argv: ["--apply"],
    git: git.git,
    env: {
      GITHUB_TOKEN: "token",
      GITHUB_REPOSITORY: LOCAL,
      SKILLS_UPDATE_APP_SLUG: "skills-bot",
    },
  });

  assert.equal(applied.result.exitCode, 0);
  assert.equal(
    readFileSync(
      join(directory, ".agents", "skills", "sample-skill", "SKILL.md"),
      "utf8",
    ),
    NEW_SKILL,
  );
  assert.equal(
    existsSync(
      join(
        directory,
        ".agents",
        "skills",
        "sample-skill",
        "references",
        "old.md",
      ),
    ),
    false,
  );
  const manifest = readManifest(directory);
  assert.equal(manifest.reviewedAt, "2026-07-17");
  assert.equal(
    Object.hasOwn(manifest.skills["sample-skill"].files, "references/old.md"),
    false,
  );
  assert.equal(manifest.skills["sample-skill"].commit, NEW_COMMIT);
  assert.equal(
    manifest.skills["sample-skill"].files["SKILL.md"],
    sha256(NEW_SKILL),
  );
  assert.equal(manifest.skills["sample-skill"].licenseSha256, sha256("MIT\n"));

  const pullRequest = github.state.pullRequests[0];
  assert.equal(
    pullRequest.title,
    "chore(skills): update antfu-skills to bbbbbbb",
  );
  assert.match(pullRequest.body, /compare\/a{40}\.\.\.b{40}/u);
  assert.match(pullRequest.body, /no fiable/u);
  assert.match(pullRequest.body, /## Per revisar/u);
  assert.match(pullRequest.body, /\(esborrat\)/u);
  assert.match(pullRequest.body, /comentari HTML: <!-- review this -->/u);
  assert.match(pullRequest.body, /bloc de shell: ```bash/u);
  assert.match(pullRequest.body, /ordre d.execució: npm i -D jsdom/u);
  assert.deepEqual(
    github.state.calls.filter((call) => call.path.endsWith("/labels")).length,
    1,
  );

  const push = git.state.calls.find((args) => args[0] === "push");
  assert.deepEqual(push, [
    "push",
    `--force-with-lease=refs/heads/skills/update-antfu-skills:`,
    "origin",
    "HEAD:refs/heads/skills/update-antfu-skills",
  ]);
});

test("a new revision without skill changes proposes nothing", async (t) => {
  const directory = createRepository(t);
  const github = createGitHub({
    upstream: {
      head: {
        [`${SKILL_PATH}/SKILL.md`]: { content: SKILL },
        LICENSE: { content: "MIT\n" },
      },
    },
  });
  const before = readManifest(directory);

  const { result, messages } = await run(directory, github);

  assert.equal(result.exitCode, 0);
  assert.match(messages.join("\n"), /no skill changes/u);
  assert.deepEqual(readManifest(directory), before);
});

test("an open pull request of the App is updated", async (t) => {
  const directory = createRepository(t);
  const github = createGitHub({
    branches: { "skills/update-antfu-skills": "f".repeat(40) },
    compare: {
      "skills/update-antfu-skills": {
        commits: [
          {
            author: BOT,
            commit: { author: { name: BOT_NAME, email: BOT_EMAIL } },
          },
        ],
        total_commits: 1,
      },
    },
    pullRequests: [
      {
        number: 7,
        state: "open",
        html_url: "https://github.test/pull/7",
        user: BOT,
        head: { ref: "skills/update-antfu-skills", repo: { full_name: LOCAL } },
      },
    ],
  });

  const git = createGit();
  const { result } = await run(directory, github, {
    argv: ["--apply"],
    git: git.git,
    env: {
      GITHUB_TOKEN: "token",
      GITHUB_REPOSITORY: LOCAL,
      SKILLS_UPDATE_APP_SLUG: "skills-bot",
    },
  });

  assert.equal(result.exitCode, 0);
  const push = git.state.calls.find((args) => args[0] === "push");
  assert.equal(
    push[1],
    `--force-with-lease=refs/heads/skills/update-antfu-skills:${"f".repeat(40)}`,
  );
  const patches = github.state.calls.filter((call) => call.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.match(patches[0].body, /chore\(skills\): update antfu-skills/u);
  assert.equal(
    github.state.calls.filter(
      (call) => call.method === "POST" && call.path.endsWith("/pulls"),
    ).length,
    0,
  );
});

test("a pull request of another author is refused", async (t) => {
  const directory = createRepository(t);
  const github = createGitHub({
    branches: { "skills/update-antfu-skills": "f".repeat(40) },
    compare: {
      "skills/update-antfu-skills": { commits: [], total_commits: 0 },
    },
    pullRequests: [
      {
        number: 8,
        state: "open",
        user: { login: "someone", type: "User" },
        head: { ref: "skills/update-antfu-skills", repo: { full_name: LOCAL } },
      },
    ],
  });

  await assert.rejects(
    run(directory, github, {
      argv: ["--apply"],
      git: createGit().git,
      env: {
        GITHUB_TOKEN: "token",
        GITHUB_REPOSITORY: LOCAL,
        SKILLS_UPDATE_APP_SLUG: "skills-bot",
      },
    }),
    /was not created by the App/u,
  );
});

test("a pull request from another repository is refused", async (t) => {
  const directory = createRepository(t);
  const github = createGitHub({
    branches: { "skills/update-antfu-skills": "f".repeat(40) },
    compare: {
      "skills/update-antfu-skills": { commits: [], total_commits: 0 },
    },
    pullRequests: [
      {
        number: 9,
        state: "open",
        user: BOT,
        head: {
          ref: "skills/update-antfu-skills",
          repo: { full_name: "fork/skills" },
        },
      },
    ],
  });

  await assert.rejects(
    run(directory, github, {
      argv: ["--apply"],
      git: createGit().git,
      env: {
        GITHUB_TOKEN: "token",
        GITHUB_REPOSITORY: LOCAL,
        SKILLS_UPDATE_APP_SLUG: "skills-bot",
      },
    }),
    /does not come from this repository/u,
  );
});

test("a bot branch with a commit of another author is refused", async (t) => {
  const directory = createRepository(t);
  const github = createGitHub({
    branches: { "skills/update-antfu-skills": "f".repeat(40) },
    compare: {
      "skills/update-antfu-skills": {
        commits: [
          {
            author: { login: "someone", type: "User" },
            commit: {
              author: { name: "Someone", email: "someone@example.com" },
            },
          },
        ],
        total_commits: 1,
      },
    },
  });

  await assert.rejects(
    run(directory, github, {
      argv: ["--apply"],
      git: createGit().git,
      env: {
        GITHUB_TOKEN: "token",
        GITHUB_REPOSITORY: LOCAL,
        SKILLS_UPDATE_APP_SLUG: "skills-bot",
      },
    }),
    /has a commit by someone that the App did not author/u,
  );
});

test("dry-run writes nothing", async (t) => {
  const directory = createRepository(t);
  const before = readFileSync(
    join(directory, ".agents", "skills", "skills-manifest.json"),
    "utf8",
  );

  const { result } = await run(directory, createGitHub());

  assert.equal(result.exitCode, 0);
  assert.equal(
    readFileSync(
      join(directory, ".agents", "skills", "skills-manifest.json"),
      "utf8",
    ),
    before,
  );
  assert.equal(
    readFileSync(
      join(directory, ".agents", "skills", "sample-skill", "SKILL.md"),
      "utf8",
    ),
    SKILL,
  );
});

const refusalCases = [
  {
    name: "a changed license file",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
            LICENSE: { content: "Apache-2.0\n" },
          },
        },
      }),
    reason: /license LICENSE changed upstream/u,
  },
  {
    name: "a changed declared license",
    github: () => createGitHub({ upstream: { declaredLicense: "Apache-2.0" } }),
    reason: /declared license .* changed from MIT to Apache-2.0/u,
  },
  {
    name: "a file that is not documentation",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
            [`${SKILL_PATH}/run.sh`]: { content: "echo hi\n" },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /run\.sh is not a \.md or \.txt file/u,
  },
  {
    name: "an executable file",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: {
              content: `${SKILL}Changed.\n`,
              mode: "100755",
            },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /SKILL\.md is executable/u,
  },
  {
    name: "a symbolic link",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
            [`${SKILL_PATH}/guide.md`]: {
              content: "target.md",
              mode: "120000",
            },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /guide\.md is a symbolic link/u,
  },
  {
    name: "a submodule",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
            [`${SKILL_PATH}/vendor`]: { type: "commit" },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /vendor is a submodule/u,
  },
  {
    name: "a Git LFS pointer",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
            [`${SKILL_PATH}/big.md`]: {
              content:
                "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n",
            },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /big\.md is a Git LFS pointer/u,
  },
  {
    name: "a bidi character",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: {
              content: `${SKILL}Changed \u202e reversed.\n`,
            },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /control or bidi character U\+202e/u,
  },
  {
    name: "a control character",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed\u0007.\n` },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /control or bidi character U\+0007/u,
  },
  {
    name: "a disallowed frontmatter key",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: {
              content: [
                "---",
                "name: sample-skill",
                "allowed-tools: Bash",
                "---",
                "",
              ].join("\n"),
            },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /disallowed frontmatter key "allowed-tools"/u,
  },
  {
    name: "a changed frontmatter name",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: {
              content: [
                "---",
                "name: other-skill",
                "description: x",
                "---",
                "",
              ].join("\n"),
            },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /SKILL\.md declares the name "other-skill"/u,
  },
  {
    name: "an unresolvable commit",
    github: () => createGitHub({ upstream: { pinnedCommit: "c".repeat(40) } }),
    reason: /cannot resolve the commit/u,
  },
  {
    name: "a redirected repository",
    github: () => createGitHub({ redirecting: true }),
    reason: /renamed or redirected/u,
  },
  {
    name: "a renamed repository",
    github: () => createGitHub({ renamedTo: "antfu/moved-skills" }),
    reason: /is now antfu\/moved-skills/u,
  },
  {
    name: "a file larger than 256 KiB",
    github: () =>
      createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
            [`${SKILL_PATH}/huge.md`]: { content: "a".repeat(256 * 1024 + 1) },
            LICENSE: { content: "MIT\n" },
          },
        },
      }),
    reason: /huge\.md is larger than 256 KiB/u,
  },
  {
    name: "a skill larger than 1 MiB",
    github: () => {
      const big = "a".repeat(250 * 1024);
      return createGitHub({
        upstream: {
          head: {
            [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
            ...Object.fromEntries(
              [1, 2, 3, 4, 5].map((index) => [
                `${SKILL_PATH}/part-${index}.md`,
                { content: big },
              ]),
            ),
            LICENSE: { content: "MIT\n" },
          },
        },
      });
    },
    reason: /the skill is larger than 1 MiB/u,
  },
];

for (const refusal of refusalCases) {
  test(`refuses ${refusal.name}`, async (t) => {
    const directory = createRepository(t);
    const github = refusal.github();
    const before = readManifest(directory);

    const { result, messages } = await run(directory, github);

    assert.equal(result.exitCode, 1);
    assert.match(messages.join("\n"), refusal.reason);
    assert.match(messages.join("\n"), /no pull request was opened/u);
    assert.deepEqual(readManifest(directory), before);
    assert.equal(
      github.state.calls.filter((call) => call.method !== "GET").length,
      0,
    );
  });
}

test("refuses a path outside sourceSkillPath", async (t) => {
  const directory = createRepository(t);
  const github = createGitHub({
    upstream: {
      head: {
        [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}Changed.\n` },
        [`${SKILL_PATH}/../../elsewhere.md`]: { content: "x\n" },
        LICENSE: { content: "MIT\n" },
      },
    },
  });

  const { result, messages } = await run(directory, github);

  assert.equal(result.exitCode, 1);
  assert.match(messages.join("\n"), /outside/u);
});

test("the review list is capped and counts the remaining findings", async (t) => {
  const directory = createRepository(t);
  const comments = Array.from(
    { length: 50 },
    (_, index) => `<!-- comment ${index} -->`,
  ).join("\n");
  const github = createGitHub({
    upstream: {
      head: {
        [`${SKILL_PATH}/SKILL.md`]: { content: `${SKILL}${comments}\n` },
        LICENSE: { content: "MIT\n" },
      },
    },
  });

  const { result } = await run(directory, github, {
    argv: ["--apply"],
    git: createGit().git,
    env: {
      GITHUB_TOKEN: "token",
      GITHUB_REPOSITORY: LOCAL,
      SKILLS_UPDATE_APP_SLUG: "skills-bot",
    },
  });

  assert.equal(result.exitCode, 0);
  const body = github.state.pullRequests[0].body;
  assert.equal(body.match(/comentari HTML/gu).length, 40);
  assert.match(body, /10 troballes més al diff cru\./u);
});
