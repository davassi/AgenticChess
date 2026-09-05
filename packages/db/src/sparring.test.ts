import { generateApiKey, hashApiKey } from "@aichess/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, users } from "./schema/index.js";
import { ensureSparringAgent, type EnsureSparringInput } from "./sparring.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

describe("ensureSparringAgent", () => {
  let tdb: TestDatabase;

  const input = (apiKey: string): EnsureSparringInput => ({
    apiKey,
    slug: "sparring",
    name: "Sparring Partner",
    description: "The arena's house agent. Its games are never rated.",
    ownerEmail: "house@agenticchess.online",
    modelProvider: "ollama",
    modelName: "gemma3:270m",
  });

  beforeAll(async () => {
    tdb = await startTestDatabase();
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(tdb.db);
  });

  it("creates the house agent once and is safe to run again", async () => {
    const key = generateApiKey().key;
    const first = await ensureSparringAgent(tdb.db, input(key));
    expect(first.created).toBe(true);

    const second = await ensureSparringAgent(tdb.db, input(key));
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.ownerId).toBe(first.ownerId);

    const rows = await tdb.db.select().from(agents).where(eq(agents.slug, "sparring"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isHouse).toBe(true);
    expect(rows[0]?.status).toBe("active");
    expect(rows[0]?.apiKeyHash).toBe(hashApiKey(key));
    expect(await tdb.db.select().from(users)).toHaveLength(1);
  });

  it("adopts a rotated key", async () => {
    await ensureSparringAgent(tdb.db, input(generateApiKey().key));
    const rotated = generateApiKey().key;
    await ensureSparringAgent(tdb.db, input(rotated));

    const [row] = await tdb.db.select().from(agents).where(eq(agents.slug, "sparring"));
    expect(row?.apiKeyHash).toBe(hashApiKey(rotated));
  });

  it("puts a suspended house agent back in service", async () => {
    const key = generateApiKey().key;
    const created = await ensureSparringAgent(tdb.db, input(key));
    await tdb.db
      .update(agents)
      .set({ status: "suspended", suspendedReason: "by hand" })
      .where(eq(agents.id, created.id));

    await ensureSparringAgent(tdb.db, input(key));

    const [row] = await tdb.db.select().from(agents).where(eq(agents.id, created.id));
    expect(row?.status).toBe("active");
    expect(row?.suspendedReason).toBeNull();
  });

  it("refuses a key that is not an arena key", async () => {
    await expect(ensureSparringAgent(tdb.db, input("not-a-key"))).rejects.toThrow(/api key/i);
  });
});
