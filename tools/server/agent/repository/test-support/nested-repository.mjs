// A nested Git repository whose clean filter only creates a marker file. Its
// index is dated in the past, so Git treats the committed file as racily clean:
// any Git command that enters the repository hashes it through the filter.

import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git-repository.mjs";

const pastTime = new Date("2000-01-01T00:00:00Z");

/** Create `nested/` inside `parentPath`; entering it creates `markerPath`. */
export async function createNestedRepository(parentPath, markerPath) {
  const nestedPath = join(parentPath, "nested");
  mkdirSync(nestedPath);
  await git(nestedPath, ["init", "--quiet"]);
  writeFileSync(join(nestedPath, "file.txt"), "nested\n");
  await git(nestedPath, ["add", "file.txt"]);
  await git(nestedPath, ["commit", "--quiet", "-m", "test: nested"]);
  await git(nestedPath, [
    "config",
    "filter.probe.clean",
    `touch '${markerPath}'; cat`,
  ]);
  writeFileSync(join(nestedPath, ".gitattributes"), "* filter=probe\n");
  utimesSync(join(nestedPath, ".git", "index"), pastTime, pastTime);
}
