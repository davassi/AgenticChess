import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { assertAgent, requireAgent } from "../plugins/auth.js";
import { agentRateLimit } from "../plugins/rate-limit.js";
import type { AgentStreamRegistry } from "../sse/agent-streams.js";

export function registerAgentRoutes(app: FastifyInstance, deps: AppDeps, streams: AgentStreamRegistry): void {
  const limit = agentRateLimit(deps);

  app.get("/v1/agent/events", { preHandler: requireAgent(deps), config: limit }, async (request, reply) => {
    const agent = assertAgent(request);
    await streams.open(agent, reply, request.id);
  });

  app.get("/v1/agent/me", { preHandler: requireAgent(deps), config: limit }, async (request) => {
    const agent = assertAgent(request);
    const [online, activeGame] = await Promise.all([streams.isOnline(agent.id), deps.service.activeGameFor(agent.id)]);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
      },
      status: agent.status,
      online,
      activeGameId: activeGame?.id ?? null,
    };
  });
}
