import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ALLOWED_FRONTMATTER_KEYS, parseFrontmatter } from "./manifest.mjs";

export const DEFAULT_API_BASE_URL = "https://api.github.com";
export const MANIFEST_PATH = ".agents/skills/skills-manifest.json";
export const SKILLS_DIRECTORY = ".agents/skills";
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_SKILL_BYTES = 1024 * 1024;
export const SKILLS_LABEL = "skills";
export const MAX_REVIEW_FINDINGS = 40;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "mountain-runners-skills-update";
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/u;
const DOCUMENT_FILE = /\.(?:md|txt)$/iu;
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";
// A skill is Markdown read by an agent: no control, format, private-use,
// unassigned, line-separator or variation-selector characters. Newline and tab
// are the only accepted control characters, so they are skipped before the
// test. The decoder keeps a leading BOM so it is refused instead of hidden.
const UNSAFE_CHARACTER = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;
const VARIATION_SELECTOR = /[\uFE00-\uFE0F\u180B-\u180F\u{E0100}-\u{E01EF}]/u;
const UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

const EXTERNAL_URL = /https?:\/\/[^\s)<>"'`\]]+/gu;
const HTML_COMMENT = /<!--/u;
const SHELL_FENCE =
  /^```(?:ba|z|k)?sh\b|^```(?:console|shell|shell-session)\b/u;
