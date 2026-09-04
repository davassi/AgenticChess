import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";

export interface TestDatabase {
  db: Database;
  url: string;
  stop: () => Promise<void>;
}

const POSTGRES_IMAGE = "postgres:17-alpine";

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const url = container.getConnectionUri();
  const handle = createDb(url, { max: 5 });
  try {
    await runMigrations(handle.db);
  } catch (error) {
    await handle.close();
    await container.stop();
    throw error;
  }
  return {
    db: handle.db,
    url,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE rating_history, ratings, move_attempts, moves, games, agents, users RESTART IDENTITY CASCADE`,
  );
}
