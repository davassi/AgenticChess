import type { PageViewConfig, PageViewRequest } from "@aichess/db";
import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./analytics";
import { handleTrack, type TrackDeps } from "./track-handler";

const SALT = "0123456789abcdef0123456789abcdef";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";

interface Recorded {
  request: PageViewRequest;
  config: PageViewConfig;
}

const deps = (over: Partial<TrackDeps> = {}): TrackDeps & { recorded: Recorded[] } => {
  const recorded: Recorded[] = [];
  return {
    recorded,
    record: async (request, config) => {
      recorded.push({ request, config });
    },
    schedule: (work) => {
      work();
    },
    salt: SALT,
    limiter: createRateLimiter({ limit: 100, windowMs: 60_000, maxKeys: 100 }),
    now: () => new Date("2026-09-06T12:00:00.000Z"),
    ...over,
  };
};

const beacon = (body: unknown, extra: Record<string, string> = {}): Request =>
  new Request("https://agenticchess.online/api/track", {
    method: "POST",
    headers: {
      host: "agenticchess.online",
      "user-agent": FIREFOX,
      "x-forwarded-for": "203.0.113.7",
      ...extra,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("handleTrack", () => {
  it("records a view and answers with no content", async () => {
    const d = deps();

    const response = await handleTrack(beacon({ path: "/arena", surface: "app" }), d);

    expect(response.status).toBe(204);
    expect(d.recorded).toHaveLength(1);
    expect(d.recorded[0]?.request).toEqual({
      path: "/arena",
      surface: "app",
      referrer: "",
      ip: "203.0.113.7",
      userAgent: FIREFOX,
    });
  });

  it("takes the site's own host from the request, not from configuration", async () => {
    const d = deps();

    await handleTrack(beacon({ path: "/arena", surface: "app" }), d);

    expect(d.recorded[0]?.config.ownHost).toBe("agenticchess.online");
    expect(d.recorded[0]?.config.salt).toBe(SALT);
  });

  it("does the writing after the response, not before it", async () => {
    const scheduled: (() => void)[] = [];
    const d = deps({ schedule: (work) => scheduled.push(work) });

    const response = await handleTrack(beacon({ path: "/arena", surface: "app" }), d);

    expect(response.status).toBe(204);
    expect(d.recorded).toHaveLength(0);
    scheduled.forEach((work) => work());
    expect(d.recorded).toHaveLength(1);
  });

  it("records nothing when the visitor refused tracking", async () => {
    const d = deps();

    const response = await handleTrack(beacon({ path: "/arena", surface: "app" }, { dnt: "1" }), d);

    expect(response.status).toBe(204);
    expect(d.recorded).toHaveLength(0);
  });

  it("records nothing when no salt is configured", async () => {
    const d = deps({ salt: null });

    const response = await handleTrack(beacon({ path: "/arena", surface: "app" }), d);

    expect(response.status).toBe(204);
    expect(d.recorded).toHaveLength(0);
  });

  it("rejects a malformed body", async () => {
    const d = deps();

    const response = await handleTrack(beacon("not json"), d);

    expect(response.status).toBe(400);
    expect(d.recorded).toHaveLength(0);
  });

  it("refuses a caller past the limit without touching the database", async () => {
    const d = deps({ limiter: createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 }) });

    await handleTrack(beacon({ path: "/arena", surface: "app" }), d);
    const response = await handleTrack(beacon({ path: "/leaderboard", surface: "app" }), d);

    expect(response.status).toBe(429);
    expect(d.recorded).toHaveLength(1);
  });

  it("swallows a database failure: a broken counter must not reach a visitor", async () => {
    const failures: unknown[] = [];
    const d = deps({
      record: () => Promise.reject(new Error("connection refused")),
      onError: (error) => failures.push(error),
    });

    const response = await handleTrack(beacon({ path: "/arena", surface: "app" }), d);
    await vi.waitFor(() => expect(failures).toHaveLength(1));

    expect(response.status).toBe(204);
  });
});

describe("handleTrack and where the view came from", () => {
  it("records a view sent from one of our own pages", async () => {
    const d = deps();

    const response = await handleTrack(
      beacon({ path: "/arena", surface: "app" }, { origin: "https://agenticchess.online" }),
      d,
    );

    expect(response.status).toBe(204);
    expect(d.recorded).toHaveLength(1);
  });

  it("refuses a view posted from another site's page", async () => {
    const d = deps();

    const response = await handleTrack(beacon({ path: "/arena", surface: "app" }, { origin: "https://evil.test" }), d);

    expect(response.status).toBe(403);
    expect(d.recorded).toHaveLength(0);
  });

  it("refuses before spending any of the caller's rate limit budget", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 });
    const d = deps({ limiter });

    await handleTrack(beacon({ path: "/arena", surface: "app" }, { origin: "https://evil.test" }), d);
    const response = await handleTrack(beacon({ path: "/arena", surface: "app" }), d);

    expect(response.status).toBe(204);
    expect(d.recorded).toHaveLength(1);
  });
});
