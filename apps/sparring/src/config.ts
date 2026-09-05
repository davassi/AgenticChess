import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const EnvSchema = z.object({
  // z.stringbool, not z.coerce.boolean: the latter reads "false" as true, and
  // an off switch that cannot be switched off is worse than none.
  SPARRING_ENABLED: z.stringbool().default(true),
  // Optional on purpose: a stack brought up without a key runs without a house
  // agent rather than refusing to start.
  SPARRING_API_KEY: z.string().default(""),
  SPARRING_BASE_URL: z.url().default("http://api:3001"),
  OLLAMA_URL: z.url().default("http://ollama:11434"),
  SPARRING_MODEL: z.string().min(1).default("gemma3:270m"),
  // Far below the arena's 60 s turn, so a slow generation costs a fallback move
  // rather than the game.
  SPARRING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(45_000).default(15_000),
  SPARRING_FALLBACK: z.enum(["greedy", "random"]).default("greedy"),
  SPARRING_SEED: z.coerce.number().int().optional(),
  // How often to re-assert the queue membership. The arena drops a queued
  // agent seconds after its stream closes, so this is the outer bound on how
  // long the practice queue can be empty without anyone noticing.
  SPARRING_PRESENCE_SWEEP_MS: z.coerce.number().int().min(5_000).max(600_000).default(60_000),
  SPARRING_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3003),
  SPARRING_HEALTH_HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.string().min(1).default("info"),
});

export interface SparringConfig {
  enabled: boolean;
  /** One per house identity. A second is a comma in the environment. */
  apiKeys: string[];
  baseUrl: string;
  ollamaUrl: string;
  model: string;
  timeoutMs: number;
  fallback: "greedy" | "random";
  seed: number;
  presenceSweepMs: number;
  healthPort: number;
  healthHost: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SparringConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new ConfigError(`the sparring service cannot start: ${issues}`);
  }
  const value = parsed.data;
  const apiKeys = value.SPARRING_API_KEY.split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  return {
    // No key is the same as switched off. It is how a stack that has not been
    // given one yet comes up: healthy, idle, and out of the way.
    enabled: value.SPARRING_ENABLED && apiKeys.length > 0,
    apiKeys,
    baseUrl: value.SPARRING_BASE_URL,
    ollamaUrl: value.OLLAMA_URL,
    model: value.SPARRING_MODEL,
    timeoutMs: value.SPARRING_TIMEOUT_MS,
    fallback: value.SPARRING_FALLBACK,
    // A fresh stream every start unless pinned, so two restarts do not replay
    // the same fallback moves.
    seed: value.SPARRING_SEED ?? Date.now(),
    presenceSweepMs: value.SPARRING_PRESENCE_SWEEP_MS,
    healthPort: value.SPARRING_HEALTH_PORT,
    healthHost: value.SPARRING_HEALTH_HOST,
    logLevel: value.LOG_LEVEL,
  };
}
