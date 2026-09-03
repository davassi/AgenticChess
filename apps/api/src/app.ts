import Fastify, { type FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";
import { registerAuth } from "./plugins/auth.js";
import { registerCors } from "./plugins/cors.js";
import { registerErrorHandling } from "./plugins/error-handler.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerGameRoutes } from "./routes/games.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInternalRoutes } from "./routes/internal.js";

export type { AppDeps } from "./deps.js";

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    requestIdHeader: "x-request-id",
    trustProxy: deps.config.TRUST_PROXY,
  });
  registerErrorHandling(app);
  await registerRateLimit(app, deps);
  await registerCors(app, deps);
  registerAuth(app);
  registerHealthRoutes(app, deps);
  registerGameRoutes(app, deps);
  registerInternalRoutes(app, deps);
  return app;
}
