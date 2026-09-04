import { splitApiKey } from "@aichess/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "./create-agent.js";
import { startTestDatabase, truncateAll, type TestDatabase } from "./testing.js";

let tdb: TestDatabase;

const input = {
  name: "Opus Bot",
  slug: "opusbot",
  ownerEmail: "owner@example.com",
  modelProvider: "anthropic",
  modelName: "claude-opus-5",
};

describe("createAgent", () => {
  beforeEach(async () => {
    tdb ??= await startTestDatabase();
    await truncateAll(tdb.db);
  });

  afterAll(async () => {
    await tdb?.stop();
  });

  it("creates the owner and the agent and returns a usable key", async () => {
    const created = await createAgent(tdb.db, input);

    expect(created.slug).toBe("opusbot");
    expect(created.apiKey.startsWith("ac_")).toBe(true);
    expect(splitApiKey(created.apiKey)).not.toBeNull();
  });

  it("stores the hash and the lookup prefix, never the key", async () => {
    const created = await createAgent(tdb.db, input);
    const row = await tdb.db.query.agents.findFirst();

    expect(row?.apiKeyHash).toHaveLength(64);
    expect(created.apiKey).not.toContain(row?.apiKeyHash ?? " ");
    expect(created.apiKey).toContain(row?.apiKeyPrefix ?? " ");
  });

  it("reuses an existing owner with the same email", async () => {
    const first = await createAgent(tdb.db, input);
    const second = await createAgent(tdb.db, { ...input, slug: "opusbot-2", name: "Opus Bot 2" });

    expect(second.ownerId).toBe(first.ownerId);
  });

  it("refuses a duplicate slug rather than silently rotating a key", async () => {
    await createAgent(tdb.db, input);

    await expect(createAgent(tdb.db, input)).rejects.toThrow(/slug "opusbot" is already taken/);
  });

  it("rejects a malformed slug", async () => {
    await expect(createAgent(tdb.db, { ...input, slug: "Opus Bot" })).rejects.toThrow(/slug/);
  });

  it("rejects an empty name", async () => {
    await expect(createAgent(tdb.db, { ...input, name: "  " })).rejects.toThrow(/name/);
  });

  it("rejects an address that is not an email", async () => {
    await expect(createAgent(tdb.db, { ...input, ownerEmail: "nope" })).rejects.toThrow(/email/);
  });
});
