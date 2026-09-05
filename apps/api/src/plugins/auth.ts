import { hashApiKey, keysMatch, splitApiKey } from "@aichess/core";
import type { AgentStatus } from "@aichess/core/protocol";
import { agents } from "@aichess/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";

export interface AuthenticatedAgent {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  modelProvider: string;
  modelName: string;
  isHouse: boolean;
  status: AgentStatus;
}

declare module "fastify" {
  interface FastifyRequest {
    agent: AuthenticatedAgent | null;
  }
}

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest("agent", null);
}

function bearerToken(header: string | undefined): string | null | undefined {
  if (header === undefined) return undefined;
  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (scheme === undefined || scheme.toLowerCase() !== "bearer" || token === undefined || rest.length > 0) return null;
  return token;
}

async function resolveAgent(deps: AppDeps, request: FastifyRequest): Promise<AuthenticatedAgent | null> {
  const token = bearerToken(request.headers.authorization);
  if (token === undefined) return null;
  if (token === null) throw new ApiError("unauthorized", "Malformed Authorization header");
  const parts = splitApiKey(token);
  if (parts === null) throw new ApiError("unauthorized", "Invalid API key");

  const candidates = await deps.db
    .select({
      id: agents.id,
      ownerId: agents.ownerId,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
      isHouse: agents.isHouse,
      status: agents.status,
      apiKeyHash: agents.apiKeyHash,
    })
    .from(agents)
    .where(eq(agents.apiKeyPrefix, parts.prefix));

  const provided = hashApiKey(token);
  const match = candidates.find((row) => keysMatch(provided, row.apiKeyHash));
  if (match === undefined) throw new ApiError("unauthorized", "Invalid API key");
  if (match.status === "suspended") throw new ApiError("agent_suspended", "Agent is suspended");
  return {
    id: match.id,
    ownerId: match.ownerId,
    name: match.name,
    slug: match.slug,
    modelProvider: match.modelProvider,
    modelName: match.modelName,
    isHouse: match.isHouse,
    status: match.status,
  };
}

export function requireAgent(deps: AppDeps): preHandlerAsyncHookHandler {
  return async (request) => {
    const agent = await resolveAgent(deps, request);
    if (agent === null) throw new ApiError("unauthorized", "Missing Authorization header");
    request.agent = agent;
  };
}

export function optionalAgent(deps: AppDeps): preHandlerAsyncHookHandler {
  return async (request) => {
    request.agent = await resolveAgent(deps, request);
  };
}

export function assertAgent(request: FastifyRequest): AuthenticatedAgent {
  if (request.agent === null) throw new ApiError("unauthorized", "Missing Authorization header");
  return request.agent;
}
