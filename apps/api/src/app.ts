import Fastify, { type FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";
import { registerErrorHandling } from "./plugins/error-handler.js";
import { registerHealthRoutes } from "./routes/health.js";

export type { AppDeps } from "./deps.js";

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.LOG_LEVEL },
    requestIdHeader: "x-request-id",
    trustProxy: deps.config.TRUST_PROXY,
  });
  registerErrorHandling(app);
  registerHealthRoutes(app, deps);
  return app;
}
