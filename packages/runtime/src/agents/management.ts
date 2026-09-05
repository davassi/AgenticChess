import { generateApiKey } from "@aichess/core";
import type { AgentCreateInput, AgentStatus, AgentSummary, RatingSummary } from "@aichess/core/protocol";
import { UNIQUE_VIOLATION, agents, pgErrorCode, ratings, users, type Database } from "@aichess/db";
import { and, asc, count, eq } from "drizzle-orm";
import { defaultRatingRecord, toRatingSummary } from "../rating/repository.js";

/** One account may own this many agents. The cap keeps a single sign-up from filling the queue. */
export const MAX_AGENTS_PER_OWNER = 10;

export interface OwnedAgent {
  agent: AgentSummary;
  description: string;
  status: AgentStatus;
  apiKeyPrefix: string;
  createdAt: string;
  rating: RatingSummary;
}

export type CreateAgentResult =
  { ok: true; agent: OwnedAgent; key: string } | { ok: false; code: "slug_taken" | "agent_limit_reached" };

export type RotateKeyResult = { ok: true; key: string } | { ok: false; code: "not_found" };

type AgentRow = typeof agents.$inferSelect;

function toOwnedAgent(row: AgentRow, rating: RatingSummary): OwnedAgent {
  return {
    agent: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      modelProvider: row.modelProvider,
      modelName: row.modelName,
      isHouse: row.isHouse,
    },
    description: row.description,
    status: row.status,
    apiKeyPrefix: row.apiKeyPrefix,
    createdAt: row.createdAt.toISOString(),
    rating,
  };
}

export async function createAgentForOwner(
  db: Database,
  ownerId: string,
  input: AgentCreateInput,
): Promise<CreateAgentResult> {
  const generated = generateApiKey();
  // A taken slug aborts the transaction, so it is caught out here, where the
  // rollback has already happened.
  try {
    return await db.transaction(async (tx): Promise<CreateAgentResult> => {
      // Counting and inserting are two statements, so two creations for the
      // same account would both find room and take the last place twice.
      // Locking the owner's row makes them queue, and the count that follows
      // is a new statement: it sees whatever the one in front committed.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).for("update");
      const [owned] = await tx.select({ total: count() }).from(agents).where(eq(agents.ownerId, ownerId));
      if (Number(owned?.total ?? 0) >= MAX_AGENTS_PER_OWNER) return { ok: false, code: "agent_limit_reached" };

      const [row] = await tx
        .insert(agents)
        .values({
          ownerId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          modelProvider: input.modelProvider,
          modelName: input.modelName,
          apiKeyPrefix: generated.prefix,
          apiKeyHash: generated.hash,
        })
        .returning();
      if (row === undefined) throw new Error("agent not inserted");
      return {
        ok: true,
        agent: toOwnedAgent(row, toRatingSummary(defaultRatingRecord(row.id))),
        key: generated.key,
      };
    });
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) return { ok: false, code: "slug_taken" };
    throw error;
  }
}

/**
 * The ownership check is part of the update's `where`, not a separate read: an
 * agent belonging to somebody else updates zero rows and reports not_found,
 * with no window between checking and writing.
 */
export async function rotateAgentKey(db: Database, ownerId: string, agentId: string): Promise<RotateKeyResult> {
  const generated = generateApiKey();
  const rows = await db
    .update(agents)
    .set({ apiKeyPrefix: generated.prefix, apiKeyHash: generated.hash, updatedAt: new Date() })
    .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
    .returning({ id: agents.id });
  if (rows.length === 0) return { ok: false, code: "not_found" };
  return { ok: true, key: generated.key };
}

export async function listAgentsForOwner(db: Database, ownerId: string): Promise<OwnedAgent[]> {
  const rows = await db
    .select({ agent: agents, rating: ratings })
    .from(agents)
    .leftJoin(ratings, eq(ratings.agentId, agents.id))
    .where(eq(agents.ownerId, ownerId))
    .orderBy(asc(agents.createdAt));
  return rows.map(({ agent, rating }) => {
    const fallback = defaultRatingRecord(agent.id);
    return toOwnedAgent(
      agent,
      toRatingSummary(
        rating === null
          ? fallback
          : {
              agentId: agent.id,
              rating: rating.rating,
              rd: rating.rd,
              volatility: rating.volatility,
              gamesPlayed: rating.gamesPlayed,
              lastGameAt: rating.lastGameAt === null ? null : rating.lastGameAt.getTime(),
            },
      ),
    );
  });
}
