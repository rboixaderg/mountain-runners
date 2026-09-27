import { execFile } from "node:child_process";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { parsePreviewSites, renderPreviewSites } from "./site-config.mjs";

const exec = promisify(execFile);
const caddyDirectory = "/etc/caddy";

export async function updatePreviewSite(
  pullNumber,
  enabled,
  { directory = caddyDirectory, run = exec } = {},
) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Invalid pull request number for Caddy.");
  }
  const mainPath = `${directory}/Caddyfile`;
  const fragmentPath = `${directory}/Caddyfile.previews`;
  const previous = await readFile(fragmentPath, "utf8");
  const sites = parsePreviewSites(previous);
  const next = enabled
    ? [...new Set([...sites, pullNumber])]
    : sites.filter((number) => number !== pullNumber);
  if (next.length > 5)
    throw new Error("Preview limit of 5 active origins reached.");
  const candidate = renderPreviewSites(next);
  if (candidate === previous.trim()) return;

  const main = await readFile(mainPath, "utf8");
  const importPattern = /^import Caddyfile\.previews$/gmu;
  if ([...main.matchAll(importPattern)].length !== 1) {
    throw new Error(
      "The main Caddyfile must import the preview fragment exactly once.",
    );
  }
  const temporaryFragment = `${fragmentPath}.${process.pid}.candidate`;
  const temporaryMain = `${mainPath}.${process.pid}.candidate`;
  try {
    await writeFile(temporaryFragment, `${candidate}\n`, {
      mode: 0o644,
      flag: "wx",
    });
    await writeFile(
      temporaryMain,
      main.replace(
        importPattern,
        `import Caddyfile.previews.${process.pid}.candidate`,
      ),
      { mode: 0o644, flag: "wx" },
    );
    await run("caddy", [
      "validate",
      "--config",
      temporaryMain,
      "--adapter",
      "caddyfile",
    ]);
    await rename(temporaryFragment, fragmentPath);
    try {
      await run("systemctl", ["restart", "caddy"]);
      await run("curl", [
        "--fail",
        "--silent",
        "--max-time",
        "10",
        "--output",
        "/dev/null",
        "https://mountainrunners.cat/ca/",
      ]);
    } catch (error) {
      await writeFile(fragmentPath, previous, { mode: 0o644 });
      await run("systemctl", ["restart", "caddy"]);
      throw error;
    }
  } finally {
    await unlink(temporaryFragment).catch(() => {});
    await unlink(temporaryMain).catch(() => {});
  }
}
