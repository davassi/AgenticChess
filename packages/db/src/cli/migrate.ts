import { createDb } from "../client.js";
import { runMigrations } from "../migrate.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || url.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const handle = createDb(url, { max: 1 });
try {
  await runMigrations(handle.db);
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed", error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
