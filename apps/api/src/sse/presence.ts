import { presenceKeyFor } from "@aichess/runtime";
import type { Redis } from "ioredis";

export function presenceInstancesKeyFor(agentId: string): string {
  return `presence:agent:${agentId}:instances`;
}

const CLEAR_INSTANCE = `
redis.call('SREM', KEYS[1], ARGV[1])
if redis.call('SCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
  return 1
end
return 0
`;

export async function markPresent(
  redis: Redis,
  agentId: string,
  instanceId: string,
  ttlSeconds: number,
): Promise<void> {
  const instances = presenceInstancesKeyFor(agentId);
  const presence = presenceKeyFor(agentId);
  await redis
    .multi()
    .sadd(instances, instanceId)
    .expire(instances, ttlSeconds)
    .set(presence, "1", "EX", ttlSeconds)
    .exec();
}

export async function clearPresent(redis: Redis, agentId: string, instanceId: string): Promise<void> {
  await redis.eval(CLEAR_INSTANCE, 2, presenceInstancesKeyFor(agentId), presenceKeyFor(agentId), instanceId);
}

export async function isPresent(redis: Redis, agentId: string): Promise<boolean> {
  return (await redis.exists(presenceKeyFor(agentId))) === 1;
}
