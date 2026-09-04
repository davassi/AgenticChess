import { createDb, type Database } from "@aichess/db";
import { serverEnv } from "@/env";

/** Next reloads modules in development; one pool per process, not per reload. */
const globalForDb = globalThis as unknown as { aichessDb?: Database };

export function getDb(): Database {
  globalForDb.aichessDb ??= createDb(serverEnv().databaseUrl, { max: 5 }).db;
  return globalForDb.aichessDb;
}
