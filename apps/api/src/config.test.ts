import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", REDIS_URL: "redis://localhost:6379" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      API_PORT: 3001,
      API_HOST: "0.0.0.0",
      DEFAULT_TIME_PER_MOVE_MS: 60_000,
      MOVE_LIMIT_PLIES: 300,
      ILLEGAL_ATTEMPTS_PER_TURN: 3,
      RATE_LIMIT_AGENT_PER_MINUTE: 120,
      RATE_LIMIT_PUBLIC_PER_MINUTE: 300,
      SSE_PING_INTERVAL_MS: 15_000,
      PRESENCE_TTL_SECONDS: 30,
      LOG_LEVEL: "info",
      TRUST_PROXY: false,
    });
    expect(config.WEB_ORIGIN).toBeUndefined();
    expect(config.INTERNAL_API_TOKEN).toBeUndefined();
  });

  it("coerces numbers and booleans from strings", () => {
    const config = loadConfig({ ...base, API_PORT: "8080", TRUST_PROXY: "true", SSE_PING_INTERVAL_MS: "5000" });
    expect(config.API_PORT).toBe(8080);
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.SSE_PING_INTERVAL_MS).toBe(5_000);
  });

  it("names every invalid variable", () => {
    expect(() => loadConfig({ REDIS_URL: "redis://x", API_PORT: "abc" })).toThrow(ConfigError);
    try {
      loadConfig({ REDIS_URL: "redis://x", API_PORT: "abc" });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("API_PORT");
    }
  });

  it("rejects an internal token that is too short", () => {
    expect(() => loadConfig({ ...base, INTERNAL_API_TOKEN: "short" })).toThrow(/INTERNAL_API_TOKEN/);
  });
});
