import type { GameConfig } from "@aichess/core/protocol";
import { z } from "zod";
import type { RuntimeConfig } from "./runtime.js";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export const BooleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.trim().toLowerCase() === "true" || v.trim() === "1"));

export const RuntimeEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  DEFAULT_TIME_PER_MOVE_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  MOVE_LIMIT_PLIES: z.coerce.number().int().min(2).max(2_000).default(300),
  ILLEGAL_ATTEMPTS_PER_TURN: z.coerce.number().int().min(1).max(10).default(3),
});

export type RuntimeEnv = z.infer<typeof RuntimeEnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseEnv<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
}

export function gameConfigFrom(
  env: Pick<RuntimeEnv, "DEFAULT_TIME_PER_MOVE_MS" | "MOVE_LIMIT_PLIES" | "ILLEGAL_ATTEMPTS_PER_TURN">,
): GameConfig {
  return {
    timePerMoveMs: env.DEFAULT_TIME_PER_MOVE_MS,
    moveLimitPlies: env.MOVE_LIMIT_PLIES,
    illegalAttemptsPerTurn: env.ILLEGAL_ATTEMPTS_PER_TURN,
  };
}

export function runtimeConfigFrom(env: RuntimeEnv): RuntimeConfig {
  return { databaseUrl: env.DATABASE_URL, redisUrl: env.REDIS_URL, game: gameConfigFrom(env) };
}
