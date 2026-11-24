import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getGuildSchemaState, migrateGuildFoundation, GUILD_SCHEMA_VERSION, guildSchemaChecksum, guildTables } from "../database/migrations/guild-foundation";

// No config/env import: an explicit database is mandatory; no accidental production defaults.
const args = process.argv.slice(2);
const valid = args.length >= 2 && args[0] === "--database" && args[1] && (args.length === 2 || (args.length === 3 && args[2] === "--apply"));
if (!valid) {
  console.error("Usage: migrate:guild -- --database /absolute/path/existing-copy.sqlite [--apply]");
  process.exitCode = 1;
} else {
  const filename = args[1]!;
  if (!path.isAbsolute(filename) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    throw new Error("Provide an absolute path to an existing database; rehearse against an isolated backup first");
  }
  const apply = args.includes("--apply");
  const db = new DatabaseSync(filename, { readOnly: !apply });
  try {
    console.log(JSON.stringify(apply ? migrateGuildFoundation(db) : {
      dryRun: true, state: getGuildSchemaState(db), version: GUILD_SCHEMA_VERSION,
      checksum: guildSchemaChecksum, tables: guildTables,
    }, null, 2));
  } finally {
    db.close();
  }
}
