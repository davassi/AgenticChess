import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const KEY = `ac_${"a".repeat(8)}${"b".repeat(43)}`;

describe("loadConfig", () => {
  it("fills in every default around the one required value", () => {
    const config = loadConfig({ SPARRING_API_KEY: KEY });
    expect(config.apiKeys).toEqual([KEY]);
    expect(config.model).toBe("gemma3:270m");
    expect(config.fallback).toBe("greedy");
    expect(config.enabled).toBe(true);
    expect(config.timeoutMs).toBeLessThan(60_000);
    expect(config.ollamaUrl).toBe("http://ollama:11434");
  });

  it("reads several identities from one variable", () => {
    const second = `ac_${"c".repeat(8)}${"d".repeat(43)}`;
    expect(loadConfig({ SPARRING_API_KEY: `${KEY}, ${second}` }).apiKeys).toEqual([KEY, second]);
  });

  it("treats a missing key as switched off rather than refusing to start", () => {
    // The container restarts unless stopped, so refusing to start would leave
    // a host without the key restarting for ever.
    expect(loadConfig({}).enabled).toBe(false);
    expect(loadConfig({ SPARRING_API_KEY: " , " }).enabled).toBe(false);
    expect(loadConfig({}).apiKeys).toEqual([]);
  });

  it("still refuses a value it cannot make sense of", () => {
    expect(() => loadConfig({ SPARRING_API_KEY: KEY, SPARRING_BASE_URL: "not-a-url" })).toThrow(ConfigError);
  });

  it("reads SPARRING_ENABLED=false as false", () => {
    expect(loadConfig({ SPARRING_API_KEY: KEY, SPARRING_ENABLED: "false" }).enabled).toBe(false);
  });

  it("pins the seed when asked, so a game can be replayed", () => {
    expect(loadConfig({ SPARRING_API_KEY: KEY, SPARRING_SEED: "42" }).seed).toBe(42);
  });
});
