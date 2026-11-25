// Operator command: rehearse the state migration on a copy.
//
//   node commands/migrate-state/cli.mjs <state-directory>
//
// The database files of the directory are copied to a private temporary
// directory, the copy is migrated exactly as the service does at startup and the
// row counts of every table are printed before and after. The directory given is
// only read, and the temporary copy is always removed. It needs no
// configuration and no network.

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  legacyDatabaseNames,
  migrateLegacyState,
} from "../../repository/legacy-state.mjs";
import { stateDatabaseName } from "../../repository/state-database.mjs";

const usage = "Usage: node commands/migrate-state/cli.mjs <state-directory>";

function printCounts(directory, names) {
  for (const name of names) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    const database = new DatabaseSync(path);
    try {
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all();
      for (const { name: table } of tables) {
        const { count } = database
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get();
        process.stdout.write(`  ${name} ${table}: ${count}\n`);
      }
    } finally {
      database.close();
    }
  }
}

function rehearse(stateDirectory, copy) {
  const names = [...legacyDatabaseNames, stateDatabaseName];
  for (const name of names) {
    // A hot journal is part of the database of a process that stopped, and a
    // journal left without its database refuses the migration.
    for (const file of ["", "-journal", "-wal", "-shm"].map(
      (suffix) => `${name}${suffix}`,
    )) {
      const source = join(stateDirectory, file);
      if (existsSync(source)) copyFileSync(source, join(copy, file));
    }
  }
  process.stdout.write("Before:\n");
  printCounts(copy, names);
  const migrated = migrateLegacyState(copy, {
    logger: (event, detail) => process.stdout.write(`${event} ${detail}\n`),
  });
  if (migrated.length === 0) {
    process.stdout.write("There is no database to migrate.\n");
    return;
  }
  process.stdout.write("After:\n");
  printCounts(copy, [stateDatabaseName]);
  process.stdout.write(
    `The migration of the copy succeeded: ${migrated.join(", ")}.\n`,
  );
}

process.umask(0o077);
const [stateDirectory, ...extra] = process.argv.slice(2);
if (stateDirectory === undefined || extra.length > 0) {
  process.stderr.write(`${usage}\n`);
  process.exitCode = 2;
} else if (!existsSync(stateDirectory)) {
  process.stderr.write(
    `The state directory ${stateDirectory} does not exist.\n`,
  );
  process.exitCode = 1;
} else {
  const copy = mkdtempSync(join(tmpdir(), "mr-agent-migrate-state-"));
  try {
    rehearse(stateDirectory, copy);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
