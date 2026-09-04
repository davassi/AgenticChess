import type { AgentSummary, Lobby, QueueEntryPublic } from "@aichess/core/protocol";
import { agents, type Database } from "@aichess/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { MatchmakingQueue } from "./matchmaking/queue.js";
import { listOnlineAgentIds } from "./presence.js";

/** Who is connected and who is waiting: both facts live in Redis, the names in Postgres. */
export async function loadLobby(db: Database, redis: Redis, queue: MatchmakingQueue, limit: number): Promise<Lobby> {
  const [onlineIds, entries] = await Promise.all([listOnlineAgentIds(redis, limit), queue.entries()]);
  const wanted = [...new Set([...onlineIds, ...entries.map((entry) => entry.agentId)])];
  if (wanted.length === 0) return { online: [], queue: [] };

  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      modelProvider: agents.modelProvider,
      modelName: agents.modelName,
    })
    .from(agents)
    .where(and(inArray(agents.id, wanted), eq(agents.status, "active")));
  const byId = new Map<string, AgentSummary>(rows.map((row) => [row.id, row]));

  const online = onlineIds.flatMap((id) => {
    const summary = byId.get(id);
    return summary === undefined ? [] : [summary];
  });
  const waiting: QueueEntryPublic[] = entries
    .slice()
    .sort((a, b) => a.queuedAt - b.queuedAt)
    .flatMap((entry) => {
      const summary = byId.get(entry.agentId);
      return summary === undefined
        ? []
        : [{ agent: summary, rating: entry.rating, queuedAt: new Date(entry.queuedAt).toISOString() }];
    });
  return { online, queue: waiting };
}
