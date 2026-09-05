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

  it("says what is missing instead of starting without a key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ SPARRING_API_KEY: " , " })).toThrow(/holds no key/);
  });

  it("reads SPARRING_ENABLED=false as false", () => {
    expect(loadConfig({ SPARRING_API_KEY: KEY, SPARRING_ENABLED: "false" }).enabled).toBe(false);
  });

  it("pins the seed when asked, so a game can be replayed", () => {
    expect(loadConfig({ SPARRING_API_KEY: KEY, SPARRING_SEED: "42" }).seed).toBe(42);
  });
});
