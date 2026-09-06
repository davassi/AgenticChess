import { describe, expect, it } from "vitest";
import { looksLikeBot, normalizePath, referrerHost, utcDay, visitorHash } from "./page-view.js";

describe("normalizePath", () => {
  it("keeps a plain route as it is", () => {
    expect(normalizePath("/arena")).toBe("/arena");
  });

  it("keeps the root as a single slash", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("drops a trailing slash so one page is one row", () => {
    expect(normalizePath("/arena/")).toBe("/arena");
  });

  it("drops the query string, which can carry anything", () => {
    expect(normalizePath("/games?page=2&q=private")).toBe("/games");
  });

  it("drops the fragment", () => {
    expect(normalizePath("/agent.html#opusbot")).toBe("/agent.html");
  });

  it("collapses repeated slashes", () => {
    expect(normalizePath("//games///archive")).toBe("/games/archive");
  });

  it("adds the leading slash a hostile client may omit", () => {
    expect(normalizePath("arena")).toBe("/arena");
  });

  it("replaces a game id so the top pages are pages, not identifiers", () => {
    expect(normalizePath("/games/4d1c9c96-0f7a-4e2b-9f3d-2b8a1c5e7d40")).toBe("/games/:id");
  });

  it("replaces an agent slug, whatever it is", () => {
    expect(normalizePath("/agents/opusbot")).toBe("/agents/:slug");
  });

  it("leaves the agents index alone", () => {
    expect(normalizePath("/agents")).toBe("/agents");
  });

  it("keeps the .html suffix that tells the two surfaces apart", () => {
    expect(normalizePath("/docs.html")).toBe("/docs.html");
  });

  it("keeps an unknown path so a wave of bogus URLs stays visible", () => {
    expect(normalizePath("/wp-admin/setup-config.php")).toBe("/wp-admin/setup-config.php");
  });

  it("truncates an absurdly long path instead of storing it", () => {
    const long = `/${"a".repeat(400)}`;
    expect(normalizePath(long)).toHaveLength(128);
  });

  it("falls back to the root for an empty path", () => {
    expect(normalizePath("")).toBe("/");
  });
});

describe("utcDay", () => {
  it("names the day the identifier rotates on", () => {
    expect(utcDay(new Date("2026-09-06T14:31:00.000Z"))).toBe("2026-09-06");
  });

  it("uses UTC, not the server's zone, so the rotation is one worldwide event", () => {
    expect(utcDay(new Date("2026-09-06T23:30:00.000Z"))).toBe("2026-09-06");
    expect(utcDay(new Date("2026-09-07T00:30:00.000Z"))).toBe("2026-09-07");
  });
});

describe("visitorHash", () => {
  const base = {
    salt: "a-salt-at-least-thirty-two-characters",
    day: "2026-09-06",
    ip: "203.0.113.7",
    userAgent: "Firefox",
  };

  it("produces a sha256 in hex", () => {
    expect(visitorHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same visitor within the day", () => {
    expect(visitorHash(base)).toBe(visitorHash({ ...base }));
  });

  it("changes at midnight, so nobody can be followed across days", () => {
    expect(visitorHash({ ...base, day: "2026-09-07" })).not.toBe(visitorHash(base));
  });

  it("separates two addresses", () => {
    expect(visitorHash({ ...base, ip: "203.0.113.8" })).not.toBe(visitorHash(base));
  });

  it("separates two browsers behind one address", () => {
    expect(visitorHash({ ...base, userAgent: "Chrome" })).not.toBe(visitorHash(base));
  });

  it("changes with the salt, so a leaked hash cannot be tested against a guess", () => {
    expect(visitorHash({ ...base, salt: "another-salt-of-thirty-two-characters" })).not.toBe(visitorHash(base));
  });

  it("never carries the address through to the output", () => {
    expect(visitorHash(base)).not.toContain("203.0.113.7");
  });

  it("does not let a crafted field impersonate another visitor", () => {
    // Concatenating without separators would make ("1.1.1.1", "2Firefox") and
    // ("1.1.1.12", "Firefox") collide.
    const a = visitorHash({ ...base, ip: "1.1.1.1", userAgent: "2Firefox" });
    const b = visitorHash({ ...base, ip: "1.1.1.12", userAgent: "Firefox" });
    expect(a).not.toBe(b);
  });
});

describe("looksLikeBot", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "curl/8.5.0",
    "python-requests/2.32.3",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0.0.0 Safari/537.36",
    "facebookexternalhit/1.1",
    "Slackbot-LinkExpanding 1.0",
    "Better Uptime Bot",
  ])("marks %s", (agent) => {
    expect(looksLikeBot(agent)).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  ])("leaves %s alone", (agent) => {
    expect(looksLikeBot(agent)).toBe(false);
  });

  it("treats a missing user agent as suspect, since every browser sends one", () => {
    expect(looksLikeBot("")).toBe(true);
  });

  it("ignores case, because the patterns are written lowercase", () => {
    expect(looksLikeBot("CURL/8.5.0")).toBe(true);
  });
});

describe("referrerHost", () => {
  const own = "agenticchess.online";

  it("keeps the host and drops the rest of the URL", () => {
    expect(referrerHost("https://news.ycombinator.com/item?id=42&user=someone", own)).toBe("news.ycombinator.com");
  });

  it("returns null for our own pages, which are not a source of traffic", () => {
    expect(referrerHost("https://agenticchess.online/arena", own)).toBeNull();
  });

  it("returns null when the browser sent no referrer", () => {
    expect(referrerHost("", own)).toBeNull();
  });

  it("returns null instead of throwing on a malformed URL", () => {
    expect(referrerHost("not a url", own)).toBeNull();
  });

  it("folds www. away so one source is one row", () => {
    expect(referrerHost("https://www.google.com/search?q=agentic+chess", own)).toBe("google.com");
  });

  it("lowercases the host", () => {
    expect(referrerHost("https://News.YCombinator.com/", own)).toBe("news.ycombinator.com");
  });

  it("treats the www of our own domain as internal too", () => {
    expect(referrerHost("https://www.agenticchess.online/", own)).toBeNull();
  });
});
