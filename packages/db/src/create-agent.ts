import { generateApiKey } from "@aichess/core";
import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { agents } from "./schema/agents.js";
import { users } from "./schema/users.js";

/**
 * Registers an agent and mints its API key. Until the web sign-up flow exists
 * this is the only way an agent reaches the arena, so it lives in the package
 * rather than in a script: the API contract it has to satisfy is the one in
 * `plugins/auth.ts`, which looks an agent up by key prefix and compares hashes.
 */

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNIQUE_VIOLATION = "23505";

export interface CreateAgentInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName?: string;
  modelProvider: string;
  modelName: string;
  description?: string;
}

export interface CreatedAgent {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  /** Shown once. Only its hash is stored, so it cannot be recovered later. */
  apiKey: string;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${field} is required`);
  return trimmed;
}

// Drizzle wraps driver errors, so the SQLSTATE code sits on a cause rather
// than on the error that reaches the caller.
function isUniqueViolation(error: unknown, depth = 4): boolean {
  if (typeof error !== "object" || error === null || depth === 0) return false;
  if ("code" in error && error.code === UNIQUE_VIOLATION) return true;
  return "cause" in error && isUniqueViolation(error.cause, depth - 1);
}

export async function createAgent(db: Database, input: CreateAgentInput): Promise<CreatedAgent> {
  const name = required(input.name, "name");
  const slug = required(input.slug, "slug").toLowerCase();
  const ownerEmail = required(input.ownerEmail, "owner email").toLowerCase();
  const modelProvider = required(input.modelProvider, "model provider");
  const modelName = required(input.modelName, "model name");

  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`slug "${slug}" must be lowercase letters, digits and dashes, 1 to 32 characters`);
  }
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    throw new Error(`owner email "${ownerEmail}" is not an email address`);
  }

  const generated = generateApiKey();

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).limit(1);
    const found = existing[0];

    let ownerId: string;
    if (found === undefined) {
      const inserted = await tx
        .insert(users)
        .values({ email: ownerEmail, name: input.ownerName?.trim() ?? ownerEmail.split("@")[0] ?? ownerEmail })
        .returning({ id: users.id });
      const owner = inserted[0];
      if (owner === undefined) throw new Error("owner was not inserted");
      ownerId = owner.id;
    } else {
      ownerId = found.id;
    }

    let rows;
    try {
      rows = await tx
        .insert(agents)
        .values({
          ownerId,
          name,
          slug,
          description: input.description?.trim() ?? "",
          modelProvider,
          modelName,
          apiKeyPrefix: generated.prefix,
          apiKeyHash: generated.hash,
        })
        .returning({ id: agents.id, slug: agents.slug, name: agents.name });
    } catch (error) {
      // A taken slug is the one failure a caller is likely to hit, and the
      // driver's message does not say which value collided.
      if (isUniqueViolation(error)) {
        throw new Error(`slug "${slug}" is already taken`, { cause: error });
      }
      throw error;
    }

    const agent = rows[0];
    if (agent === undefined) throw new Error("agent was not inserted");

    return { id: agent.id, slug: agent.slug, name: agent.name, ownerId, apiKey: generated.key };
  });
}
