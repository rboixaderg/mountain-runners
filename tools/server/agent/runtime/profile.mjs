// Rebuild only trusted runtime resources. Repository instructions and skills
// are read through sandbox_bash, never followed or copied by a host loader.

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function preparePiProfile({ profileRoot, profileIdentifier }) {
  const profileDirectory = join(profileRoot, profileIdentifier);
  await rm(profileDirectory, { recursive: true, force: true });
  const extensionsDirectory = join(profileDirectory, "extensions");
  await mkdir(extensionsDirectory, { recursive: true, mode: 0o700 });
  for (const [source, destination] of [
    ["./extensions/sandbox-bash.ts", "sandbox-bash.ts"],
    ["./web-wire-client.mjs", "web-wire-client.mjs"],
    ["./web-wire-limits.mjs", "web-wire-limits.mjs"],
    ["../sandbox/arguments.mjs", "arguments.mjs"],
    ["../sandbox/commands.mjs", "commands.mjs"],
    ["../sandbox/errors.mjs", "errors.mjs"],
    // The attachment reader and the header parser stay dependency free so the
    // extension can validate a file the model controls without the app.
    ["../attachments/read.mjs", "attachment-read.mjs"],
    ["../attachments/safe-read.mjs", "safe-read.mjs"],
    ["../attachments/image-format.mjs", "image-format.mjs"],
  ]) {
    await cp(
      fileURLToPath(new URL(source, import.meta.url)),
      join(extensionsDirectory, destination),
    );
  }
  await writeFile(
    join(profileDirectory, "settings.json"),
    `${JSON.stringify(
      {
        defaultProjectTrust: "never",
        defaultTools: ["sandbox_bash", "view_attachment"],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return profileDirectory;
}
