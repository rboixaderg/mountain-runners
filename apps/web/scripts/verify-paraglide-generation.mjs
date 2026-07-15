import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { compile } from "@inlang/paraglide-js";
import { paraglideOptions } from "../paraglide.config.mjs";

async function readOutput(directory) {
  const files = new Map();

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const path = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await visit(path);
      } else {
        files.set(relative(directory, path), await readFile(path, "utf8"));
      }
    }
  }

  await visit(directory);
  return files;
}

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "mountain-runners-paraglide-"),
);
const outputs = [
  join(temporaryDirectory, "first"),
  join(temporaryDirectory, "second"),
];

try {
  for (const outdir of outputs) {
    await compile({
      ...paraglideOptions,
      outdir,
      cleanOutdir: true,
      emitGitIgnore: false,
      emitPrettierIgnore: false,
      emitReadme: false,
    });
  }

  const [first, second] = await Promise.all(outputs.map(readOutput));

  if (
    first.size !== second.size ||
    [...first].some(([path, content]) => second.get(path) !== content)
  ) {
    throw new Error("Paraglide generation is not deterministic.");
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
