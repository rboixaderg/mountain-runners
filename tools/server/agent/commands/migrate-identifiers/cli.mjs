// Process wrapper of the identifier migration command (T8.6).
//
// The command itself lives in command.mjs, so a test can run it in-process with
// an explicit environment. Every file it writes belongs to the private service
// state or to the private Git metadata: the process never runs with a public
// umask.

import { runMigrateIdentifiersCommand } from "./command.mjs";

process.umask(0o077);

process.exitCode = await runMigrateIdentifiersCommand({
  environment: process.env,
});
