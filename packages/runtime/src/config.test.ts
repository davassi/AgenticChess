import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigError, RuntimeEnvSchema, gameConfigFrom, parseEnv, runtimeConfigFrom } from "./config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", REDIS_URL: "redis://localhost:6379" };

describe("runtime config", () => {
  it("parses the shared variables with defaults", () => {
    const env = parseEnv(RuntimeEnvSchema, base);
    expect(env).toMatchObject({
      LOG_LEVEL: "info",
      DEFAULT_TIME_PER_MOVE_MS: 60_000,
      MOVE_LIMIT_PLIES: 300,
      ILLEGAL_ATTEMPTS_PER_TURN: 3,
    });
    expect(gameConfigFrom(env)).toEqual({
      timePerMoveMs: 60_000,
      moveLimitPlies: 300,
      illegalAttemptsPerTurn: 3,
      rated: true,
    });
    expect(runtimeConfigFrom(env)).toEqual({
      databaseUrl: base.DATABASE_URL,
      redisUrl: base.REDIS_URL,
      game: gameConfigFrom(env),
    });
  });

  it("names every invalid variable", () => {
    expect(() => parseEnv(RuntimeEnvSchema, { REDIS_URL: "redis://x", MOVE_LIMIT_PLIES: "1" })).toThrow(ConfigError);
    try {
      parseEnv(RuntimeEnvSchema, { REDIS_URL: "redis://x", MOVE_LIMIT_PLIES: "1" });
    } catch (error) {
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).toContain("MOVE_LIMIT_PLIES");
    }
  });

  it("lets apps extend the schema", () => {
    const schema = RuntimeEnvSchema.extend({ EXTRA_PORT: z.coerce.number().int().default(9) });
    expect(parseEnv(schema, base).EXTRA_PORT).toBe(9);
  });
});
