import { describe, expect, it } from "vitest";
import { formatInsights, parseDaysArg } from "./insights-report.js";
import type { PageViewStats } from "./page-views.js";

const EMPTY: PageViewStats = {
  totalViews: 0,
  uniqueVisitors: 0,
  botViews: 0,
  byDay: [],
  topPaths: [],
  topReferrers: [],
};

const period = { days: 30, from: new Date("2026-08-07T00:00:00.000Z"), to: new Date("2026-09-06T00:00:00.000Z") };

describe("formatInsights", () => {
  it("names the period it is reporting on", () => {
    const report = formatInsights(EMPTY, period);

    expect(report).toContain("30 days");
    expect(report).toContain("2026-08-07");
    expect(report).toContain("2026-09-06");
  });

  it("says plainly when nobody came", () => {
    expect(formatInsights(EMPTY, period)).toContain("No page views in this period");
  });

  it("reports the headline figures", () => {
    const report = formatInsights({ ...EMPTY, totalViews: 1204, uniqueVisitors: 318, botViews: 87 }, period);

    expect(report).toMatch(/page views\s+1204/);
    expect(report).toMatch(/visitors\s+318/);
    expect(report).toMatch(/crawler views\s+87/);
  });

  it("warns that visitors are a daily figure, not a headcount", () => {
    const report = formatInsights({ ...EMPTY, totalViews: 1, uniqueVisitors: 1 }, period);

    expect(report).toContain("once per day");
  });

  it("lists the pages in the order they were given", () => {
    const report = formatInsights(
      {
        ...EMPTY,
        totalViews: 3,
        topPaths: [
          { path: "/docs.html", views: 2 },
          { path: "/arena", views: 1 },
        ],
      },
      period,
    );

    expect(report.indexOf("/docs.html")).toBeLessThan(report.indexOf("/arena"));
    expect(report).toMatch(/2\s+\/docs\.html/);
  });

  it("lists where the traffic came from", () => {
    const report = formatInsights(
      { ...EMPTY, totalViews: 1, topReferrers: [{ host: "news.ycombinator.com", views: 1 }] },
      period,
    );

    expect(report).toContain("news.ycombinator.com");
  });

  it("says so when nothing referred anyone", () => {
    const report = formatInsights({ ...EMPTY, totalViews: 1, topPaths: [{ path: "/arena", views: 1 }] }, period);

    expect(report).toContain("No referrers");
  });

  it("shows the day by day breakdown", () => {
    const report = formatInsights(
      { ...EMPTY, totalViews: 2, byDay: [{ day: "2026-09-05", views: 2, visitors: 1 }] },
      period,
    );

    expect(report).toMatch(/2026-09-05\s+2\s+1/);
  });
});

describe("parseDaysArg", () => {
  it("defaults to a month", () => {
    expect(parseDaysArg([])).toBe(30);
  });

  it("reads --days", () => {
    expect(parseDaysArg(["--days", "7"])).toBe(7);
  });

  it("reads --days=7 as well", () => {
    expect(parseDaysArg(["--days=7"])).toBe(7);
  });

  it("returns null for a value it will not accept", () => {
    expect(parseDaysArg(["--days", "0"])).toBeNull();
    expect(parseDaysArg(["--days", "week"])).toBeNull();
    expect(parseDaysArg(["--days"])).toBeNull();
  });
});

describe("parseDaysArg under another flag", () => {
  it("reads the flag it is given", () => {
    expect(parseDaysArg(["--older-than", "180"], "--older-than", null)).toBe(180);
  });

  it("refuses to assume a period when deleting, so an omitted flag is an error", () => {
    expect(parseDaysArg([], "--older-than", null)).toBeNull();
  });
});
