import type { PageViewStats } from "./page-views.js";

export interface InsightsPeriod {
  days: number;
  from: Date;
  to: Date;
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

const figure = (label: string, value: number, note = ""): string =>
  `  ${label.padEnd(16)}${String(value).padStart(8)}${note === "" ? "" : `   ${note}`}`;

const rank = (rows: { label: string; views: number }[]): string =>
  rows.map((row) => `  ${String(row.views).padStart(6)}  ${row.label}`).join("\n");

/**
 * The whole report as one string, so the command that prints it stays a shell
 * around this function and the shape of the output can be tested without a
 * database or a terminal.
 */
export function formatInsights(stats: PageViewStats, period: InsightsPeriod): string {
  const heading = [
    `Agentic Chess — ${String(period.days)} days, ${day(period.from)} to ${day(period.to)}`,
    "",
    figure("page views", stats.totalViews),
    figure("visitors", stats.uniqueVisitors, "counted once per day, not a headcount"),
    figure("crawler views", stats.botViews, "left out of the figures above"),
  ].join("\n");

  if (stats.totalViews === 0) {
    return `${heading}\n\n  No page views in this period.\n`;
  }

  const byDay =
    stats.byDay.length === 0
      ? ""
      : [
          "",
          "Per day",
          `  ${"date".padEnd(12)}${"views".padStart(7)}${"visitors".padStart(10)}`,
          ...stats.byDay.map(
            (row) => `  ${row.day.padEnd(12)}${String(row.views).padStart(7)}${String(row.visitors).padStart(10)}`,
          ),
        ].join("\n");

  const paths = ["", "Top pages", rank(stats.topPaths.map((row) => ({ label: row.path, views: row.views })))].join(
    "\n",
  );

  const referrers =
    stats.topReferrers.length === 0
      ? ["", "Top referrers", "  No referrers: every visit was typed, bookmarked or private."].join("\n")
      : ["", "Top referrers", rank(stats.topReferrers.map((row) => ({ label: row.host, views: row.views })))].join(
          "\n",
        );

  return `${heading}\n${byDay}\n${paths}\n${referrers}\n`;
}

const MAX_DAYS = 365;

/**
 * A whole number of days from `--days`, or from whichever flag is named.
 * Null means the argument list asked for something the command will not do —
 * including omitting the flag where `fallback` is null, which is how the purge
 * refuses to assume a period and delete more than was meant.
 */
export function parseDaysArg(argv: string[], flagName = "--days", fallback: number | null = 30): number | null {
  const prefix = `${flagName}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  const flag = argv.indexOf(flagName);
  const missing = fallback === null ? undefined : String(fallback);
  const raw = inline !== undefined ? inline.slice(prefix.length) : flag === -1 ? missing : argv[flag + 1];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const days = Number(raw);
  return days >= 1 && days <= MAX_DAYS ? days : null;
}
