import { AgentSlugSchema, AgentsQuerySchema, type AgentListPage, type AgentProfile } from "@aichess/core/protocol";
import { listAgents, loadAgentProfile, toQueueStatus, type AgentsCursor } from "@aichess/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../cursor.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { isPresent } from "../sse/presence.js";
import { parseWith } from "../validation.js";

const ParamsSchema = z.object({ slug: AgentSlugSchema });
const AgentsCursorSchema = z.object({ name: z.string(), id: z.uuid() });

export function registerAgentReadRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/agents", async (request) => {
    const query = parseWith(AgentsQuerySchema, request.query, "query");
    const after: AgentsCursor | undefined =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor, AgentsCursorSchema);
    const rows = await listAgents(deps.db, {
      limit: query.limit + 1,
      ...(after === undefined ? {} : { after }),
    });
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    const body: AgentListPage = {
      items,
      nextCursor:
        rows.length > query.limit && last !== undefined
          ? encodeCursor({ name: last.agent.name, id: last.agent.id })
          : null,
    };
    return body;
  });

  app.get("/v1/agents/:slug", async (request) => {
    const { slug } = parseWith(ParamsSchema, request.params, "params");
    const base = await loadAgentProfile(deps.db, slug);
    if (base === null) throw new ApiError("not_found", "Agent not found");
    const [online, queue] = await Promise.all([
      isPresent(deps.redis, base.agent.id),
      deps.matchmaking.status(base.agent.id),
    ]);
    const body: AgentProfile = { ...base, online, queue: queue === null ? null : toQueueStatus(queue) };
    return body;
  });
}
