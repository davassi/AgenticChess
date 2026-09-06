import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter, originAllowed, parseDays, parseTrackBody, trackingRefused } from "./analytics";

const headers = (init: Record<string, string>): Headers => new Headers(init);

describe("clientIp", () => {
  it("reads the address the reverse proxy observed", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("takes the last hop, because Caddy appends to a chain the client can start", () => {
    // A visitor sending "x-forwarded-for: 1.2.3.4" would otherwise choose their
    // own identity and could invent a new visitor on every request.
    expect(clientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("tolerates the spacing proxies actually use", () => {
    expect(clientIp(headers({ "x-forwarded-for": "1.2.3.4,203.0.113.7 " }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("returns an empty string when no proxy header is present", () => {
    expect(clientIp(headers({}))).toBe("");
  });
});

describe("trackingRefused", () => {
  it("honours Do Not Track", () => {
    expect(trackingRefused(headers({ dnt: "1" }))).toBe(true);
  });

  it("honours Global Privacy Control", () => {
    expect(trackingRefused(headers({ "sec-gpc": "1" }))).toBe(true);
  });

  it("counts the visit when neither signal is sent", () => {
    expect(trackingRefused(headers({}))).toBe(false);
  });

  it("counts the visit when Do Not Track is explicitly off", () => {
    expect(trackingRefused(headers({ dnt: "0" }))).toBe(false);
  });
});

describe("parseTrackBody", () => {
  it("accepts what the beacon sends", () => {
    expect(parseTrackBody('{"path":"/arena","surface":"app","referrer":"https://x.test/"}')).toEqual({
      path: "/arena",
      surface: "app",
      referrer: "https://x.test/",
    });
  });

  it("defaults a missing referrer to empty", () => {
    expect(parseTrackBody('{"path":"/docs.html","surface":"site"}')?.referrer).toBe("");
  });

  it("rejects a body that is not JSON", () => {
    expect(parseTrackBody("not json")).toBeNull();
  });

  it("rejects a path that does not start with a slash", () => {
    expect(parseTrackBody('{"path":"https://evil.test/x","surface":"app"}')).toBeNull();
  });

  it("rejects a surface it does not know", () => {
    expect(parseTrackBody('{"path":"/arena","surface":"mainframe"}')).toBeNull();
  });

  it("rejects a path long enough to bloat the table", () => {
    expect(parseTrackBody(JSON.stringify({ path: `/${"a".repeat(600)}`, surface: "app" }))).toBeNull();
  });
});

describe("parseDays", () => {
  it("defaults to a month", () => {
    expect(parseDays(null)).toBe(30);
  });

  it("takes a number when given one", () => {
    expect(parseDays("7")).toBe(7);
  });

  it("refuses zero, negatives and nonsense", () => {
    expect(parseDays("0")).toBeNull();
    expect(parseDays("-3")).toBeNull();
    expect(parseDays("week")).toBeNull();
  });

  it("refuses more than a year, so one request cannot scan everything", () => {
    expect(parseDays("400")).toBeNull();
  });
});

describe("createRateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, maxKeys: 100 });
    expect([1, 2, 3].map((n) => limiter.allow("ip", n))).toEqual([true, true, true]);
  });

  it("refuses the one after the limit", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, maxKeys: 100 });
    limiter.allow("ip", 1);
    limiter.allow("ip", 2);
    expect(limiter.allow("ip", 3)).toBe(false);
  });

  it("forgets the window once it has passed", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 100 });
    limiter.allow("ip", 0);
    expect(limiter.allow("ip", 500)).toBe(false);
    expect(limiter.allow("ip", 1_500)).toBe(true);
  });

  it("keeps callers apart", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
    limiter.allow("a", 1);
    expect(limiter.allow("b", 1)).toBe(true);
  });

  it("stops growing, so a flood of addresses cannot exhaust memory", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 });
    for (let i = 0; i < 50; i += 1) limiter.allow(`ip-${i}`, 1);
    expect(limiter.size()).toBeLessThanOrEqual(10);
  });
});

describe("originAllowed", () => {
  it("accepts a page of our own site", () => {
    expect(originAllowed(headers({ origin: "https://agenticchess.online", host: "agenticchess.online" }))).toBe(true);
  });

  it("refuses a page of somebody else's site", () => {
    expect(originAllowed(headers({ origin: "https://evil.test", host: "agenticchess.online" }))).toBe(false);
  });

  it("keeps the port in the comparison, so development is not a special case", () => {
    expect(originAllowed(headers({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }))).toBe(true);
    expect(originAllowed(headers({ origin: "http://127.0.0.1:9999", host: "127.0.0.1:3100" }))).toBe(false);
  });

  it("ignores the scheme, which the proxy terminates anyway", () => {
    expect(originAllowed(headers({ origin: "http://agenticchess.online", host: "agenticchess.online" }))).toBe(true);
  });

  it("refuses an origin it cannot parse", () => {
    expect(originAllowed(headers({ origin: "not a url", host: "agenticchess.online" }))).toBe(false);
  });

  it("accepts a request with no origin at all", () => {
    // Browsers send Origin on every POST, so this is a non-browser caller — and
    // one that could equally well have written the header itself. Refusing here
    // would buy nothing and would silence the counter if a browser ever omitted
    // it. The rate limit is what stands in the way of a script.
    expect(originAllowed(headers({ host: "agenticchess.online" }))).toBe(true);
  });

  it("refuses when the request carries an origin but no host to compare it to", () => {
    expect(originAllowed(headers({ origin: "https://agenticchess.online" }))).toBe(false);
  });

  it("treats the null origin as a refusal, since a sandboxed frame sends it", () => {
    expect(originAllowed(headers({ origin: "null", host: "agenticchess.online" }))).toBe(false);
  });
});
