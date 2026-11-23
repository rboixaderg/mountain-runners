// Run locally on the trusted service as an authorized operator. This command
// has no GitHub credentials or remote-write operation.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  createResearchReview,
  readResearchSnapshot,
} from "../../repository/research-review.mjs";

const [action, directory, repositoryPath, jobId, id] = process.argv.slice(2);
if (
  !["status", "show", "approve"].includes(action) ||
  !directory ||
  !repositoryPath ||
  !jobId ||
  (action !== "status" && !id)
) {
  throw new Error(
    "Usage: research-review <status|show|approve> <private-store> <repository> <job-id> [review-id]",
  );
}
if (action === "approve" && (!stdin.isTTY || !stdout.isTTY)) {
  throw new Error("Approval requires an interactive private terminal.");
}
const review = createResearchReview({ directory });
if (action === "status") {
  stdout.write(`${JSON.stringify(review.status(jobId), null, 2)}\n`);
  process.exit(0);
}
const candidate = review.candidate(jobId, id);
const snapshot = await readResearchSnapshot({ repositoryPath, candidate });
// Render control characters literally, including escape sequences from Git data.
const safe = (text) =>
  text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
    character === "\n" || character === "\t"
      ? character
      : `\\u{${character.codePointAt(0).toString(16)}}`,
  );
stdout.write(
  `${safe(JSON.stringify(snapshot.candidate, null, 2))}\n\n${safe(snapshot.commitObjects)}\n${safe(snapshot.history)}\n`,
);
if (action === "approve") {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const confirmation = await prompt.question(
      `After reviewing the entire snapshot, type ${id} to approve it: `,
    );
    if (confirmation !== id) throw new Error("Approval not confirmed.");
    // Detect a local change while the operator was inspecting the snapshot.
    await readResearchSnapshot({ repositoryPath, candidate });
    review.approve(jobId, id);
    stdout.write("Approved this candidate only. Nothing was published.\n");
  } finally {
    prompt.close();
  }
}
