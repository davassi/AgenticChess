import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client.js";

const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(db: Database, migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder });
}
