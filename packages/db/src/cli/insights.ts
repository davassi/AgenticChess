import { createDb } from "../client.js";
import { formatInsights, parseDaysArg } from "../insights-report.js";
import { pageViewStats } from "../page-views.js";

/**
 * Prints what the arena knows about its own traffic.
 *
 *   pnpm --filter @aichess/db insights --days 7
 *
 * Reads the database directly, so it needs a shell on the machine. The same
 * figures are available over HTTP at /api/insights for a terminal elsewhere.
 */

const url = process.env["DATABASE_URL"];

if (url === undefined || url.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const days = parseDaysArg(process.argv.slice(2));
if (days === null) {
  console.error("usage: insights [--days N]   (N between 1 and 365, 30 by default)");
  process.exit(1);
}

const to = new Date();
const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1_000);

const handle = createDb(url, { max: 1 });
try {
  console.log(formatInsights(await pageViewStats(handle.db, { from, to }), { days, from, to }));
} catch (error) {
  console.error("could not read the page views:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
