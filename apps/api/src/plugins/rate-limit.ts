import { splitApiKey } from "@aichess/core";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppDeps } from "../deps.js";

const WINDOW = "1 minute";

function keyFor(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header !== undefined) {
    const token = header.trim().split(/\s+/)[1];
    const parts = token === undefined ? null : splitApiKey(token);
    if (parts !== null) return `key:${parts.prefix}`;
  }
  return `ip:${request.ip}`;
}

export async function registerRateLimit(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: deps.config.RATE_LIMIT_PUBLIC_PER_MINUTE,
    timeWindow: WINDOW,
    redis: deps.redis,
    nameSpace: "ratelimit:",
    keyGenerator: keyFor,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "rate_limited",
      message: `Too many requests, retry in ${Math.ceil(context.ttl / 1000)} seconds`,
      details: { limit: context.max, retryAfterMs: context.ttl },
    }),
  });
}

export function agentRateLimit(deps: AppDeps): { rateLimit: { max: number; timeWindow: string } } {
  return { rateLimit: { max: deps.config.RATE_LIMIT_AGENT_PER_MINUTE, timeWindow: WINDOW } };
}
