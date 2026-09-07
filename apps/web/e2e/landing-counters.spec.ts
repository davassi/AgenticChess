import { generateApiKey } from "@aichess/core";
import { agents, createDb, games, ratings, users } from "@aichess/db";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { E2E_INTERNAL_TOKEN } from "../playwright.config";

const API = `http://127.0.0.1:${process.env["E2E_API_PORT"] ?? 3101}`;
const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://aichess:aichess@localhost:5432/aichess";

interface ArenaFigures {
  gamesPlayed: number;
  movesPlayed: number;
  activeAgents: number;
  gamesLast24h: number;
}

const grouped = (value: number): string => new Intl.NumberFormat("en-US").format(value);

/*
 * The unit tests know that the component renders what it is handed and that the
 * reader survives an arena that will not answer. What only a running site can
 * show is that the landing asks at all: that the page mounts the strip, that
 * the figures on it came from the arena rather than from nowhere, and that the
 * page still arrives when they cannot be read.
 */
test("the landing counts the arena, and the figures are the arena's own", async ({ page }) => {
  const handle = createDb(DATABASE_URL);
  const suffix = Date.now().toString(36);
  let ownerId: string | null = null;
  let agentIds: string[] = [];
  let gameId: string | null = null;
  try {
    const [owner] = await handle.db
      .insert(users)
      .values({ email: `e2e-counters-${suffix}@example.com`, name: "E2E" })
      .returning({ id: users.id });
    if (owner === undefined) throw new Error("owner not inserted");
    ownerId = owner.id;

    const keys = [generateApiKey(), generateApiKey()];
    const rows = await handle.db
      .insert(agents)
      .values(
        keys.map((key, index) => ({
          ownerId: owner.id,
          name: `e2e-counters-${suffix}-${index}`,
          slug: `e2e-counters-${suffix}-${index}`,
          modelProvider: "test",
          modelName: "test",
          apiKeyPrefix: key.prefix,
          apiKeyHash: key.hash,
        })),
      )
      .returning({ id: agents.id });
    const [white, black] = rows;
    if (white === undefined || black === undefined) throw new Error("agents not inserted");
    agentIds = rows.map((row) => row.id);

    const created = await fetch(`${API}/v1/internal/games`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": E2E_INTERNAL_TOKEN },
      body: JSON.stringify({ whiteAgentId: white.id, blackAgentId: black.id }),
    });
    expect(created.status).toBe(201);
    gameId = ((await created.json()) as { id: string }).id;

    // One real move, so the arena is demonstrably not empty and at least one
    // figure on the strip has to move because of this test.
    const played = await fetch(`${API}/v1/games/${gameId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${keys[0]?.key ?? ""}` },
      body: JSON.stringify({ ply: 0, move: "e4" }),
    });
    expect(played.status).toBe(200);

    const answered = await fetch(`${API}/v1/stats`);
    expect(answered.status).toBe(200);
    const figures = (await answered.json()) as ArenaFigures;
    expect(figures.movesPlayed).toBeGreaterThan(0);
    expect(figures.activeAgents).toBeGreaterThan(0);

    await page.goto("/");

    const strip = page.locator("dl.counters");
    await expect(strip).toBeVisible();
    await expect(strip.locator("dd")).toHaveText([
      grouped(figures.gamesPlayed),
      grouped(figures.movesPlayed),
      grouped(figures.activeAgents),
      grouped(figures.gamesLast24h),
    ]);
    await expect(strip.locator("dt")).toHaveText([
      "games played",
      "moves played",
      "agents in the arena",
      "games in the last 24h",
    ]);
  } finally {
    try {
      if (gameId !== null) await handle.db.delete(games).where(eq(games.id, gameId));
      if (agentIds.length > 0) {
        await handle.db.delete(ratings).where(inArray(ratings.agentId, agentIds));
        await handle.db.delete(agents).where(inArray(agents.id, agentIds));
      }
      if (ownerId !== null) await handle.db.delete(users).where(eq(users.id, ownerId));
    } finally {
      await handle.close();
    }
  }
});
