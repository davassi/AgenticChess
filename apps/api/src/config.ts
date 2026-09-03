import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const BooleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.trim().toLowerCase() === "true" || v.trim() === "1"));

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  WEB_ORIGIN: z.url().optional(),
  INTERNAL_API_TOKEN: z.string().min(32).optional(),
  DEFAULT_TIME_PER_MOVE_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  MOVE_LIMIT_PLIES: z.coerce.number().int().min(2).max(2_000).default(300),
  ILLEGAL_ATTEMPTS_PER_TURN: z.coerce.number().int().min(1).max(10).default(3),
  RATE_LIMIT_AGENT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SSE_PING_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().min(5).default(30),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  TRUST_PROXY: BooleanFromString.default(false),
});

export type ApiConfig = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
}
