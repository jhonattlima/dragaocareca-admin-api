import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { getDb } from "./sqlite";

export const connectDb = async (): Promise<void> => {
  const dbPath = path.resolve(config.sqlitePath);
  const legacyDbPath = path.resolve(process.cwd(), "data", "dragaocareca-admin.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    fs.copyFileSync(legacyDbPath, dbPath);
    for (const suffix of ["-wal", "-shm"]) {
      const legacySidecar = `${legacyDbPath}${suffix}`;
      const sidecarTarget = `${dbPath}${suffix}`;
      if (fs.existsSync(legacySidecar) && !fs.existsSync(sidecarTarget)) {
        fs.copyFileSync(legacySidecar, sidecarTarget);
      }
    }
  }

  getDb();
  console.log(`SQLite database ready at ${dbPath}`);
};
