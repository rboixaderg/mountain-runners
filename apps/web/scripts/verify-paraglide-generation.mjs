import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@inlang/paraglide-js";
import { paraglideOptions } from "../paraglide.config.mjs";

const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const generatedDirectory = resolve(appDirectory, paraglideOptions.outdir);

async function readOutput(directory) {
  const files = new Map();

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const path = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await visit(path);
      } else {
        const outputPath = relative(directory, path);
        files.set(outputPath, await readFile(path, "utf8"));
      }
    }
  }

  await visit(directory);
  return files;
}

function describeDifferences(generated, reference) {
  const differences = [];
  for (const [path, content] of reference) {
    if (!generated.has(path)) {
      differences.push(`missing: ${path}`);
    } else if (generated.get(path) !== content) {
      differences.push(`differs: ${path}`);
    }
  }
  for (const path of generated.keys()) {
    if (!reference.has(path)) differences.push(`unexpected: ${path}`);
  }
  return differences;
}

await stat(generatedDirectory).catch(() => {
  throw new Error(
    `Paraglide output is missing at ${generatedDirectory}. Run "pnpm paraglide:generate" first.`,
  );
});

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "mountain-runners-paraglide-"),
);

try {
  // A single compilation is enough: the generated tree is compared against it,
  // so a stale or hand-edited tree fails instead of being compared with a
  // second temporary compilation of itself.
  const referenceDirectory = join(temporaryDirectory, "reference");
  await compile({
    ...paraglideOptions,
    outdir: referenceDirectory,
    cleanOutdir: true,
  });

  const [generated, reference] = await Promise.all([
    readOutput(generatedDirectory),
    readOutput(referenceDirectory),
  ]);

  const differences = describeDifferences(generated, reference);
  if (differences.length > 0) {
    throw new Error(
      [
        `Paraglide generation is stale or not deterministic (${relative(appDirectory, generatedDirectory)}).`,
        'Run "pnpm paraglide:generate" and inspect the result.',
        ...differences.slice(0, 10),
      ].join("\n"),
    );
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
