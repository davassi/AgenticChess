import type { PageViewRange, PageViewStats } from "@aichess/db";
import { describe, expect, it } from "vitest";
import { handleInsights, type InsightsDeps } from "./insights-handler";

const TOKEN = "0123456789abcdef0123456789abcdef";

const EMPTY: PageViewStats = {
  totalViews: 0,
  uniqueVisitors: 0,
  botViews: 0,
  byDay: [],
  topPaths: [],
  topReferrers: [],
};

const deps = (over: Partial<InsightsDeps> = {}): InsightsDeps & { asked: PageViewRange[] } => {
  const asked: PageViewRange[] = [];
  return {
    asked,
    stats: async (range) => {
      asked.push(range);
      return { ...EMPTY, totalViews: 42 };
    },
    token: TOKEN,
    now: () => new Date("2026-09-06T12:00:00.000Z"),
    ...over,
  };
};

const ask = (query = "", token: string | null = TOKEN): Request =>
  new Request(`https://agenticchess.online/api/insights${query}`, {
    headers: token === null ? {} : { "x-analytics-token": token },
  });

describe("handleInsights", () => {
  it("answers with the statistics for the default month", async () => {
    const d = deps();

    const response = await handleInsights(ask(), d);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalViews: 42, days: 30 });
    expect(d.asked[0]?.to).toEqual(new Date("2026-09-06T12:00:00.000Z"));
    expect(d.asked[0]?.from).toEqual(new Date("2026-08-07T12:00:00.000Z"));
  });

  it("takes the period from the query", async () => {
    const d = deps();

    await handleInsights(ask("?days=7"), d);

    expect(d.asked[0]?.from).toEqual(new Date("2026-08-30T12:00:00.000Z"));
  });

  it("refuses a period it will not serve", async () => {
    const d = deps();

    expect((await handleInsights(ask("?days=400"), d)).status).toBe(400);
    expect(d.asked).toHaveLength(0);
  });

  it("refuses a caller with no token", async () => {
    const d = deps();

    expect((await handleInsights(ask("", null), d)).status).toBe(401);
    expect(d.asked).toHaveLength(0);
  });

  it("refuses a caller with the wrong token", async () => {
    const d = deps();

    expect((await handleInsights(ask("", "00000000000000000000000000000000"), d)).status).toBe(401);
    expect(d.asked).toHaveLength(0);
  });

  it("refuses a token of a different length without leaking that fact", async () => {
    const d = deps();

    expect((await handleInsights(ask("", "short"), d)).status).toBe(401);
  });

  it("says the feature is off rather than pretending the token is wrong", async () => {
    const d = deps({ token: null });

    expect((await handleInsights(ask(), d)).status).toBe(503);
    expect(d.asked).toHaveLength(0);
  });

  it("is never cached, since the answer changes with every visit", async () => {
    const response = await handleInsights(ask(), deps());

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
