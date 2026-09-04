import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const BASE = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://y" };

describe("worker config", () => {
  it("applies matchmaking defaults", () => {
    const config = loadConfig(BASE);
    expect(config.MATCHMAKING_INTERVAL_MS).toBe(3_000);
    expect(config.MATCHMAKING_OFFLINE_GRACE_MS).toBe(15_000);
    expect(config.RECONCILE_INTERVAL_MS).toBe(10_000);
  });

  it("reads matchmaking overrides", () => {
    const config = loadConfig({ ...BASE, MATCHMAKING_INTERVAL_MS: "500", MATCHMAKING_OFFLINE_GRACE_MS: "0" });
    expect(config.MATCHMAKING_INTERVAL_MS).toBe(500);
    expect(config.MATCHMAKING_OFFLINE_GRACE_MS).toBe(0);
  });

  it("names the variable that is out of range", () => {
    expect(() => loadConfig({ ...BASE, MATCHMAKING_INTERVAL_MS: "100" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE, MATCHMAKING_INTERVAL_MS: "100" })).toThrow(/MATCHMAKING_INTERVAL_MS/);
  });
});
