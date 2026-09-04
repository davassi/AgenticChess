import { START_FEN } from "@aichess/core";
import { GameListPageSchema, GameTimelineSchema } from "@aichess/core/protocol";
import { games } from "@aichess/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("GET /v1/games", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  async function insertFinished(createdAt: number): Promise<void> {
    await h.db.insert(games).values({
      whiteAgentId: h.agents.white.id,
      blackAgentId: h.agents.black.id,
      status: "finished",
      result: "1-0",
      termination: "checkmate",
      timePerMoveMs: 60_000,
      moveLimitPlies: 300,
      illegalAttemptsPerTurn: 3,
      currentFen: START_FEN,
      ply: 20,
      createdAt: new Date(createdAt),
      startedAt: new Date(createdAt),
      finishedAt: new Date(createdAt + 1_000),
    });
  }

  async function fetchPage(url: string): Promise<ReturnType<typeof GameListPageSchema.parse>> {
    const res = await h.app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    return GameListPageSchema.parse(res.json());
  }

  it("lists games newest first and pages with the cursor", async () => {
    const base = Date.UTC(2026, 8, 4, 10, 0, 0);
    await insertFinished(base - 2_000);
    await insertFinished(base - 1_000);
    await insertFinished(base);
    const first = await fetchPage("/v1/games?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await fetchPage(`/v1/games?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((g) => g.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("filters by agent slug and rejects an unknown one", async () => {
    await insertFinished(Date.now());
    const page = await fetchPage(`/v1/games?agent=${h.agents.white.slug}&outcome=win`);
    expect(page.items).toHaveLength(1);
    const missing = await h.app.inject({ method: "GET", url: "/v1/games?agent=nobody" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: "not_found" });
  });

  it("rejects an outcome without an agent and a malformed cursor", async () => {
    const noAgent = await h.app.inject({ method: "GET", url: "/v1/games?outcome=win" });
    expect(noAgent.statusCode).toBe(400);
    expect(noAgent.json()).toMatchObject({ error: "validation_error" });
    const badCursor = await h.app.inject({ method: "GET", url: "/v1/games?cursor=not-base64url" });
    expect(badCursor.statusCode).toBe(400);
  });

  it("serves the timeline and the PGN of a real game", async () => {
    const gameId = await h.createGame();
    const played = await h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/move`,
      headers: { authorization: `Bearer ${h.agents.white.key}` },
      payload: { ply: 0, move: "e4", comment: "Centre." },
    });
    expect(played.statusCode).toBe(200);

    const timeline = await h.app.inject({ method: "GET", url: `/v1/games/${gameId}/moves` });
    expect(timeline.statusCode).toBe(200);
    expect(GameTimelineSchema.parse(timeline.json()).moves).toMatchObject([
      { ply: 1, color: "white", san: "e4", comment: "Centre." },
    ]);

    const pgn = await h.app.inject({ method: "GET", url: `/v1/games/${gameId}/pgn` });
    expect(pgn.statusCode).toBe(200);
    expect(pgn.headers["content-type"]).toContain("application/x-chess-pgn");
    expect(pgn.headers["content-disposition"]).toContain(`game-${gameId}.pgn`);
    expect(pgn.body).toContain("1. e4");

    const missing = await h.app.inject({ method: "GET", url: "/v1/games/00000000-0000-4000-8000-000000000000/moves" });
    expect(missing.statusCode).toBe(404);
  });
});
