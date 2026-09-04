import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";

const WINDOW = "1 minute";
const WINDOW_MS = 60_000;

const INCR_FIXED_WINDOW = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

export async function registerRateLimit(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: deps.config.RATE_LIMIT_PUBLIC_PER_MINUTE,
    timeWindow: WINDOW,
    redis: deps.redis,
    nameSpace: "ratelimit:",
    keyGenerator: (request) => `ip:${request.ip}`,
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

export function agentRateLimit(deps: AppDeps): preHandlerAsyncHookHandler {
  const max = deps.config.RATE_LIMIT_AGENT_PER_MINUTE;
  return async (request, reply) => {
    const agent = request.agent;
    if (agent === null) return;
    const key = `ratelimit:agent:${agent.id}`;
    const count = (await deps.redis.eval(INCR_FIXED_WINDOW, 1, key, String(WINDOW_MS))) as number;
    if (count <= max) return;
    const ttl = Math.max(await deps.redis.pttl(key), 0);
    reply.header("retry-after", Math.max(1, Math.ceil(ttl / 1000)));
    throw new ApiError("rate_limited", `Too many requests, retry in ${Math.ceil(ttl / 1000)} seconds`, {
      limit: max,
      retryAfterMs: ttl,
    });
  };
}
