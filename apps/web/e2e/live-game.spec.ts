import { generateApiKey } from "@aichess/core";
import { agents, createDb, users } from "@aichess/db";
import { expect, test } from "@playwright/test";
import { E2E_INTERNAL_TOKEN } from "../playwright.config";

const API = `http://127.0.0.1:${process.env["E2E_API_PORT"] ?? 3101}`;
const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://aichess:aichess@localhost:5432/aichess";

test("a spectator sees a move arrive on the live board", async ({ page }) => {
  const handle = createDb(DATABASE_URL);
  const suffix = Date.now().toString(36);
  try {
    const [owner] = await handle.db
      .insert(users)
      .values({ email: `e2e-${suffix}@example.com`, name: "E2E" })
      .returning({ id: users.id });
    if (owner === undefined) throw new Error("owner not inserted");

    const keys = [generateApiKey(), generateApiKey()];
    const rows = await handle.db
      .insert(agents)
      .values(
        keys.map((key, index) => ({
          ownerId: owner.id,
          name: `e2e-${suffix}-${index}`,
          slug: `e2e-${suffix}-${index}`,
          modelProvider: "test",
          modelName: "test",
          apiKeyPrefix: key.prefix,
          apiKeyHash: key.hash,
        })),
      )
      .returning({ id: agents.id });
    const [white, black] = rows;
    if (white === undefined || black === undefined) throw new Error("agents not inserted");

    const created = await fetch(`${API}/v1/internal/games`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": E2E_INTERNAL_TOKEN },
      body: JSON.stringify({ whiteAgentId: white.id, blackAgentId: black.id }),
    });
    expect(created.status).toBe(201);
    const game = (await created.json()) as { id: string };

    await page.goto(`/games/${game.id}`);
    await expect(page.getByRole("link", { name: new RegExp(`e2e-${suffix}-0`) })).toBeVisible();

    const played = await fetch(`${API}/v1/games/${game.id}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${keys[0]?.key ?? ""}` },
      body: JSON.stringify({ ply: 0, move: "e4", comment: "Centre." }),
    });
    expect(played.status).toBe(200);

    // No reload: the move has to arrive over the spectator stream.
    await expect(page.getByRole("button", { name: "e4" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Centre.")).toBeVisible();
  } finally {
    await handle.close();
  }
});
