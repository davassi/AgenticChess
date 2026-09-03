import { ConfigError, RuntimeEnvSchema, parseEnv } from "@aichess/runtime";
import { z } from "zod";

export { ConfigError };

const EnvSchema = RuntimeEnvSchema.extend({
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(500).default(10_000),
  RECONCILE_STALE_TURN_MS: z.coerce.number().int().min(100).default(10_000),
  DEADLINE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3002),
  WORKER_HEALTH_HOST: z.string().min(1).default("0.0.0.0"),
  MATCHMAKING_INTERVAL_MS: z.coerce.number().int().min(500).default(3_000),
  MATCHMAKING_OFFLINE_GRACE_MS: z.coerce.number().int().min(0).default(15_000),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return parseEnv(EnvSchema, env);
}
