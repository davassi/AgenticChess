import { visitorHash } from "@aichess/core";
import { desc } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  pageViewStats,
  purgePageViews,
  recordPageView,
  type PageViewConfig,
  type PageViewRequest,
} from "./page-views.js";
import { pageViews } from "./schema/index.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

describe("recordPageView", () => {
  let tdb: TestDatabase;

  const config: PageViewConfig = {
    salt: "a-salt-that-is-at-least-thirty-two-chars",
    ownHost: "agenticchess.online",
    now: new Date("2026-09-06T12:00:00.000Z"),
  };

  const request: PageViewRequest = {
    path: "/arena",
    surface: "app",
    referrer: "",
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
  };

  const rows = async (): Promise<(typeof pageViews.$inferSelect)[]> =>
    tdb.db.select().from(pageViews).orderBy(desc(pageViews.occurredAt));

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  it("stores one row for one view", async () => {
    await recordPageView(tdb.db, request, config);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.path).toBe("/arena");
    expect(stored[0]?.surface).toBe("app");
    expect(stored[0]?.isBot).toBe(false);
    expect(stored[0]?.referrerHost).toBeNull();
  });

  it("stores the identifier and never the address", async () => {
    await recordPageView(tdb.db, request, config);

    const stored = await rows();
    expect(stored[0]?.visitorId).toBe(
      visitorHash({ salt: config.salt, day: "2026-09-06", ip: request.ip, userAgent: request.userAgent }),
    );
    expect(JSON.stringify(stored)).not.toContain(request.ip);
    expect(JSON.stringify(stored)).not.toContain("Firefox");
  });

  it("normalizes the path so one page is one row", async () => {
    await recordPageView(tdb.db, { ...request, path: "/games/4d1c9c96-0f7a-4e2b-9f3d-2b8a1c5e7d40?x=1" }, config);

    expect((await rows())[0]?.path).toBe("/games/:id");
  });

  it("keeps the referring host and drops the rest of the URL", async () => {
    await recordPageView(tdb.db, { ...request, referrer: "https://news.ycombinator.com/item?id=42" }, config);

    expect((await rows())[0]?.referrerHost).toBe("news.ycombinator.com");
  });

  it("marks a crawler instead of dropping it", async () => {
    await recordPageView(tdb.db, { ...request, userAgent: "curl/8.5.0" }, config);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.isBot).toBe(true);
  });

  it("gives the same visitor one identifier across pages of the same day", async () => {
    await recordPageView(tdb.db, request, config);
    await recordPageView(tdb.db, { ...request, path: "/leaderboard" }, config);

    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored[0]?.visitorId).toBe(stored[1]?.visitorId);
  });

  it("gives the same visitor a new identifier the next day", async () => {
    await recordPageView(tdb.db, request, config);
    await recordPageView(tdb.db, request, { ...config, now: new Date("2026-09-07T12:00:00.000Z") });

    const stored = await rows();
    expect(stored[0]?.visitorId).not.toBe(stored[1]?.visitorId);
  });
});

