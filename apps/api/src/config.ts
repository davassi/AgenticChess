import { BooleanFromString, ConfigError, LOG_LEVELS, RuntimeEnvSchema, parseEnv } from "@aichess/runtime";
import { z } from "zod";

export { ConfigError, LOG_LEVELS };

const EnvSchema = RuntimeEnvSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  WEB_ORIGIN: z.url().optional(),
  INTERNAL_API_TOKEN: z.string().min(32).optional(),
  RATE_LIMIT_AGENT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  SSE_PING_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().min(5).default(30),
  TRUST_PROXY: BooleanFromString.default(false),
});

export type ApiConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return parseEnv(EnvSchema, env);
}
