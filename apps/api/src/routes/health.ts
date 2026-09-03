import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

type CheckResult = "ok" | "fail";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/health", { config: { rateLimit: false } }, async (request, reply) => {
    const [postgres, redis] = await Promise.allSettled([deps.db.execute(sql`select 1`), deps.redis.ping()]);
    const checks: Record<"postgres" | "redis", CheckResult> = {
      postgres: postgres.status === "fulfilled" ? "ok" : "fail",
      redis: redis.status === "fulfilled" ? "ok" : "fail",
    };
    const healthy = checks.postgres === "ok" && checks.redis === "ok";
    if (!healthy) {
      request.log.warn({ checks }, "health check degraded");
    }
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? "ok" : "degraded", checks });
  });
}
