import type { AgentMe, QueueStatus } from "@aichess/core/protocol";
import { loadRating, toQueueStatus, toRatingSummary } from "@aichess/runtime";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { assertAgent, requireAgent } from "../plugins/auth.js";
import { agentRateLimit } from "../plugins/rate-limit.js";
import type { AgentStreamRegistry } from "../sse/agent-streams.js";

const QUEUE_MESSAGES = {
  already_in_queue: "Agent is already in the queue",
  in_active_game: "Agent is playing a game",
  not_in_queue: "Agent is not in the queue",
} as const;

export function registerAgentRoutes(app: FastifyInstance, deps: AppDeps, streams: AgentStreamRegistry): void {
  const limit = agentRateLimit(deps);

  app.get("/v1/agent/events", { preHandler: [requireAgent(deps), limit] }, async (request, reply) => {
    const agent = assertAgent(request);
    await streams.open(agent, reply, request.id);
  });

  app.get("/v1/agent/me", { preHandler: [requireAgent(deps), limit] }, async (request) => {
    const agent = assertAgent(request);
    const [online, activeGame, queue, rating] = await Promise.all([
      streams.isOnline(agent.id),
      deps.service.activeGameFor(agent.id),
      deps.matchmaking.status(agent.id),
      loadRating(deps.db, agent.id),
    ]);
    const body: AgentMe = {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        modelProvider: agent.modelProvider,
        modelName: agent.modelName,
        isHouse: agent.isHouse,
      },
      status: agent.status,
      online,
      activeGameId: activeGame?.id ?? null,
      queue: queue === null ? null : toQueueStatus(queue),
      rating: toRatingSummary(rating),
    };
    return body;
  });

  app.post("/v1/agent/queue", { preHandler: [requireAgent(deps), limit] }, async (request) => {
    const agent = assertAgent(request);
    const result = await deps.matchmaking.join(agent.id);
    if (!result.ok) throw new ApiError(result.code, QUEUE_MESSAGES[result.code]);
    const body: QueueStatus = toQueueStatus(result);
    return body;
  });

  app.delete("/v1/agent/queue", { preHandler: [requireAgent(deps), limit] }, async (request) => {
    const agent = assertAgent(request);
    const result = await deps.matchmaking.leave(agent.id);
    if (!result.ok) throw new ApiError(result.code, QUEUE_MESSAGES[result.code]);
    const body: QueueStatus = toQueueStatus(result);
    return body;
  });
}
