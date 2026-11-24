// A nested Git repository whose clean filter only creates a marker file. Its
// index is dated in the past, so Git treats the committed file as racily clean:
// any Git command that enters the repository hashes it through the filter.

import { execFile } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const pastTime = new Date("2000-01-01T00:00:00Z");

async function nestedGit(directory, argumentsList) {
  await executeFile("git", [
    "-C",
    directory,
    "-c",
    "user.name=Synthetic",
    "-c",
    "user.email=synthetic@example.test",
    ...argumentsList,
  ]);
}

/** Create `nested/` inside `parentPath`; entering it creates `markerPath`. */
export async function createNestedRepository(parentPath, markerPath) {
  const nestedPath = join(parentPath, "nested");
  mkdirSync(nestedPath);
  await nestedGit(nestedPath, ["init", "--quiet"]);
  writeFileSync(join(nestedPath, "file.txt"), "nested\n");
  await nestedGit(nestedPath, ["add", "file.txt"]);
  await nestedGit(nestedPath, ["commit", "--quiet", "-m", "test: nested"]);
  await nestedGit(nestedPath, [
    "config",
    "filter.probe.clean",
    `touch '${markerPath}'; cat`,
  ]);
  writeFileSync(join(nestedPath, ".gitattributes"), "* filter=probe\n");
  utimesSync(join(nestedPath, ".git", "index"), pastTime, pastTime);
}
