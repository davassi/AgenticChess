import { and, count, countDistinct, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { looksLikeBot, normalizePath, referrerHost, utcDay, visitorHash, type ViewSurface } from "@aichess/core";
import type { Database } from "./client.js";
import { pageViews } from "./schema/index.js";

/** What the browser said. None of it is trusted, and none of it is stored as sent. */
export interface PageViewRequest {
  path: string;
  surface: ViewSurface;
  referrer: string;
  ip: string;
  userAgent: string;
}

/** What the server knows. Passed in rather than read from the environment here,
 * so this package stays a library and the tests stay hermetic. */
export interface PageViewConfig {
  salt: string;
  ownHost: string;
  now?: Date;
}

/**
 * The one place a view is written. Both surfaces reach the same endpoint and
 * the same function, so the rules about what is kept — the path collapsed, the
 * referrer reduced to a host, the address turned into a hash that expires —
 * exist once and cannot drift apart.
 */
export async function recordPageView(db: Database, request: PageViewRequest, config: PageViewConfig): Promise<void> {
  const now = config.now ?? new Date();
  await db.insert(pageViews).values({
    path: normalizePath(request.path),
    surface: request.surface,
    referrerHost: referrerHost(request.referrer, config.ownHost),
    visitorId: visitorHash({
      salt: config.salt,
      day: utcDay(now),
      ip: request.ip,
      userAgent: request.userAgent,
    }),
    isBot: looksLikeBot(request.userAgent),
    occurredAt: now,
  });
}

/** Half-open: `from` is included, `to` is not, so consecutive periods never overlap. */
export interface PageViewRange {
  from: Date;
  to: Date;
}

export interface DailyViews {
  day: string;
  views: number;
  visitors: number;
}

export interface PageViewStats {
  totalViews: number;
  /**
   * People, counted once per day. The identifier is reborn at midnight, so over
   * a longer period this is the sum of the daily figures and not a headcount —
   * the price of storing nothing that would allow the real one.
   */
  uniqueVisitors: number;
  /** Kept out of every other number here, and reported so the size of what was set aside is visible. */
  botViews: number;
  byDay: DailyViews[];
  topPaths: { path: string; views: number }[];
  topReferrers: { host: string; views: number }[];
}

const TOP_LIMIT = 20;

/**
 * Every figure the arena reports about its own traffic, from one function, so
 * the endpoint and the command line can never disagree about what a visit is.
 */
export async function pageViewStats(db: Database, range: PageViewRange): Promise<PageViewStats> {
  const within = and(gte(pageViews.occurredAt, range.from), lt(pageViews.occurredAt, range.to));
  const human = and(within, eq(pageViews.isBot, false));
  const day = sql<string>`to_char(${pageViews.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const [totals, bots, byDay, topPaths, referrers] = await Promise.all([
    db
      .select({ views: count(), visitors: countDistinct(pageViews.visitorId) })
      .from(pageViews)
      .where(human),
    db
      .select({ views: count() })
      .from(pageViews)
      .where(and(within, eq(pageViews.isBot, true))),
    db
      .select({ day, views: count(), visitors: countDistinct(pageViews.visitorId) })
      .from(pageViews)
      .where(human)
      .groupBy(day)
      .orderBy(day),
    db
      .select({ path: pageViews.path, views: count() })
      .from(pageViews)
      .where(human)
      .groupBy(pageViews.path)
      .orderBy(desc(count()), pageViews.path)
      .limit(TOP_LIMIT),
    db
      .select({ host: pageViews.referrerHost, views: count() })
      .from(pageViews)
      .where(and(human, isNotNull(pageViews.referrerHost)))
      .groupBy(pageViews.referrerHost)
      .orderBy(desc(count()), pageViews.referrerHost)
      .limit(TOP_LIMIT),
  ]);

  return {
    totalViews: totals[0]?.views ?? 0,
    uniqueVisitors: totals[0]?.visitors ?? 0,
    botViews: bots[0]?.views ?? 0,
    byDay,
    topPaths,
    // The query already excludes them; this narrows the type without a cast.
    topReferrers: referrers.flatMap((row) => (row.host === null ? [] : [{ host: row.host, views: row.views }])),
  };
}

/**
 * Forgets everything recorded before the cutoff, and answers with how many rows
 * that was. Kept as a command rather than a timer: deleting data on a schedule
 * is an operational decision, not part of counting visits.
 */
export async function purgePageViews(db: Database, before: Date): Promise<number> {
  const removed = await db.delete(pageViews).where(lt(pageViews.occurredAt, before)).returning({ id: pageViews.id });
  return removed.length;
}
