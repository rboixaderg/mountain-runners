// Private, append-only research state. The directory must be outside the
// sandbox and writable only by the trusted service and its operator.
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { registeredWorktree, runGit } from "./trusted-git.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const identifierPattern = /^[a-f0-9]{64}$/u;

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** Read the complete outgoing history from the trusted Git registry, not /work/.git. */
export async function readResearchSnapshot({ repositoryPath, candidate }) {
  if (
    typeof candidate?.repository !== "string" ||
    !/^[a-f0-9]{40}$/u.test(candidate.commit) ||
    !/^[a-f0-9]{40}$/u.test(candidate.base) ||
    typeof candidate.title !== "string" ||
    typeof candidate.body !== "string"
  )
    throw new Error("Invalid research candidate.");
  const worktree = registeredWorktree(repositoryPath, candidate.worktreePath);
  if (worktree.gitDirectory !== candidate.gitDirectory)
    throw new Error("The candidate worktree changed.");
  const origin = (
    await runGit(worktree, ["config", "--get", "remote.origin.url"])
  ).trim();
  if (
    ![
      `https://github.com/${candidate.repository}.git`,
      `https://github.com/${candidate.repository}`,
      `git@github.com:${candidate.repository}.git`,
    ].includes(origin)
  )
    throw new Error("The candidate repository changed.");
  const head = (await runGit(worktree, ["rev-parse", "HEAD"])).trim();
  const base = (await runGit(worktree, ["rev-parse", "origin/main"])).trim();
  if (head !== candidate.commit || base !== candidate.base)
    throw new Error("The candidate Git snapshot changed.");
  const commits = (await runGit(worktree, ["rev-list", `${base}..${head}`]))
    .trim()
    .split("\n")
    .filter(Boolean);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let commitObjects = "";
  for (const commit of commits) {
    if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Invalid Git commit.");
    const raw = await runGit(worktree, ["cat-file", "commit", commit], {
      encoding: "buffer",
      maxBuffer: 2 * 1024 * 1024,
    });
    commitObjects += `\n--- commit object ${commit} ---\n${decoder.decode(raw)}\n`;
    if (Buffer.byteLength(commitObjects) > 32 * 1024 * 1024)
      throw new Error("The candidate history exceeds the review limit.");
  }
  const patch = await runGit(
    worktree,
    [
      "log",
      "--format=fuller",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--binary",
      "--full-index",
      "--no-renames",
      "-m",
      "-p",
      `${base}..${head}`,
      "--",
    ],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
  );
  const history = decoder.decode(patch);
  // An encoded binary patch is not a human inspection of its contents.
  if (history.includes("GIT binary patch")) {
    throw new Error(
      "Binary history cannot be approved by this review command.",
    );
  }
  return { candidate, commitObjects, history };
}

function writeOnce(path, content) {
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      if (readFileSync(path, "utf8") !== content)
        throw new Error("Conflicting research review record.", {
          cause: error,
        });
      const existing = openSync(path, "r");
      try {
        fsyncSync(existing);
      } finally {
        closeSync(existing);
      }
      return;
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function createResearchReview({ directory }) {
  function jobDirectory(jobId) {
    if (typeof jobId !== "string" || jobId.length === 0)
      throw new Error("A stable research job ID is required.");
    return join(directory, digest(jobId));
  }
  function requireJob(jobId) {
    const job = jobDirectory(jobId);
    if (
      readFileSync(join(job, "initialized"), "utf8") !== "research-review-v1\n"
    )
      throw new Error("Invalid research job record.");
    return job;
  }
  function present(path, content) {
    try {
      if (readFileSync(path, "utf8") !== content)
        throw new Error("Invalid research review record.");
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  function candidatePath(job, id) {
    if (typeof id !== "string" || !identifierPattern.test(id))
      throw new Error("Invalid review ID.");
    return join(job, `candidate-${id}`);
  }
  function current(job) {
    try {
      const id = readFileSync(join(job, "current"), "utf8").trim();
      if (!identifierPattern.test(id))
        throw new Error("Invalid current review record.");
      return id;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return {
    ensure(jobId, { newJob = false } = {}) {
      const job = jobDirectory(jobId);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      try {
        mkdirSync(job, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        requireJob(jobId);
        // Validate an existing taint marker rather than treating damage as clean.
        this.isTainted(jobId);
        return;
      }
      // Only a caller that proved this is a new job may initialize it clean.
      // Unknown jobs include legacy jobs and lost records, so default to taint.
      writeOnce(join(job, "state"), newJob === true ? "clean\n" : "tainted\n");
      writeOnce(join(job, "initialized"), "research-review-v1\n");
      syncDirectory(job);
      syncDirectory(directory);
    },
    initialize(jobId) {
      const job = jobDirectory(jobId);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      // Only a new job may be initialized. A missing or damaged existing record
      // must never be silently recreated as an untainted job.
      mkdirSync(job, { mode: 0o700 });
      writeOnce(join(job, "state"), "clean\n");
      writeOnce(join(job, "initialized"), "research-review-v1\n");
      syncDirectory(job);
      syncDirectory(directory);
    },
    markResearch(jobId) {
      const job = requireJob(jobId);
      if (this.isTainted(jobId)) return;
      const temporary = join(job, `state-${randomBytes(16).toString("hex")}`);
      writeOnce(temporary, "tainted\n");
      renameSync(temporary, join(job, "state"));
      syncDirectory(job);
    },
    isTainted(jobId) {
      const state = readFileSync(join(requireJob(jobId), "state"), "utf8");
      if (state === "tainted\n") return true;
      if (state === "clean\n") return false;
      throw new Error("Invalid research state.");
    },
    status(jobId) {
      const tainted = this.isTainted(jobId);
      const id = current(requireJob(jobId));
      return {
        tainted,
        reviewId: id,
        approved: id === null ? false : this.isApproved(jobId, id),
      };
    },
    prepare(jobId, candidate) {
      const job = requireJob(jobId);
      if (!this.isTainted(jobId))
        throw new Error("The job has no recorded research.");
      const previous = current(job);
      if (
        previous !== null &&
        JSON.stringify(this.candidate(jobId, previous)) ===
          JSON.stringify(candidate)
      )
        return previous;
      const content = JSON.stringify({
        candidate,
        nonce: randomBytes(32).toString("hex"),
      });
      const id = digest(content);
      writeOnce(candidatePath(job, id), content);
      const temporary = join(job, `current-${randomBytes(16).toString("hex")}`);
      writeOnce(temporary, `${id}\n`);
      renameSync(temporary, join(job, "current"));
      syncDirectory(job);
      return id;
    },
    candidate(jobId, id) {
      const job = requireJob(jobId);
      const content = readFileSync(candidatePath(job, id), "utf8");
      if (digest(content) !== id)
        throw new Error("The research candidate has changed.");
      const record = JSON.parse(content);
      if (
        !record ||
        typeof record.candidate !== "object" ||
        !identifierPattern.test(record.nonce)
      )
        throw new Error("Invalid research candidate record.");
      return record.candidate;
    },
    isApproved(jobId, id) {
      const job = requireJob(jobId);
      this.candidate(jobId, id);
      if (current(job) !== id) return false;
      return present(join(job, `approved-${id}`), `${id}\n`);
    },
    approve(jobId, id) {
      const job = requireJob(jobId);
      this.candidate(jobId, id);
      if (!this.isTainted(jobId))
        throw new Error("The job has no recorded research.");
      if (current(job) !== id)
        throw new Error("The research candidate is no longer current.");
      writeOnce(join(job, `approved-${id}`), `${id}\n`);
      syncDirectory(job);
    },
  };
}
