// Process wrapper of the agent update command (T10).
//
// The command itself lives in command.mjs, so a test can run it in-process with
// a fake runner and temporary roots. It runs as root and installs root-owned
// code, so the process never runs with a public umask.

import { runUpdateCommand } from "./command.mjs";

process.umask(0o077);

process.exitCode = runUpdateCommand({
  argv: process.argv.slice(2),
});
