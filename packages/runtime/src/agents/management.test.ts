import { readFile } from "node:fs/promises";
import { hashApiKey, splitApiKey } from "@aichess/core";
import { agents, users, type Database } from "@aichess/db";
import { startTestDatabase, truncateAll, type TestDatabase } from "@aichess/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_AGENTS_PER_OWNER, createAgentForOwner, listAgentsForOwner, rotateAgentKey } from "./management.js";

const INPUT = {
  name: "Rook and Roll",
  slug: "rook-and-roll",
  description: "Loves rook lifts.",
  modelProvider: "Google",
  modelName: "gemma-3-27b",
};

describe("agent management", () => {
  let tdb: TestDatabase;
  let db: Database;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    tdb = await startTestDatabase();
    db = tdb.db;
  });

  afterAll(async () => {
    await tdb.stop();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const rows = await db
      .insert(users)
      .values([
        { email: "owner@example.com", name: "Owner" },
        { email: "other@example.com", name: "Other" },
      ])
      .returning({ id: users.id });
    const [owner, other] = rows;
    if (owner === undefined || other === undefined) throw new Error("owners not inserted");
    ownerId = owner.id;
    otherId = other.id;
  });

  it("creates an agent, returns the key once and stores only its hash", async () => {
    const created = await createAgentForOwner(db, ownerId, INPUT);
    if (!created.ok) throw new Error(`unexpected failure: ${created.code}`);
    expect(created.key.startsWith("ac_")).toBe(true);
    expect(created.agent.rating).toMatchObject({ rating: 1500, provisional: true });
    expect(created.agent.apiKeyPrefix).toBe(splitApiKey(created.key)?.prefix);

    const [row] = await db.select().from(agents).where(eq(agents.id, created.agent.agent.id));
    expect(row?.apiKeyHash).toBe(hashApiKey(created.key));
    expect(row?.ownerId).toBe(ownerId);
    expect(JSON.stringify(row)).not.toContain(created.key);
  });

  it("refuses a slug that is already taken, whoever owns it", async () => {
    expect((await createAgentForOwner(db, ownerId, INPUT)).ok).toBe(true);
    expect(await createAgentForOwner(db, otherId, INPUT)).toEqual({ ok: false, code: "slug_taken" });
  });

  it("caps how many agents one account can own", async () => {
    for (let i = 0; i < MAX_AGENTS_PER_OWNER; i += 1) {
      const result = await createAgentForOwner(db, ownerId, { ...INPUT, slug: `bot-${i}`, name: `Bot ${i}` });
      expect(result.ok).toBe(true);
    }
    expect(await createAgentForOwner(db, ownerId, { ...INPUT, slug: "one-too-many" })).toEqual({
      ok: false,
      code: "agent_limit_reached",
    });
  });

  it("rotates a key and invalidates the previous one", async () => {
    const created = await createAgentForOwner(db, ownerId, INPUT);
    if (!created.ok) throw new Error("creation failed");
    const rotated = await rotateAgentKey(db, ownerId, created.agent.agent.id);
    if (!rotated.ok) throw new Error("rotation failed");
    expect(rotated.key).not.toBe(created.key);

    const [row] = await db.select().from(agents).where(eq(agents.id, created.agent.agent.id));
    expect(row?.apiKeyHash).toBe(hashApiKey(rotated.key));
    expect(row?.apiKeyHash).not.toBe(hashApiKey(created.key));
  });

  it("never touches an agent owned by somebody else", async () => {
    const created = await createAgentForOwner(db, ownerId, INPUT);
    if (!created.ok) throw new Error("creation failed");
    expect(await rotateAgentKey(db, otherId, created.agent.agent.id)).toEqual({ ok: false, code: "not_found" });
    expect(await listAgentsForOwner(db, otherId)).toEqual([]);
    expect((await listAgentsForOwner(db, ownerId)).map((a) => a.agent.slug)).toEqual(["rook-and-roll"]);
  });

  it("keeps the agents subpath free of Redis and queue dependencies", async () => {
    const sources = await Promise.all(
      ["management.ts", "profile.ts", "repository.ts", "index.ts"].map((file) =>
        readFile(new URL(file, import.meta.url), "utf8"),
      ),
    );
    for (const source of sources) {
      expect(source).not.toContain("ioredis");
      expect(source).not.toContain("bullmq");
    }
  });
});
