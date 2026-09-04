import Fastify, { type FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";
import { registerAuth } from "./plugins/auth.js";
import { registerCors } from "./plugins/cors.js";
import { registerErrorHandling } from "./plugins/error-handler.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerAgentReadRoutes } from "./routes/agents.js";
import { registerGameRoutes } from "./routes/games.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";
import { AgentStreamRegistry } from "./sse/agent-streams.js";
import { GameStreamRegistry } from "./sse/game-streams.js";

export type { AppDeps } from "./deps.js";

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    ...(deps.logger === undefined ? { logger: { level: deps.config.LOG_LEVEL } } : { loggerInstance: deps.logger }),
    requestIdHeader: "x-request-id",
    trustProxy: deps.config.TRUST_PROXY,
  });
  registerErrorHandling(app);
  await registerRateLimit(app, deps);
  await registerCors(app, deps);
  registerAuth(app);

  const agentStreams = new AgentStreamRegistry(deps);
  const gameStreams = new GameStreamRegistry(deps);
  app.addHook("onClose", async () => {
    agentStreams.closeAll();
    gameStreams.closeAll();
  });

  registerHealthRoutes(app, deps);
  registerAgentRoutes(app, deps, agentStreams);
  registerGameRoutes(app, deps, gameStreams);
  registerLeaderboardRoutes(app, deps);
  registerAgentReadRoutes(app, deps);
  registerInternalRoutes(app, deps);
  return app;
}
