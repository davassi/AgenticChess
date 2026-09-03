import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "../test-utils/sse-client.js";
import { startHarness, type Harness } from "../test-utils/harness.js";

describe("spectator stream", () => {
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

  async function watch(gameId: string): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/games/${gameId}/stream`);
    clients.push(client);
    return client;
  }

  const move = (key: string, gameId: string, ply: number, san: string): Promise<{ statusCode: number }> =>
    h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/move`,
      headers: { authorization: `Bearer ${key}` },
      payload: { ply, move: san },
    });

  it("answers 404 for an unknown game", async () => {
    const client = await openSseClient(`${h.baseUrl}/v1/games/${randomUUID()}/stream`);
    expect(client.status).toBe(404);
    expect(JSON.parse(client.body)).toMatchObject({ error: "not_found" });
  });

  it("opens with a snapshot and relays public events", async () => {
    const gameId = await h.createGame();
    const client = await watch(gameId);
    expect(client.status).toBe(200);
    const snapshot = await client.take("game.snapshot");
    if (snapshot.type !== "game.snapshot") throw new Error("expected snapshot");
    expect(snapshot.game).toMatchObject({ id: gameId, ply: 0, turn: "white" });
    expect(snapshot.game.legalMoves).toBeUndefined();

    expect((await move(h.agents.white.key, gameId, 0, "Nf6")).statusCode).toBe(422);
    expect(await client.take("game.illegal_attempt")).toMatchObject({
      gameId,
      color: "white",
      submitted: "Nf6",
      attemptsLeft: 2,
    });

    expect((await move(h.agents.white.key, gameId, 0, "e4")).statusCode).toBe(200);
    expect(await client.take("game.move")).toMatchObject({ gameId, san: "e4", color: "white" });
    expect(await client.take("game.turn")).toMatchObject({ gameId, color: "black", ply: 1 });

    const resign = await h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/resign`,
      headers: { authorization: `Bearer ${h.agents.black.key}` },
    });
    expect(resign.statusCode).toBe(200);
    const end = await client.take("game.end");
    expect(end).toMatchObject({ gameId, result: "1-0", termination: "resignation", rating: null });
  });

  it("sends the snapshot and closes for a finished game", async () => {
    const gameId = await h.createGame();
    await h.app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/resign`,
      headers: { authorization: `Bearer ${h.agents.white.key}` },
    });
    const client = await watch(gameId);
    const snapshot = await client.take("game.snapshot");
    if (snapshot.type !== "game.snapshot") throw new Error("expected snapshot");
    expect(snapshot.game.status).toBe("finished");
    await client.closed;
  });

  it("pings spectators", async () => {
    const gameId = await h.createGame();
    const client = await watch(gameId);
    await client.take("game.snapshot");
    expect(await client.take("ping", 3_000)).toMatchObject({ type: "ping" });
  });
});
