import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_INTERNAL_TOKEN, startHarness, type Harness } from "../test-utils/harness.js";

describe("game routes", () => {
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

  const auth = (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` });

  async function createGame(timePerMoveMs?: number): Promise<string> {
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/internal/games",
      headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
      payload: { whiteAgentId: h.agents.white.id, blackAgentId: h.agents.black.id, timePerMoveMs },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  describe("POST /v1/internal/games", () => {
    it("creates and starts a game", async () => {
      const res = await h.app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: { whiteAgentId: h.agents.white.id, blackAgentId: h.agents.black.id, timePerMoveMs: 5000 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: "active", ply: 0, turn: "white", config: { timePerMoveMs: 5000 } });
    });

    it("rejects a missing or wrong token", async () => {
      const body = { whiteAgentId: h.agents.white.id, blackAgentId: h.agents.black.id };
      expect((await h.app.inject({ method: "POST", url: "/v1/internal/games", payload: body })).statusCode).toBe(401);
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: "/v1/internal/games",
            headers: { "x-internal-token": "wrong" },
            payload: body,
          })
        ).statusCode,
      ).toBe(401);
    });

    it("validates the body and the agents", async () => {
      const bad = await h.app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: { whiteAgentId: "nope" },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ error: "validation_error", details: { where: "body" } });
      const missing = await h.app.inject({
        method: "POST",
        url: "/v1/internal/games",
        headers: { "x-internal-token": TEST_INTERNAL_TOKEN },
        payload: { whiteAgentId: h.agents.white.id, blackAgentId: randomUUID() },
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe("GET /v1/games/:id", () => {
    it("returns legal moves only to the agent on move", async () => {
      const id = await createGame();
      const white = await h.app.inject({ method: "GET", url: `/v1/games/${id}`, headers: auth(h.agents.white.key) });
      expect(white.statusCode).toBe(200);
      expect(white.json().legalMoves).toHaveLength(20);
      expect(white.json().attemptsLeft).toBe(3);
      const black = await h.app.inject({ method: "GET", url: `/v1/games/${id}`, headers: auth(h.agents.black.key) });
      expect(black.json().legalMoves).toBeUndefined();
      const anon = await h.app.inject({ method: "GET", url: `/v1/games/${id}` });
      expect(anon.statusCode).toBe(200);
      expect(anon.json().legalMoves).toBeUndefined();
    });

    it("validates the id and reports unknown games", async () => {
      expect((await h.app.inject({ method: "GET", url: "/v1/games/not-a-uuid" })).statusCode).toBe(400);
      expect((await h.app.inject({ method: "GET", url: `/v1/games/${randomUUID()}` })).statusCode).toBe(404);
    });
  });

  describe("POST /v1/games/:id/move", () => {
    it("plays a legal move", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { ply: 0, move: "e4", comment: "Centre." },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ply: 1, turn: "black", history: ["e4"] });
    });

    it("rejects an illegal move with 422 and the legal moves", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { ply: 0, move: "Nf6" },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        error: "illegal_move",
        details: { reason: "not_legal", attemptsLeft: 2 },
      });
      expect(res.json().details.legalMoves).toHaveLength(20);
    });

    it("maps turn, ply and membership failures", async () => {
      const id = await createGame();
      const wrongTurn = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.black.key),
        payload: { ply: 0, move: "e5" },
      });
      expect(wrongTurn.statusCode).toBe(409);
      expect(wrongTurn.json().error).toBe("not_your_turn");
      const stale = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { ply: 3, move: "e4" },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toBe("stale_ply");
      const stranger = await h.seedAgent();
      const outsider = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(stranger.key),
        payload: { ply: 0, move: "e4" },
      });
      expect(outsider.statusCode).toBe(404);
    });

    it("validates the body", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/move`,
        headers: auth(h.agents.white.key),
        payload: { move: "e4" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "validation_error", details: { where: "body" } });
    });

    it("requires authentication", async () => {
      const id = await createGame();
      expect(
        (await h.app.inject({ method: "POST", url: `/v1/games/${id}/move`, payload: { ply: 0, move: "e4" } }))
          .statusCode,
      ).toBe(401);
    });
  });

  describe("POST /v1/games/:id/resign", () => {
    it("ends the game and refuses a second resignation", async () => {
      const id = await createGame();
      const res = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/resign`,
        headers: auth(h.agents.black.key),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "finished", result: "1-0", termination: "resignation" });
      const again = await h.app.inject({
        method: "POST",
        url: `/v1/games/${id}/resign`,
        headers: auth(h.agents.white.key),
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe("game_not_active");
    });
  });

  describe("the rated filter", () => {
    it("separates the games that counted from the ones that did not", async () => {
      const id = await createGame();
      const rated = await h.app.inject({ method: "GET", url: "/v1/games?rated=true" });
      expect(rated.statusCode).toBe(200);
      expect(rated.json().items.map((item: { id: string }) => item.id)).toContain(id);
      for (const item of rated.json().items as Array<{ rated: boolean }>) expect(item.rated).toBe(true);

      const practice = await h.app.inject({ method: "GET", url: "/v1/games?rated=false" });
      expect(practice.statusCode).toBe(200);
      expect(practice.json().items).toEqual([]);
    });

    it("refuses a rated filter that is not a boolean", async () => {
      const res = await h.app.inject({ method: "GET", url: "/v1/games?rated=maybe" });
      expect(res.statusCode).toBe(400);
    });
  });
});
