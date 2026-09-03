import type { Redis } from "ioredis";

export const QUEUE_KEY = "mm:queue";
export const QUEUE_META_KEY = "mm:meta";

export interface QueueEntry {
  agentId: string;
  rating: number;
  queuedAt: number;
}

export interface QueueMembership {
  queuedAt: number;
}

const JOIN_SCRIPT = `
if redis.call("ZSCORE", KEYS[1], ARGV[1]) then return 0 end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
redis.call("HSET", KEYS[2], ARGV[1], ARGV[3])
return 1`;

const LEAVE_SCRIPT = `
if not redis.call("ZSCORE", KEYS[1], ARGV[1]) then return {0, ""} end
local queuedAt = redis.call("HGET", KEYS[2], ARGV[1]) or ""
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("HDEL", KEYS[2], ARGV[1])
return {1, queuedAt}`;

const REMOVE_PAIR_SCRIPT = `
if not redis.call("ZSCORE", KEYS[1], ARGV[1]) then return 0 end
if not redis.call("ZSCORE", KEYS[1], ARGV[2]) then return 0 end
redis.call("ZREM", KEYS[1], ARGV[1], ARGV[2])
redis.call("HDEL", KEYS[2], ARGV[1], ARGV[2])
return 1`;

function parseQueuedAt(agentId: string, raw: string | null | undefined): number {
  const value = raw === null || raw === undefined || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`queue metadata missing or corrupt for agent ${agentId}`);
  }
  return value;
}

export class MatchmakingQueue {
  constructor(private readonly redis: Redis) {}

  async join(agentId: string, rating: number, queuedAt: number): Promise<boolean> {
    const added = await this.redis.eval(
      JOIN_SCRIPT,
      2,
      QUEUE_KEY,
      QUEUE_META_KEY,
      agentId,
      String(rating),
      String(queuedAt),
    );
    return added === 1;
  }

  async leave(agentId: string): Promise<QueueMembership | null> {
    const result = (await this.redis.eval(LEAVE_SCRIPT, 2, QUEUE_KEY, QUEUE_META_KEY, agentId)) as [number, string];
    if (result[0] !== 1) return null;
    return { queuedAt: parseQueuedAt(agentId, result[1]) };
  }

  async removePair(a: string, b: string): Promise<boolean> {
    const removed = await this.redis.eval(REMOVE_PAIR_SCRIPT, 2, QUEUE_KEY, QUEUE_META_KEY, a, b);
    return removed === 1;
  }

  async status(agentId: string): Promise<QueueMembership | null> {
    const [score, raw] = await Promise.all([
      this.redis.zscore(QUEUE_KEY, agentId),
      this.redis.hget(QUEUE_META_KEY, agentId),
    ]);
    if (score === null) return null;
    return { queuedAt: parseQueuedAt(agentId, raw) };
  }

  async entries(): Promise<QueueEntry[]> {
    const [members, meta] = await Promise.all([
      this.redis.zrange(QUEUE_KEY, 0, -1, "WITHSCORES"),
      this.redis.hgetall(QUEUE_META_KEY),
    ]);
    const out: QueueEntry[] = [];
    for (let i = 0; i + 1 < members.length; i += 2) {
      const agentId = members[i];
      const score = members[i + 1];
      if (agentId === undefined || score === undefined) continue;
      out.push({ agentId, rating: Number(score), queuedAt: parseQueuedAt(agentId, meta[agentId]) });
    }
    return out;
  }

  async size(): Promise<number> {
    return this.redis.zcard(QUEUE_KEY);
  }

  async clear(): Promise<void> {
    await this.redis.del(QUEUE_KEY, QUEUE_META_KEY);
  }
}