const COMMAND_LIKE =
  /(?:^|[\s`"'=(])(?:curl|wget|chmod|chown|sudo|eval\s|(?:npm|pnpm|yarn)\s+(?:i|install|add)|git\s+(?:push|clone|reset|clean)|\|\s*(?:ba|z|k)?sh\b|\|\s*sudo\b)/u;

const CHANGE_LABELS = {
  added: "afegit",
  modified: "modificat",
  removed: "esborrat",
};

const execFileAsync = promisify(execFile);

/** A refusal stops the run: it never opens a pull request. */
export class Refusal extends Error {}

function refuse(reason) {
  throw new Refusal(reason);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function parseArguments(argv) {
  const options = { apply: false, appSlug: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.apply = false;
    } else if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--app-slug") {
      options.appSlug = argv[index + 1];
      if (!options.appSlug) throw new Error("--app-slug needs a value");
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function parseGitHubUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    refuse(`the source ${sourceUrl} is not a URL`);
  }
  if (parsed.hostname !== "github.com") {
    refuse(`the source ${sourceUrl} is not a github.com repository`);
  }
  const [owner, repository] = parsed.pathname
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .split("/");
  if (!owner || !repository) {
    refuse(`the source ${sourceUrl} has no owner and repository`);
  }
  return { owner, repository };
}

function sourceSlug(owner, repository) {
  return `${owner}-${repository}`.toLowerCase().replace(/[^a-z0-9-]/gu, "-");
}

function githubHeaders(token) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": USER_AGENT,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function createApiClient({ fetchImpl, apiBaseUrl, token }) {
  async function send(method, path, body, { allowNotFound = false } = {}) {
    const headers = githubHeaders(token);
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `GitHub API ${method} ${path} responded ${response.status}`,
      );
    }
    return { data: await response.json(), response };
  }

  return {
    get: (path, options) => send("GET", path, undefined, options),
    post: (path, body) => send("POST", path, body),
    patch: (path, body) => send("PATCH", path, body),
  };
}

async function resolveUpstream({ fetchImpl, apiBaseUrl, sourceUrl, token }) {
  const { owner, repository } = parseGitHubUrl(sourceUrl);
  const response = await fetchImpl(
    `${apiBaseUrl}/repos/${owner}/${repository}`,
    { headers: githubHeaders(token), redirect: "manual" },
  );
  if (REDIRECT_STATUSES.has(response.status) || response.redirected) {
    refuse(`the repository of ${sourceUrl} was renamed or redirected`);
  }
  if (response.status !== 200) {
    refuse(
      `cannot resolve the repository of ${sourceUrl} (HTTP ${response.status})`,
    );
  }
  const upstream = await response.json();
  const expected = `${owner}/${repository}`.toLowerCase();
  if (upstream.full_name.toLowerCase() !== expected) {
    refuse(`the repository of ${sourceUrl} is now ${upstream.full_name}`);
  }
  return upstream;
}

async function resolveCommit({ apiClient, owner, repository, branch }) {
  let commit;
  try {
    ({ data: commit } = await apiClient.get(
      `/repos/${owner}/${repository}/commits/${encodeURIComponent(branch)}`,
    ));
  } catch (error) {
    refuse(
      `cannot resolve the latest commit of ${owner}/${repository}: ${error.message}`,
    );
  }
  if (!COMMIT_SHA.test(commit.sha)) {
    refuse(`the latest commit of ${owner}/${repository} is not a commit SHA`);
  }
  return commit.sha;
}

async function readTree({ apiClient, owner, repository, sha, treeCache }) {
  const key = `${owner}/${repository}@${sha}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  let tree;
  try {
    ({ data: tree } = await apiClient.get(
      `/repos/${owner}/${repository}/git/trees/${sha}?recursive=1`,
    ));
  } catch (error) {
    refuse(
      `cannot resolve the commit ${sha} of ${owner}/${repository}: ${error.message}`,
    );
  }
  if (tree.truncated === true) {
    refuse(`the tree of ${owner}/${repository} at ${sha} is truncated`);
  }
  const entries = new Map(tree.tree.map((entry) => [entry.path, entry]));
  treeCache.set(key, entries);
  return entries;
}

function isSafePath(path) {
  return path
    .split("/")
    .every(
      (segment) =>
        segment !== "." &&
        segment !== ".." &&
        /^[A-Za-z0-9._-]+$/u.test(segment),
    );
}

function assertContained(path, prefix) {
  if (!isSafePath(path) || !path.startsWith(prefix)) {
    refuse(`${path} is outside ${prefix}`);
  }
}

function decodeText(path, content) {
  try {
    return UTF8_DECODER.decode(content);
  } catch {
    refuse(`${path} is not valid UTF-8`);
  }
}

function assertPlainText(path, content) {
  for (const character of decodeText(path, content)) {
    if (character === "\n" || character === "\t") continue;
    if (
      UNSAFE_CHARACTER.test(character) ||
      VARIATION_SELECTOR.test(character)
    ) {
      const codePoint = character.codePointAt(0).toString(16).padStart(4, "0");
      refuse(
        `${path} contains the control, format or bidi character U+${codePoint}`,
      );
    }
  }
}

async function readUpstreamFile({
  apiClient,
  owner,
  repository,
  treeEntry,
  isLicense,
}) {
  const path = treeEntry.path;
  if (treeEntry.type === "commit" || treeEntry.mode === "160000") {
    refuse(`${path} is a submodule`);
  }
  if (treeEntry.mode === "120000") refuse(`${path} is a symbolic link`);
  if (treeEntry.mode === "100755") refuse(`${path} is executable`);
  if (treeEntry.type !== "blob" || treeEntry.mode !== "100644") {
    refuse(`${path} is not a regular file`);
  }
  if (!isLicense && !DOCUMENT_FILE.test(path)) {
    refuse(`${path} is not a .md or .txt file`);
  }
  if (!COMMIT_SHA.test(treeEntry.sha)) {
    refuse(`${path} is not a blob SHA`);
  }
  if (treeEntry.size > MAX_FILE_BYTES) {
    refuse(`${path} is larger than 256 KiB`);
  }

  const { data: blob } = await apiClient.get(
    `/repos/${owner}/${repository}/git/blobs/${treeEntry.sha}`,
  );
  if (blob.encoding !== "base64") refuse(`${path} is not served as base64`);
  const content = Buffer.from(blob.content, "base64");
  if (content.length > MAX_FILE_BYTES) {
    refuse(`${path} is larger than 256 KiB`);
  }
  if (
    content.subarray(0, LFS_POINTER.length).toString("utf8") === LFS_POINTER
  ) {
    refuse(`${path} is a Git LFS pointer`);
  }
  assertPlainText(path, content);
  return content;
}

function checkSkillFrontmatter(name, content) {
  let frontmatter;
  try {
    frontmatter = parseFrontmatter(content.toString("utf8"));
  } catch (error) {
    refuse(`${name}: ${error.message}`);
  }
  for (const key of frontmatter.keys) {
    if (!ALLOWED_FRONTMATTER_KEYS.includes(key)) {
      refuse(`${name}: SKILL.md uses the disallowed frontmatter key "${key}"`);
    }
  }
  if (frontmatter.name !== name) {
    refuse(`${name}: SKILL.md declares the name "${frontmatter.name}"`);
  }
}

function changedSkillPaths(pinnedTree, headTree, prefix) {
  const paths = new Set();
  for (const tree of [pinnedTree, headTree]) {
    for (const [path, entry] of tree) {
      if (entry.type !== "tree" && path.startsWith(prefix)) paths.add(path);
    }
  }
  return [...paths].filter(
    (path) => pinnedTree.get(path)?.sha !== headTree.get(path)?.sha,
  );
}

function readLocalFile(cwd, name, path) {
  try {
    return readFileSync(join(cwd, SKILLS_DIRECTORY, name, path), "utf8");
  } catch {
    return "";
  }
}

function scanForReview({ cwd, name, files, changes }) {
  const findings = [];
  const changedPaths = new Set(changes.map((change) => change.path));
  for (const [path, content] of files) {
    if (!changedPaths.has(path)) continue;
    const lines = content.toString("utf8").split("\n");
    const previous = readLocalFile(cwd, name, path);
    const knownUrls = new Set(previous.match(EXTERNAL_URL) ?? []);
    const newUrls = new Set(
      (content.toString("utf8").match(EXTERNAL_URL) ?? []).filter(
        (url) => !knownUrls.has(url),
      ),
    );
    for (const [index, line] of lines.entries()) {
      const location = `${path}:${index + 1}`;
      if (HTML_COMMENT.test(line)) {
        findings.push(`${location} comentari HTML: ${line.trim()}`);
      }
      if (SHELL_FENCE.test(line.trim())) {
        findings.push(`${location} bloc de shell: ${line.trim()}`);
      }
      if (COMMAND_LIKE.test(line)) {
        findings.push(`${location} ordre d'execució: ${line.trim()}`);
      }
    }
    for (const url of newUrls) {
      findings.push(`${path} URL externa nova: ${url}`);
    }
  }
  return findings.map((finding) =>
    finding.length > 160 ? `${finding.slice(0, 157)}...` : finding,
  );
}

async function planSkill({
  skill,
  apiClient,
  owner,
  repository,
  headTree,
  headCommit,
  cwd,
  treeCache,
}) {
  const { name, entry } = skill;
  const prefix = `${entry.sourceSkillPath.replace(/\/+$/u, "")}/`;
  const licensePath = entry.sourceLicensePath;
  const licenseName = posix.basename(licensePath);
  if (!COMMIT_SHA.test(entry.commit)) {
    refuse(`${name}: the pinned commit is not a SHA`);
  }
  const pinnedTree = await readTree({
    apiClient,
    owner,
    repository,
    sha: entry.commit,
    treeCache,
  });

  if (!isSafePath(licensePath)) {
    refuse(`${name}: ${licensePath} is outside the source`);
  }
  const headLicense = headTree.get(licensePath);
  if (!headLicense) {
    refuse(`${name}: the license ${licensePath} is missing upstream`);
  }
  const license = await readUpstreamFile({
    apiClient,
    owner,
    repository,
    treeEntry: headLicense,
    isLicense: true,
  });
  if (sha256(license) !== entry.licenseSha256) {
    refuse(`${name}: the license ${licensePath} changed upstream`);
  }

  const changedPaths = changedSkillPaths(pinnedTree, headTree, prefix);
  if (changedPaths.length === 0) return null;

  const files = new Map();
  const seenPaths = new Map();
  // The cap is checked against the tree sizes before each download, so an
  // oversized skill never spends a blob request, and again on what arrived.
  let declaredBytes = license.length;
  let totalBytes = license.length;
  for (const [path, treeEntry] of headTree) {
    if (treeEntry.type === "tree" || !path.startsWith(prefix)) continue;
    assertContained(path, prefix);
    const relativePath = path.slice(prefix.length);
    if (relativePath.toLowerCase() === licenseName.toLowerCase()) {
      refuse(`${name}: ${path} collides with the license ${licenseName}`);
    }
    const earlierPath = seenPaths.get(relativePath.toLowerCase());
    if (earlierPath !== undefined) {
      refuse(`${name}: ${path} differs only by case from ${earlierPath}`);
    }
    seenPaths.set(relativePath.toLowerCase(), path);
    declaredBytes += treeEntry.size ?? 0;
    if (declaredBytes > MAX_SKILL_BYTES) {
      refuse(`${name}: the skill is larger than 1 MiB`);
    }
    const content = await readUpstreamFile({
      apiClient,
      owner,
      repository,
      treeEntry,
      isLicense: false,
    });
    files.set(relativePath, content);
    totalBytes += content.length;
  }
  if (totalBytes > MAX_SKILL_BYTES) {
    refuse(`${name}: the skill is larger than 1 MiB`);
  }
  if (!files.has("SKILL.md")) refuse(`${name}: SKILL.md is missing upstream`);
  checkSkillFrontmatter(name, files.get("SKILL.md"));

  const changes = [];
  for (const [path, content] of files) {
    const digest = sha256(content);
    const pinned = entry.files[path];
    if (pinned === digest) continue;
    changes.push({
      path,
      status: pinned === undefined ? "added" : "modified",
      hash: digest,
    });
  }
  for (const path of Object.keys(entry.files)) {
    if (!files.has(path)) changes.push({ path, status: "removed" });
  }
  changes.sort((left, right) => left.path.localeCompare(right.path));

  return {
    name,
    commit: headCommit,
    licenseName,
    license,
    files,
    changes,
    review: scanForReview({ cwd, name, files, changes }),
  };
}

async function planSource({
  source,
  apiClient,
  fetchImpl,
  apiBaseUrl,
  token,
  cwd,
  log,
  treeCache,
}) {
  const { owner, repository } = parseGitHubUrl(source.sourceUrl);
  const upstream = await resolveUpstream({
    fetchImpl,
    apiBaseUrl,
    sourceUrl: source.sourceUrl,
    token,
  });
  for (const skill of source.skills) {
    const declared = upstream.license?.spdx_id ?? "none";
    if (skill.entry.license !== declared) {
      refuse(
        `the declared license of ${source.sourceUrl} changed from ${skill.entry.license} to ${declared}`,
      );
    }
    if (skill.entry.repositoryId !== upstream.id) {
      refuse(
        `the repository id of ${source.sourceUrl} changed from ${skill.entry.repositoryId} to ${upstream.id}`,
      );
    }
  }

  const headCommit = await resolveCommit({
    apiClient,
    owner,
    repository,
    branch: upstream.default_branch,
  });
  const headTree = await readTree({
    apiClient,
    owner,
    repository,
    sha: headCommit,
    treeCache,
  });

  const skills = [];
  for (const skill of source.skills) {
    const plan = await planSkill({
      skill,
      apiClient,
      owner,
      repository,
      headTree,
      headCommit,
      cwd,
      treeCache,
    });
    if (plan) skills.push(plan);
  }

  if (skills.length === 0) {
    log(`${source.sourceUrl}: no skill changes at ${headCommit.slice(0, 7)}`);
    return null;
  }

  const slug = sourceSlug(owner, repository);
  return {
    slug,
    sourceUrl: source.sourceUrl,
    owner,
    repository,
    previousCommit: source.skills[0].entry.commit,
    commit: headCommit,
    title: `chore(skills): update ${slug} to ${headCommit.slice(0, 7)}`,
    branch: `skills/update-${slug}`,
    compareUrl: `https://github.com/${owner}/${repository}/compare/${source.skills[0].entry.commit}...${headCommit}`,
    skills,
  };
}

function formatHashes(proposal) {
  const lines = [];
  for (const skill of proposal.skills) {
    for (const change of skill.changes) {
      if (!change.hash) continue;
      lines.push(`- \`${skill.name}/${change.path}\` — \`${change.hash}\``);
    }
  }
  return lines;
}

// Untrusted upstream text goes inside a fence that no run of tildes or
// backticks in the content can close.
function fencedText(content) {
  const longestRun = Math.max(
    0,
    ...(content.match(/~+|`+/gu) ?? []).map((run) => run.length),
  );
  const fence = "~".repeat(Math.max(3, longestRun + 1));
  return [`${fence}text`, content, fence].join("\n");
}

function buildPullRequestBody(proposal) {
  const lines = [
    `Origen: ${proposal.sourceUrl}`,
    `Comparació: ${proposal.compareUrl}`,
    `Revisió fixada: \`${proposal.previousCommit.slice(0, 7)}\` → \`${proposal.commit.slice(0, 7)}\``,
    "",
    "Aquesta branca torna a fixar les skills externes a `skills-manifest.json` i",
    "substitueix els seus directoris byte a byte. El contingut és **no fiable** fins",
    "que una persona ha llegit el diff cru: els agents carreguen aquestes skills",
    "després del merge i un comentari o una ordre dins del Markdown no es pot",
    "refusar automàticament.",
    "",
    "## Fitxers canviats",
    "",
  ];
  const changedFiles = [];
  for (const skill of proposal.skills) {
    changedFiles.push(`${skill.name}`);
    for (const change of skill.changes) {
      changedFiles.push(`  ${CHANGE_LABELS[change.status]} ${change.path}`);
    }
  }
  lines.push(fencedText(changedFiles.join("\n")));

  lines.push("", "## Hashes nous", "", ...formatHashes(proposal));

  lines.push("", "## Per revisar", "");
  const findings = proposal.skills.flatMap((skill) =>
    skill.review.map((finding) => `${skill.name}/${finding}`),
  );
  if (findings.length === 0) {
    lines.push("Cap troballa automàtica. Revisa igualment el diff cru.");
  } else {
    lines.push(
      "Comentaris HTML, URLs externes noves, blocs de shell i línies d'ordre:",
      "",
      fencedText(findings.slice(0, MAX_REVIEW_FINDINGS).join("\n")),
    );
    if (findings.length > MAX_REVIEW_FINDINGS) {
      lines.push(
        "",
        `${findings.length - MAX_REVIEW_FINDINGS} troballes més al diff cru.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function printProposal(proposal, log) {
  log(
    `${proposal.sourceUrl}: propose ${proposal.previousCommit.slice(0, 7)}...${proposal.commit.slice(0, 7)}`,
  );
  log(`  branch ${proposal.branch}`);
  log(`  title ${proposal.title}`);
  log(`  compare ${proposal.compareUrl}`);
  for (const skill of proposal.skills) {
    log(`  ${skill.name}: ${skill.changes.length} changed file(s)`);
    for (const change of skill.changes) {
      log(`    ${CHANGE_LABELS[change.status]} ${change.path}`);
    }
    for (const finding of skill.review.slice(0, MAX_REVIEW_FINDINGS)) {
      log(`    review ${finding}`);
    }
  }
}

function pinManifestEntry(manifest, skill) {
  const entry = manifest.skills[skill.name];
  entry.commit = skill.commit;
  entry.licenseSha256 = sha256(skill.license);
  entry.files = Object.fromEntries(
    [...skill.files]
      .map(([path, content]) => [path, sha256(content)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function writeSkillDirectory(cwd, name, files, licenseName, license) {
  if (!SKILL_NAME.test(name)) {
    refuse(`refusing to write the skill directory "${name}"`);
  }
  const directory = join(cwd, SKILLS_DIRECTORY, name);
  rmSync(directory, { recursive: true, force: true });
  const allFiles = [...files, [licenseName, license]].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [path, content] of allFiles) {
    const filePath = join(directory, path);
    if (!filePath.startsWith(`${directory}${sep}`)) {
      refuse(`${filePath} is outside ${directory}`);
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

// The token reaches git through the environment, never through argv, and only
// for the push that writes the bot branch.
function pushCredentials(token) {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
}

async function resolveBot({ apiClient, appSlug }) {
  const login = `${appSlug}[bot]`;
  let user;
  try {
    ({ data: user } = await apiClient.get(
      `/users/${encodeURIComponent(login)}`,
    ));
  } catch (error) {
    refuse(`cannot resolve the ${login} account: ${error.message}`);
  }
  if (user.type !== "Bot" || user.login !== login) {
    refuse(`the account ${user.login} is not the ${login} bot`);
  }
  return {
    login,
    name: login,
    email: `${user.id}+${login}@users.noreply.github.com`,
  };
}

function isBotCommit(commit, bot) {
  if (commit.author?.login === bot.login) {
    return true;
  }
  return (
    commit.commit.author.name === bot.name &&
    commit.commit.author.email === bot.email
  );
}

async function assertBranchCommits({
  apiClient,
  owner,
  repository,
  defaultBranch,
  branch,
  bot,
}) {
  const { data: comparison } = await apiClient.get(
    `/repos/${owner}/${repository}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branch)}`,
  );
  if (comparison.total_commits > comparison.commits.length) {
    refuse(`${branch} has more commits than the comparison returned`);
  }
  for (const commit of comparison.commits) {
    if (!isBotCommit(commit, bot)) {
      const author = commit.author?.login ?? commit.commit.author.name;
      refuse(`${branch} has a commit by ${author} that the App did not author`);
    }
  }
}

async function assertPullRequestBelongsToApp({
  pullRequest,
  owner,
  repository,
  bot,
}) {
  if (pullRequest.user.type !== "Bot" || pullRequest.user.login !== bot.login) {
    refuse(
      `the open pull request #${pullRequest.number} was not created by the App`,
    );
  }
  const head = pullRequest.head.repo?.full_name?.toLowerCase();
  if (head !== `${owner}/${repository}`.toLowerCase()) {
    refuse(
      `the open pull request #${pullRequest.number} does not come from this repository`,
    );
  }
}

// A branch that already holds the tree this run would commit, on the same base
// commit, only differs in its commit date: pushing it again would restart the
// checks of its pull request for nothing. A commit the API cannot resolve keeps
// the previous behaviour and pushes.
async function holdsSameTree({
  apiClient,
  owner,
  repository,
  sha,
  tree,
  baseSha,
}) {
  const existing = await apiClient.get(
    `/repos/${owner}/${repository}/git/commits/${sha}`,
    { allowNotFound: true },
  );
  if (!existing) return false;
  return (
    existing.data.tree?.sha === tree &&
    existing.data.parents?.[0]?.sha === baseSha
  );
}

// Every read-only check for one proposal. The run performs all of them before
// it writes anything, so a refusal in any source stops the whole run.
async function preflightProposal({
  proposal,
  apiClient,
  owner,
  repository,
  defaultBranch,
  bot,
}) {
  const branch = proposal.branch;
  const referencePath = `/repos/${owner}/${repository}/git/ref/heads/${encodeURIComponent(branch)}`;
  const existingReference = await apiClient.get(referencePath, {
    allowNotFound: true,
  });
  if (existingReference) {
    await assertBranchCommits({
      apiClient,
      owner,
      repository,
      defaultBranch,
      branch,
      bot,
    });
  }

  const { data: pulls } = await apiClient.get(
    `/repos/${owner}/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
  );
  const open = pulls.find((pullRequest) => pullRequest.head.ref === branch);
  if (open) {
    await assertPullRequestBelongsToApp({
      pullRequest: open,
      owner,
      repository,
      bot,
    });
  }

  return { expectedSha: existingReference?.data.object.sha ?? "", open };
}

async function applyProposal({
  proposal,
  preflight,
  baseSha,
  apiClient,
  cwd,
  git,
  token,
  owner,
  repository,
  defaultBranch,
  bot,
  log,
}) {
  const branch = proposal.branch;
  const { expectedSha, open } = preflight;

  // Each branch carries only its own source: drop whatever a previous
  // proposal wrote and start from the base commit and the base manifest.
  await git(["reset", "--hard", baseSha], { cwd });
  await git(["clean", "-fd", "--", SKILLS_DIRECTORY], { cwd });
  const manifest = JSON.parse(readFileSync(join(cwd, MANIFEST_PATH), "utf8"));

  for (const skill of proposal.skills) {
    writeSkillDirectory(
      cwd,
      skill.name,
      skill.files,
      skill.licenseName,
      skill.license,
    );
    pinManifestEntry(manifest, skill);
  }
  writeFileSync(
    join(cwd, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const writtenPaths = [
    ...proposal.skills.map((skill) => join(SKILLS_DIRECTORY, skill.name)),
    MANIFEST_PATH,
  ];
  await git(["add", "--all", "--", ...writtenPaths], { cwd });
  const staged = await git(["diff", "--cached", "--name-only", "--"], { cwd });

  const hasChanges = staged.trim() !== "";
  const unchangedBranch =
    hasChanges &&
    expectedSha !== "" &&
    (await holdsSameTree({
      apiClient,
      owner,
      repository,
      sha: expectedSha,
      tree: (await git(["write-tree"], { cwd })).trim(),
      baseSha,
    }));

  if (hasChanges && !unchangedBranch) {
    await git(
      [
        "-c",
        `user.name=${bot.name}`,
        "-c",
        `user.email=${bot.email}`,
        "commit",
        "--no-gpg-sign",
        "-m",
        proposal.title,
      ],
      { cwd },
    );
    await git(
      [
        "push",
        `--force-with-lease=refs/heads/${branch}:${expectedSha}`,
        "origin",
        `HEAD:refs/heads/${branch}`,
      ],
      { cwd, env: pushCredentials(token) },
    );
  }

  const body = buildPullRequestBody(proposal);
  let pullRequest;
  if (open) {
    if (
      unchangedBranch &&
      open.title === proposal.title &&
      open.body === body
    ) {
      log(`unchanged pull request ${open.html_url}`);
      return;
    }
    ({ data: pullRequest } = await apiClient.patch(
      `/repos/${owner}/${repository}/pulls/${open.number}`,
      { title: proposal.title, body },
    ));
    log(`updated pull request ${pullRequest.html_url}`);
  } else {
    ({ data: pullRequest } = await apiClient.post(
      `/repos/${owner}/${repository}/pulls`,
      {
        title: proposal.title,
        head: branch,
        base: defaultBranch,
        body,
      },
    ));
    log(`created pull request ${pullRequest.html_url}`);
  }
  await apiClient.post(
    `/repos/${owner}/${repository}/issues/${pullRequest.number}/labels`,
    {
      labels: [SKILLS_LABEL],
    },
  );
}

async function runGit(args, { cwd, env }) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

export async function runUpdate({
  argv = [],
  cwd = process.cwd(),
  env = {},
  fetchImpl = fetch,
  git = runGit,
  log = () => {},
  apiBaseUrl = DEFAULT_API_BASE_URL,
} = {}) {
  const options = parseArguments(argv);
  const appSlug = options.appSlug ?? env.SKILLS_UPDATE_APP_SLUG;
  const token = env.SKILLS_UPDATE_TOKEN;
  if (options.apply && !token) {
    throw new Error("--apply needs SKILLS_UPDATE_TOKEN");
  }
  if (options.apply && !appSlug) throw new Error("--apply needs the App slug");

  const manifest = JSON.parse(readFileSync(join(cwd, MANIFEST_PATH), "utf8"));
  const apiClient = createApiClient({
    fetchImpl,
    apiBaseUrl,
    token: options.apply ? token : undefined,
  });

  const sources = new Map();
  for (const [name, entry] of Object.entries(manifest.skills)) {
    const source = sources.get(entry.source) ?? {
      sourceUrl: entry.source,
      skills: [],
    };
    source.skills.push({ name, entry });
    sources.set(entry.source, source);
  }

  const treeCache = new Map();
  const proposals = [];
  const refusals = [];
  for (const source of sources.values()) {
    try {
      const proposal = await planSource({
        source,
        apiClient,
        fetchImpl,
        apiBaseUrl,
        token: options.apply ? token : undefined,
        cwd,
        log,
        treeCache,
      });
      if (proposal) proposals.push(proposal);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      refusals.push(`${source.sourceUrl}: ${error.message}`);
    }
  }

  if (refusals.length > 0) {
    for (const refusal of refusals) log(`refused: ${refusal}`);
    log("no pull request was opened");
    return { exitCode: 1 };
  }

  if (!options.apply) {
    if (proposals.length === 0) log("no upstream skill changes");
    for (const proposal of proposals) printProposal(proposal, log);
    return { exitCode: 0 };
  }

  if (proposals.length === 0) {
    log("no upstream skill changes");
    return { exitCode: 0 };
  }

  const [repositoryOwner, repositoryName] = env.GITHUB_REPOSITORY.split("/");
  if (!repositoryOwner || !repositoryName) {
    throw new Error("--apply needs GITHUB_REPOSITORY");
  }
  const { data: localRepository } = await apiClient.get(
    `/repos/${repositoryOwner}/${repositoryName}`,
  );
  const bot = await resolveBot({ apiClient, appSlug });

  const preflights = [];
  for (const proposal of proposals) {
    preflights.push(
      await preflightProposal({
        proposal,
        apiClient,
        owner: repositoryOwner,
        repository: repositoryName,
        defaultBranch: localRepository.default_branch,
        bot,
      }),
    );
  }

  const baseSha = (await git(["rev-parse", "HEAD"], { cwd })).trim();
  for (const [index, proposal] of proposals.entries()) {
    await applyProposal({
      proposal,
      preflight: preflights[index],
      baseSha,
      apiClient,
      cwd,
      git,
      token,
      owner: repositoryOwner,
      repository: repositoryName,
      defaultBranch: localRepository.default_branch,
      bot,
      log,
    });
  }
  return { exitCode: 0 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runUpdate({ argv: process.argv.slice(2), env: process.env, log: console.log })
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
