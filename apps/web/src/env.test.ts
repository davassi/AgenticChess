import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

const BASE = {
  API_PUBLIC_URL: "https://api.example.com",
  DATABASE_URL: "postgres://aichess:aichess@localhost:5432/aichess",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  AUTH_GITHUB_ID: "id",
  AUTH_GITHUB_SECRET: "secret",
};

describe("web configuration", () => {
  it("falls back to the public URL for server-side fetches", () => {
    const env = loadEnv(BASE);
    expect(env.apiPublicUrl).toBe("https://api.example.com");
    expect(env.apiInternalUrl).toBe("https://api.example.com");
    expect(env.adminEmails).toBe("");
  });

  it("caches the arena figures for a minute unless told otherwise", () => {
    expect(loadEnv(BASE).arenaStatsRevalidateSeconds).toBe(60);
    expect(loadEnv({ ...BASE, ARENA_STATS_REVALIDATE_SECONDS: "300" }).arenaStatsRevalidateSeconds).toBe(300);
    // Zero is the switch a test environment needs: read the figures every time,
    // so a page can be checked against a database that just changed.
    expect(loadEnv({ ...BASE, ARENA_STATS_REVALIDATE_SECONDS: "0" }).arenaStatsRevalidateSeconds).toBe(0);
  });

  it("refuses a caching window that is not a whole number of seconds", () => {
    expect(() => loadEnv({ ...BASE, ARENA_STATS_REVALIDATE_SECONDS: "-1" })).toThrow(/ARENA_STATS/);
    expect(() => loadEnv({ ...BASE, ARENA_STATS_REVALIDATE_SECONDS: "soon" })).toThrow(/ARENA_STATS/);
  });

  it("keeps a separate internal URL when one is given", () => {
    expect(loadEnv({ ...BASE, API_INTERNAL_URL: "http://api:3001" }).apiInternalUrl).toBe("http://api:3001");
  });

  it("drops a trailing slash so paths never double up", () => {
    expect(loadEnv({ ...BASE, API_PUBLIC_URL: "https://api.example.com/" }).apiPublicUrl).toBe(
      "https://api.example.com",
    );
  });

  it("fails loudly when the public URL is missing or malformed", () => {
    expect(() => loadEnv({ ...BASE, API_PUBLIC_URL: undefined })).toThrow(/API_PUBLIC_URL/);
    expect(() => loadEnv({ ...BASE, API_PUBLIC_URL: "not-a-url" })).toThrow(/API_PUBLIC_URL/);
  });

  it("refuses a weak session secret, the one mistake that silently costs sessions", () => {
    expect(() => loadEnv({ ...BASE, AUTH_SECRET: "too-short" })).toThrow(/AUTH_SECRET/);
    expect(() => loadEnv({ ...BASE, AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/);
  });

  it("requires the database and the GitHub app", () => {
    expect(() => loadEnv({ ...BASE, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...BASE, AUTH_GITHUB_ID: undefined })).toThrow(/AUTH_GITHUB_ID/);
  });
});

describe("analytics configuration", () => {
  it("leaves the counter off when no salt is configured", () => {
    const env = loadEnv(BASE);
    expect(env.analyticsSalt).toBeNull();
    expect(env.analyticsToken).toBeNull();
  });

  it("turns the counter on when a salt is given", () => {
    const env = loadEnv({ ...BASE, ANALYTICS_SALT: "0123456789abcdef0123456789abcdef" });
    expect(env.analyticsSalt).toBe("0123456789abcdef0123456789abcdef");
  });

  it("refuses a salt short enough to be worth guessing", () => {
    expect(() => loadEnv({ ...BASE, ANALYTICS_SALT: "short" })).toThrow(/ANALYTICS_SALT/);
  });

  it("refuses a reading token short enough to be worth guessing", () => {
    expect(() => loadEnv({ ...BASE, ANALYTICS_TOKEN: "short" })).toThrow(/ANALYTICS_TOKEN/);
  });
});
