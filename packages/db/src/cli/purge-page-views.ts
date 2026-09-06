import { createDb } from "../client.js";
import { parseDaysArg } from "../insights-report.js";
import { purgePageViews } from "../page-views.js";

/**
 * Forgets page views older than the given number of days.
 *
 *   pnpm --filter @aichess/db insights:purge --older-than 180
 *
 * The flag has no default on purpose: a command that deletes should never be
 * able to run meaningfully by accident.
 */

const url = process.env["DATABASE_URL"];

if (url === undefined || url.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const days = parseDaysArg(process.argv.slice(2), "--older-than", null);
if (days === null) {
  console.error("usage: insights:purge --older-than N   (N between 1 and 365; the flag is required)");
  process.exit(1);
}

const before = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);

const handle = createDb(url, { max: 1 });
try {
  const removed = await purgePageViews(handle.db, before);
  console.log(`removed ${String(removed)} page views recorded before ${before.toISOString()}`);
} catch (error) {
  console.error("could not purge the page views:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
