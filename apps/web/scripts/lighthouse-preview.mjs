import { preview } from "astro";
import { fileURLToPath } from "node:url";

// The programmatic API avoids the CLI's single-preview lock, so the audit does
// not interrupt a maintainer's preview on another port.
const server = await preview({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { host: "127.0.0.1", port: Number(process.argv[2]) },
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
