import { createDeadlineWorker, createRedis, noopLogger } from "@aichess/runtime";
import type { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSseClient, type SseClient } from "./test-utils/sse-client.js";
import { startHarness, type Harness, type SeededAgent } from "./test-utils/harness.js";

describe("end to end", () => {
  let h: Harness;
  let workerConnection: Redis;
  let worker: Worker;
  const clients: SseClient[] = [];

  beforeAll(async () => {
    h = await startHarness({ listen: true });
    workerConnection = createRedis(h.config.REDIS_URL);
    await workerConnection.connect();
    worker = createDeadlineWorker({ connection: workerConnection, service: h.deps.service, logger: noopLogger });
  });

  afterAll(async () => {
    await worker.close();
    await workerConnection.quit();
    await h.stop();
  });

  beforeEach(async () => {
    await h.reseed();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  async function connect(agent: SeededAgent): Promise<SseClient> {
    const client = await openSseClient(`${h.baseUrl}/v1/agent/events`, { authorization: `Bearer ${agent.key}` });
    clients.push(client);
    await client.take("hello");
    return client;
  }

  async function post(agent: SeededAgent, path: string, body?: unknown): Promise<Response> {
    return fetch(`${h.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${agent.key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function playScript(client: SseClient, agent: SeededAgent, gameId: string, moves: string[]): Promise<void> {
    for (const san of moves) {
      const turn = await client.take("game.your_turn", 10_000);
      if (turn.type !== "game.your_turn") throw new Error("expected your_turn");
      expect(turn.gameId).toBe(gameId);
      const res = await post(agent, `/v1/games/${gameId}/move`, {
        ply: turn.ply,
        move: san,
        comment: `playing ${san}`,
      });
      expect(res.status).toBe(200);
    }
  }

  it("plays a complete game to checkmate over the wire", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame();
    const spectator = await openSseClient(`${h.baseUrl}/v1/games/${gameId}/stream`);
    clients.push(spectator);
    await spectator.take("game.snapshot");

    await Promise.all([
      playScript(white, h.agents.white, gameId, ["f3", "g4"]),
      playScript(black, h.agents.black, gameId, ["e5", "Qh4#"]),
    ]);

    const whiteEnd = await white.take("game.end");
    const blackEnd = await black.take("game.end");
    expect(whiteEnd).toMatchObject({ gameId, result: "0-1", termination: "checkmate" });
    expect(blackEnd).toMatchObject({ gameId, result: "0-1", termination: "checkmate" });
    if (whiteEnd.type === "game.end") expect(whiteEnd.pgn).toContain("Qh4#");

    const seen: string[] = [];
    for (;;) {
      const event = await spectator.take(undefined, 2_000);
      if (event.type === "ping") continue;
      seen.push(event.type);
      if (event.type === "game.end") break;
    }
    expect(seen).toEqual([
      "game.move",
      "game.turn",
      "game.move",
      "game.turn",
      "game.move",
      "game.turn",
      "game.move",
      "game.end",
    ]);

    const snapshot = await (await fetch(`${h.baseUrl}/v1/games/${gameId}`)).json();
    expect(snapshot).toMatchObject({ status: "finished", history: ["f3", "e5", "g4", "Qh4#"] });
  });

  it("lets the worker end a game on time", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame(1_000);
    await playScript(white, h.agents.white, gameId, ["e4"]);
    await playScript(black, h.agents.black, gameId, ["e5"]);
    await white.take("game.your_turn");
    const end = await black.take("game.end", 10_000);
    expect(end).toMatchObject({ gameId, result: "0-1", termination: "timeout" });
    expect(await white.take("game.end", 10_000)).toMatchObject({ gameId, termination: "timeout" });
  });

  it("aborts a game where nobody moved", async () => {
    const white = await connect(h.agents.white);
    const gameId = await h.createGame(1_000);
    await white.take("game.your_turn");
    expect(await white.take("game.end", 10_000)).toMatchObject({ gameId, result: "*", termination: "aborted" });
  });

  it("re-syncs an agent that reconnects mid-game", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame();
    await playScript(white, h.agents.white, gameId, ["d4"]);
    await playScript(black, h.agents.black, gameId, ["d5"]);
    await white.take("game.your_turn");
    white.close();
    await white.closed;

    const again = await openSseClient(`${h.baseUrl}/v1/agent/events`, {
      authorization: `Bearer ${h.agents.white.key}`,
    });
    clients.push(again);
    const hello = await again.take("hello");
    if (hello.type !== "hello") throw new Error("expected hello");
    expect(hello.activeGame).toMatchObject({ id: gameId, ply: 2, turn: "white" });
    expect(hello.activeGame?.legalMoves?.length).toBeGreaterThan(0);
    expect(await again.take("game.your_turn")).toMatchObject({ gameId, ply: 2 });
  });

  it("forfeits an agent after three illegal attempts, visibly", async () => {
    const white = await connect(h.agents.white);
    const black = await connect(h.agents.black);
    const gameId = await h.createGame();
    const spectator = await openSseClient(`${h.baseUrl}/v1/games/${gameId}/stream`);
    clients.push(spectator);
    await spectator.take("game.snapshot");
    await white.take("game.your_turn");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await post(h.agents.white, `/v1/games/${gameId}/move`, { ply: 0, move: "Ke2" });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { details: { attemptsLeft: number } };
      expect(body.details.attemptsLeft).toBe(2 - attempt);
      expect(await spectator.take("game.illegal_attempt")).toMatchObject({ gameId, attemptsLeft: 2 - attempt });
    }
    expect(await black.take("game.end")).toMatchObject({ gameId, result: "0-1", termination: "illegal_moves" });
    expect(await spectator.take("game.end")).toMatchObject({ gameId, termination: "illegal_moves" });
  });
});
