import { presenceKeyFor } from "@aichess/runtime";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "../test-utils/sse-client.js";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("agent event stream", () => {
  let h: Harness;
  const clients: SseClient[] = [];

  beforeAll(async () => {
    h = await startHarness({ listen: true });
  });

  afterAll(async () => {
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  async function connect(key: string): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`, { authorization: `Bearer ${key}` });
    clients.push(client);
    return client;
  }

  it("rejects an unauthenticated connection with the standard body", async () => {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`);
    expect(client.status).toBe(401);
    expect(JSON.parse(client.body)).toMatchObject({ error: "unauthorized" });
  });

  it("opens with hello and marks the agent present", async () => {
    const client = await connect(h.agents.white.key);
    expect(client.status).toBe(200);
    const hello = await client.take("hello");
    expect(hello).toEqual({ type: "hello", agentId: h.agents.white.id, activeGame: null, queue: null });
    const ttl = await h.deps.redis.ttl(presenceKeyFor(h.agents.white.id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(h.config.PRESENCE_TTL_SECONDS);
  });

  it("replays the active game and the pending turn on connect", async () => {
    const gameId = await h.createGame();
    const client = await connect(h.agents.white.key);
    const hello = await client.take("hello");
    if (hello.type !== "hello") throw new Error("expected hello");
    expect(hello.activeGame?.id).toBe(gameId);
    expect(hello.activeGame?.legalMoves).toHaveLength(20);
    const turn = await client.take("game.your_turn");
    expect(turn).toMatchObject({ gameId, ply: 0, attemptsLeft: 3 });

    const black = await connect(h.agents.black.key);
    const blackHello = await black.take("hello");
    if (blackHello.type !== "hello") throw new Error("expected hello");
    expect(blackHello.activeGame?.id).toBe(gameId);
    expect(blackHello.activeGame?.legalMoves).toBeUndefined();
  });

  it("delivers game events live to both agents", async () => {
    const white = await connect(h.agents.white.key);
    const black = await connect(h.agents.black.key);
    await white.take("hello");
    await black.take("hello");

    const gameId = await h.createGame();
    expect(await white.take("game.start")).toMatchObject({ gameId, color: "white" });
    expect(await white.take("game.your_turn")).toMatchObject({ gameId, ply: 0 });
    expect(await black.take("game.start")).toMatchObject({ gameId, color: "black" });

    const res = await h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/move`,
      headers: { authorization: `Bearer ${h.agents.white.key}` },
      payload: { ply: 0, move: "e4" },
    });
    expect(res.statusCode).toBe(200);
    expect(await black.take("game.move")).toMatchObject({ gameId, san: "e4" });
    expect(await black.take("game.your_turn")).toMatchObject({ gameId, ply: 1 });
    expect(await white.take("game.move")).toMatchObject({ gameId, san: "e4" });
  });

  it("closes the previous stream when the same agent reconnects", async () => {
    const first = await connect(h.agents.white.key);
    await first.take("hello");
    const second = await connect(h.agents.white.key);
    await second.take("hello");
    await first.closed;
    expect(await h.deps.redis.exists(presenceKeyFor(h.agents.white.id))).toBe(1);
  });

  it("pings and refreshes presence, then removes presence on disconnect", async () => {
    const client = await connect(h.agents.white.key);
    await client.take("hello");
    const key = presenceKeyFor(h.agents.white.id);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await client.take("ping")).toMatchObject({ type: "ping" });
    expect(await h.deps.redis.ttl(key)).toBeGreaterThan(h.config.PRESENCE_TTL_SECONDS - 3);
    client.close();
    await client.closed;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await h.deps.redis.exists(key)).toBe(0);
  });

  it("reports the agent through /v1/agent/me", async () => {
    const headers = { authorization: `Bearer ${h.agents.white.key}` };
    const offline = await h.app.inject({ method: "GET", url: "/v1/agent/me", headers });
    expect(offline.statusCode).toBe(200);
    expect(offline.json()).toEqual({
      agent: expect.objectContaining({ id: h.agents.white.id, slug: h.agents.white.slug }),
      status: "active",
      online: false,
      activeGameId: null,
      queue: null,
      rating: { rating: 1500, rd: 350, gamesPlayed: 0, provisional: true },
    });
    const client = await connect(h.agents.white.key);
    await client.take("hello");
    const gameId = await h.createGame();
    const online = await h.app.inject({ method: "GET", url: "/v1/agent/me", headers });
    expect(online.json()).toMatchObject({ online: true, activeGameId: gameId });
  });
});
