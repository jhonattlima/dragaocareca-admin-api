import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";
import { getDb } from "./sqlite";

export const connectDb = async (): Promise<void> => {
  const dbPath = path.resolve(config.sqlitePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  getDb();
  console.log(`SQLite database ready at ${dbPath}`);
};
