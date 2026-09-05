import { hashApiKey, splitApiKey } from "@aichess/core";
import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { agents } from "./schema/agents.js";
import { users } from "./schema/users.js";

/**
 * The arena's own sparring agent.
 *
 * Unlike `createAgent`, which mints a key and prints it once, this takes the
 * key it is given: the bot's process has to authenticate with it, so the key
 * lives in the environment and the database is made to agree. That is what
 * makes the function safe to run on every deploy, which is how it is used - a
 * one-shot container beside the migration.
 */

export interface EnsureSparringInput {
  apiKey: string;
  slug: string;
  name: string;
  description: string;
  ownerEmail: string;
  modelProvider: string;
  modelName: string;
}

export interface EnsuredSparringAgent {
  id: string;
  ownerId: string;
  /** False when the agent was already there and this run only reconciled it. */
  created: boolean;
}

export async function ensureSparringAgent(db: Database, input: EnsureSparringInput): Promise<EnsuredSparringAgent> {
  const parts = splitApiKey(input.apiKey);
  if (parts === null) {
    throw new Error("the sparring api key is not an arena api key: expected the ac_ form that generateApiKey issues");
  }
  const apiKeyPrefix = parts.prefix;
  const apiKeyHash = hashApiKey(input.apiKey);
  const ownerEmail = input.ownerEmail.trim().toLowerCase();

  return db.transaction(async (tx): Promise<EnsuredSparringAgent> => {
    const [owner] = await tx
      .insert(users)
      .values({ email: ownerEmail, name: input.name })
      .onConflictDoUpdate({ target: users.email, set: { updatedAt: new Date() } })
      .returning({ id: users.id });
    if (owner === undefined) throw new Error("the house owner was not inserted");

    const [existing] = await tx.select({ id: agents.id }).from(agents).where(eq(agents.slug, input.slug));
    if (existing !== undefined) {
      await tx
        .update(agents)
        .set({
          ownerId: owner.id,
          name: input.name,
          description: input.description,
          modelProvider: input.modelProvider,
          modelName: input.modelName,
          apiKeyPrefix,
          apiKeyHash,
          isHouse: true,
          // A suspended house agent would leave the practice queue empty with
          // no sign of why, so a deploy puts it back in service.
          status: "active",
          suspendedReason: null,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, existing.id));
      return { id: existing.id, ownerId: owner.id, created: false };
    }

    const [created] = await tx
      .insert(agents)
      .values({
        ownerId: owner.id,
        name: input.name,
        slug: input.slug,
        description: input.description,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        apiKeyPrefix,
        apiKeyHash,
        isHouse: true,
      })
      .returning({ id: agents.id });
    if (created === undefined) throw new Error("the sparring agent was not inserted");
    return { id: created.id, ownerId: owner.id, created: true };
  });
}
