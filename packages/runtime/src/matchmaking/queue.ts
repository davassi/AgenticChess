import type { QueueMode } from "@aichess/core/protocol";
import type { Redis } from "ioredis";

/**
 * One sorted set per mode, and one hash holding every waiting agent.
 *
 * The hash is deliberately shared. It is what makes "an agent is in at most one
 * queue" a single atomic check instead of two, and it is what lets `leave` find
 * the right sorted set without the caller having to remember which queue the
 * agent joined.
 *
 * The key names are new: the previous single-queue layout used `mm:queue` and
 * `mm:meta`, whose values carry no mode. Rather than parse two formats for
 * ever, the old keys are abandoned - a queue holds nothing that has to survive
 * a deploy.
 */
export const QUEUE_KEYS: Record<QueueMode, string> = {
  rated: "mm:queue:rated",
  unrated: "mm:queue:unrated",
};
export const QUEUE_ENTRY_KEY = "mm:entry";

export interface QueueEntry {
  agentId: string;
  rating: number;
  queuedAt: number;
  mode: QueueMode;
}

export interface QueueMembership {
  queuedAt: number;
  mode: QueueMode;
}

const JOIN_SCRIPT = `
if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 1 then return 0 end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
redis.call("HSET", KEYS[2], ARGV[1], ARGV[3])
return 1`;

const LEAVE_SCRIPT = `
local entry = redis.call("HGET", KEYS[3], ARGV[1])
if not entry then return {0, ""} end
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[1])
redis.call("HDEL", KEYS[3], ARGV[1])
return {1, entry}`;

const REMOVE_PAIR_SCRIPT = `
if not redis.call("ZSCORE", KEYS[1], ARGV[1]) then return 0 end
if not redis.call("ZSCORE", KEYS[1], ARGV[2]) then return 0 end
redis.call("ZREM", KEYS[1], ARGV[1], ARGV[2])
redis.call("HDEL", KEYS[2], ARGV[1], ARGV[2])
return 1`;

function encodeEntry(queuedAt: number, mode: QueueMode): string {
  return `${String(queuedAt)}:${mode}`;
}

/** The same read, for the callers that would rather skip a bad row than fail. */
function readEntry(agentId: string, raw: string | null | undefined): QueueMembership | null {
  try {
    return parseEntry(agentId, raw);
  } catch {
    return null;
  }
}

function parseEntry(agentId: string, raw: string | null | undefined): QueueMembership {
  const [at, mode] = (raw ?? "").split(":");
  const queuedAt = at === undefined || at === "" ? Number.NaN : Number(at);
  if (!Number.isFinite(queuedAt) || (mode !== "rated" && mode !== "unrated")) {
    throw new Error(`queue metadata missing or corrupt for agent ${agentId}`);
  }
  return { queuedAt, mode };
}

export class MatchmakingQueue {
  constructor(private readonly redis: Redis) {}

  async join(agentId: string, rating: number, queuedAt: number, mode: QueueMode): Promise<boolean> {
    const added = await this.redis.eval(
      JOIN_SCRIPT,
      2,
      QUEUE_KEYS[mode],
      QUEUE_ENTRY_KEY,
      agentId,
      String(rating),
      encodeEntry(queuedAt, mode),
    );
    return added === 1;
  }

  async leave(agentId: string): Promise<QueueMembership | null> {
    const result = (await this.redis.eval(
      LEAVE_SCRIPT,
      3,
      QUEUE_KEYS.rated,
      QUEUE_KEYS.unrated,
      QUEUE_ENTRY_KEY,
      agentId,
    )) as [number, string];
    if (result[0] !== 1) return null;
    return parseEntry(agentId, result[1]);
  }

  async removePair(a: string, b: string, mode: QueueMode): Promise<boolean> {
    const removed = await this.redis.eval(REMOVE_PAIR_SCRIPT, 2, QUEUE_KEYS[mode], QUEUE_ENTRY_KEY, a, b);
    return removed === 1;
  }

  async status(agentId: string): Promise<QueueMembership | null> {
    const raw = await this.redis.hget(QUEUE_ENTRY_KEY, agentId);
    if (raw === null) return null;
    return parseEntry(agentId, raw);
  }

  /**
   * Everyone waiting in one mode.
   *
   * A member whose entry cannot be read is skipped rather than raised. Reading
   * one agent's membership can fail loudly, because the answer belongs to that
   * agent - but this list feeds the pairing sweep and the public lobby, and a
   * single unreadable row must not deny both to everyone else.
   */
  async entries(mode: QueueMode): Promise<QueueEntry[]> {
    const [members, stored] = await Promise.all([
      this.redis.zrange(QUEUE_KEYS[mode], 0, -1, "WITHSCORES"),
      this.redis.hgetall(QUEUE_ENTRY_KEY),
    ]);
    const out: QueueEntry[] = [];
    for (let i = 0; i + 1 < members.length; i += 2) {
      const agentId = members[i];
      const score = members[i + 1];
      if (agentId === undefined || score === undefined) continue;
      const entry = readEntry(agentId, stored[agentId]);
      if (entry === null || entry.mode !== mode) continue;
      out.push({ agentId, rating: Number(score), queuedAt: entry.queuedAt, mode: entry.mode });
    }
    return out;
  }

  async size(mode: QueueMode): Promise<number> {
    return this.redis.zcard(QUEUE_KEYS[mode]);
  }

  async clear(): Promise<void> {
    await this.redis.del(QUEUE_KEYS.rated, QUEUE_KEYS.unrated, QUEUE_ENTRY_KEY);
  }
}
