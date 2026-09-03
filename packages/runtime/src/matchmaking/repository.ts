import type { AgentStatus, Color } from "@aichess/core/protocol";
import { agents, games } from "@aichess/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Executor } from "../games/repository.js";

export interface QueueAgent {
  id: string;
  ownerId: string;
  status: AgentStatus;
}

export async function loadQueueAgents(ex: Executor, agentIds: string[]): Promise<Map<string, QueueAgent>> {
  if (agentIds.length === 0) return new Map();
  const rows = await ex
    .select({ id: agents.id, ownerId: agents.ownerId, status: agents.status })
    .from(agents)
    .where(inArray(agents.id, agentIds));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function listAgentsInActiveGames(ex: Executor, agentIds: string[]): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const rows = await ex
    .select({ white: games.whiteAgentId, black: games.blackAgentId })
    .from(games)
    .where(
      and(eq(games.status, "active"), or(inArray(games.whiteAgentId, agentIds), inArray(games.blackAgentId, agentIds))),
    );
  const wanted = new Set(agentIds);
  const busy = new Set<string>();
  for (const row of rows) {
    if (wanted.has(row.white)) busy.add(row.white);
    if (wanted.has(row.black)) busy.add(row.black);
  }
  return busy;
}

export async function loadLastColors(ex: Executor, agentIds: string[]): Promise<Map<string, Color>> {
  if (agentIds.length === 0) return new Map();
  const ids = sql.join(
    agentIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await ex.execute(sql`
    select distinct on (agent_id) agent_id, color
    from (
      select white_agent_id as agent_id, 'white' as color, created_at from games where white_agent_id in (${ids})
      union all
      select black_agent_id as agent_id, 'black' as color, created_at from games where black_agent_id in (${ids})
    ) as played
    order by agent_id, created_at desc`);
  const out = new Map<string, Color>();
  for (const row of rows) {
    const agentId = row["agent_id"];
    const color = row["color"];
    if (typeof agentId === "string" && (color === "white" || color === "black")) out.set(agentId, color);
  }
  return out;
}
