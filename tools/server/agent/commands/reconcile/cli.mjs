// Process wrapper of the operator reconciliation command (T8.5).
//
// The command itself lives in command.mjs, so a test can run it in-process with
// fake GitHub and Telegram clients. Every file this command may create belongs
// to the private service state, so the process never runs with a public umask.

import { runReconcileCommand } from "./command.mjs";

process.umask(0o077);

process.exitCode = await runReconcileCommand({
  argv: process.argv.slice(2),
  environment: process.env,
});