describe("pageViewStats", () => {
  let tdb: TestDatabase;

  const config: PageViewConfig = {
    salt: "a-salt-that-is-at-least-thirty-two-chars",
    ownHost: "agenticchess.online",
  };

  const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";
  const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15";

  const view = async (over: Partial<PageViewRequest> & { at: string }): Promise<void> => {
    const { at, ...rest } = over;
    await recordPageView(
      tdb.db,
      { path: "/arena", surface: "app", referrer: "", ip: "203.0.113.7", userAgent: firefox, ...rest },
      { ...config, now: new Date(at) },
    );
  };

  const range = { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-09-08T00:00:00.000Z") };

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  it("reports zeroes for a period with no traffic", async () => {
    const stats = await pageViewStats(tdb.db, range);

    expect(stats.totalViews).toBe(0);
    expect(stats.uniqueVisitors).toBe(0);
    expect(stats.byDay).toEqual([]);
    expect(stats.topPaths).toEqual([]);
    expect(stats.topReferrers).toEqual([]);
  });

  it("counts the views inside the period only", async () => {
    await view({ at: "2026-08-31T23:59:00.000Z" });
    await view({ at: "2026-09-01T00:00:00.000Z" });
    await view({ at: "2026-09-07T23:59:00.000Z" });
    await view({ at: "2026-09-08T00:00:00.000Z" });

    expect((await pageViewStats(tdb.db, range)).totalViews).toBe(2);
  });

  it("counts one person once a day, which is all a daily identifier can promise", async () => {
    await view({ at: "2026-09-02T09:00:00.000Z" });
    await view({ at: "2026-09-02T18:00:00.000Z", path: "/leaderboard" });
    await view({ at: "2026-09-03T09:00:00.000Z" });

    const stats = await pageViewStats(tdb.db, range);
    expect(stats.totalViews).toBe(3);
    expect(stats.uniqueVisitors).toBe(2);
  });

  it("separates two people on the same day", async () => {
    await view({ at: "2026-09-02T09:00:00.000Z" });
    await view({ at: "2026-09-02T09:00:00.000Z", ip: "198.51.100.4", userAgent: safari });

    expect((await pageViewStats(tdb.db, range)).uniqueVisitors).toBe(2);
  });

  it("keeps crawlers out of the counts but says how many there were", async () => {
    await view({ at: "2026-09-02T09:00:00.000Z" });
    await view({ at: "2026-09-02T09:05:00.000Z", userAgent: "curl/8.5.0", ip: "198.51.100.9" });

    const stats = await pageViewStats(tdb.db, range);
    expect(stats.totalViews).toBe(1);
    expect(stats.botViews).toBe(1);
  });

  it("breaks the period down by day, newest last", async () => {
    await view({ at: "2026-09-03T09:00:00.000Z" });
    await view({ at: "2026-09-02T09:00:00.000Z" });
    await view({ at: "2026-09-02T10:00:00.000Z", path: "/leaderboard" });

    expect((await pageViewStats(tdb.db, range)).byDay).toEqual([
      { day: "2026-09-02", views: 2, visitors: 1 },
      { day: "2026-09-03", views: 1, visitors: 1 },
    ]);
  });

  it("ranks the pages by how often they were read", async () => {
    await view({ at: "2026-09-02T09:00:00.000Z", path: "/docs.html", surface: "site" });
    await view({ at: "2026-09-02T10:00:00.000Z", path: "/docs.html", surface: "site" });
    await view({ at: "2026-09-02T11:00:00.000Z", path: "/arena" });

    expect((await pageViewStats(tdb.db, range)).topPaths).toEqual([
      { path: "/docs.html", views: 2 },
      { path: "/arena", views: 1 },
    ]);
  });

  it("ranks where the traffic came from, ignoring visits with no referrer", async () => {
    await view({ at: "2026-09-02T09:00:00.000Z", referrer: "https://news.ycombinator.com/item?id=42" });
    await view({ at: "2026-09-02T10:00:00.000Z", referrer: "https://news.ycombinator.com/" });
    await view({ at: "2026-09-02T11:00:00.000Z", referrer: "https://www.google.com/search?q=x" });
    await view({ at: "2026-09-02T12:00:00.000Z" });

    expect((await pageViewStats(tdb.db, range)).topReferrers).toEqual([
      { host: "news.ycombinator.com", views: 2 },
      { host: "google.com", views: 1 },
    ]);
  });
});

describe("purgePageViews", () => {
  let tdb: TestDatabase;

  const config: PageViewConfig = { salt: "a-salt-that-is-at-least-thirty-two-chars", ownHost: "agenticchess.online" };

  const view = async (at: string): Promise<void> => {
    await recordPageView(
      tdb.db,
      { path: "/arena", surface: "app", referrer: "", ip: "203.0.113.7", userAgent: "Firefox/133.0" },
      { ...config, now: new Date(at) },
    );
  };

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  it("removes what is older than the cutoff and keeps the rest", async () => {
    await view("2026-03-01T00:00:00.000Z");
    await view("2026-09-01T00:00:00.000Z");

    const removed = await purgePageViews(tdb.db, new Date("2026-06-01T00:00:00.000Z"));

    expect(removed).toBe(1);
    expect(await tdb.db.select().from(pageViews)).toHaveLength(1);
  });

  it("keeps a row that falls exactly on the cutoff", async () => {
    await view("2026-06-01T00:00:00.000Z");

    expect(await purgePageViews(tdb.db, new Date("2026-06-01T00:00:00.000Z"))).toBe(0);
  });

  it("reports nothing removed when there is nothing to remove", async () => {
    expect(await purgePageViews(tdb.db, new Date("2026-06-01T00:00:00.000Z"))).toBe(0);
  });
});
