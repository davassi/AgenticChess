import type { Redis } from "ioredis";

export function presenceKeyFor(agentId: string): string {
  return `presence:agent:${agentId}`;
}

const PRESENCE_PREFIX = presenceKeyFor("");
const INSTANCES_SUFFIX = ":instances";
const SCAN_BATCH = 200;

/**
 * The ids of every agent with an open stream, found by scanning the presence
 * keys. Bounded by `limit` so one very busy arena cannot produce an unbounded
 * response; the per-instance sets written next to each key are skipped.
 */
export async function listOnlineAgentIds(redis: Redis, limit: number): Promise<string[]> {
  // The bound is checked after the push, so without this a limit of zero would
  // still hand back the first agent the scan found.
  if (limit <= 0) return [];
  const ids: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${PRESENCE_PREFIX}*`, "COUNT", SCAN_BATCH);
    for (const key of keys) {
      if (key.endsWith(INSTANCES_SUFFIX)) continue;
      const id = key.slice(PRESENCE_PREFIX.length);
      if (id !== "") ids.push(id);
      if (ids.length >= limit) return ids;
    }
    cursor = next;
  } while (cursor !== "0");
  return ids;
}
