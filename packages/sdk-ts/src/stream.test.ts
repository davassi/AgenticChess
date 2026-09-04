import { describe, expect, it } from "vitest";
import { AgenticChessClient, type MoveChoice } from "./client.js";
import { fakeFetch, jsonResponse, sseResponse } from "./testing.js";

const GAME = "11111111-1111-4111-8111-111111111111";

function frame(payload: Record<string, unknown>): string {
  return `event: ${String(payload["type"])}\ndata: ${JSON.stringify(payload)}\n\n`;
}

const hello = frame({ type: "hello", agentId: "a1", activeGame: null, queue: null });
const yourTurn = frame({
  type: "game.your_turn",
  gameId: GAME,
  ply: 4,
  fen: "startpos",
  history: ["e4", "c5"],
  lastMove: { san: "c5", uci: "c7c5" },
  legalMoves: [{ san: "Nf3", uci: "g1f3" }],
  deadlineAt: "2026-09-04T10:01:00.000Z",
  attemptsLeft: 3,
});
const gameEnd = frame({
  type: "game.end",
  gameId: GAME,
  result: "1-0",
  termination: "checkmate",
  pgn: "",
  rating: null,
});

interface Built {
  client: AgenticChessClient;
  calls: Array<{ url: string; init: RequestInit }>;
  errors: unknown[];
  slept: number[];
}

function build(script: Array<Response | Error>, nowIso = "2026-09-04T10:00:00.000Z"): Built {
  const fake = fakeFetch(script);
  const errors: unknown[] = [];
  const slept: number[] = [];
  const client = new AgenticChessClient({
    apiKey: "ac_test",
    baseUrl: "https://api.example",
    fetch: fake.fetch,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    now: () => Date.parse(nowIso),
    random: () => 0.5,
    onEvent: (event) => {
      if (event.type === "game.end") client.stop();
    },
    onError: (error) => errors.push(error),
  });
  return { client, calls: fake.calls, errors, slept };
}

describe("AgenticChessClient.run", () => {
  it("hands each turn to the callback and posts the move with the turn's ply", async () => {
    const { client, calls } = build([sseResponse([hello, yourTurn, gameEnd]), jsonResponse(200, { id: GAME })]);
    client.onYourTurn((turn): MoveChoice => ({ move: turn.legalMoves[0]?.san ?? "", comment: "Developing." }));

    await client.run();

    expect(calls[0]?.url).toBe("https://api.example/v1/agent/events");
    expect(calls[1]?.url).toBe(`https://api.example/v1/games/${GAME}/move`);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ ply: 4, move: "Nf3", comment: "Developing." });
  });

  it("sends nothing when the callback throws, because the SDK never invents a move", async () => {
    const { client, calls, errors } = build([sseResponse([yourTurn, gameEnd])]);
    client.onYourTurn(() => {
      throw new Error("the model is down");
    });

    await client.run();

    expect(calls).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("sends nothing when the callback declines by returning null", async () => {
    const { client, calls } = build([sseResponse([yourTurn, gameEnd])]);
    client.onYourTurn(() => null);

    await client.run();

    expect(calls).toHaveLength(1);
  });

  it("sends nothing when the callback answered past the deadline", async () => {
    const { client, calls, errors } = build([sseResponse([yourTurn, gameEnd])], "2026-09-04T10:05:00.000Z");
    client.onYourTurn((): MoveChoice => ({ move: "Nf3" }));

    await client.run();

    expect(calls).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("ignores an event type it has never heard of, so a new arena event breaks no agent", async () => {
    const unknown = frame({ type: "game.commentary", gameId: GAME, text: "what a move" });
    const { client, errors } = build([sseResponse([hello, unknown, gameEnd])]);

    await client.run();

    expect(errors).toEqual([]);
  });

  it("keeps backing off across repeated hello-only connections instead of pinning the delay", async () => {
    // The arena writes `hello` the instant a connection opens (agent-streams.ts
    // writes it before anything else on every connect). A connection that
    // delivers nothing but `hello` and then dies is not a healthy connection,
    // so two of those in a row must grow the delay, not reset it back to the
    // same ~750ms every time - that pinned delay, hammering the arena roughly
    // once a second forever, is exactly the bug this test pins closed.
    const { client, calls, slept } = build([sseResponse([hello]), sseResponse([hello]), sseResponse([gameEnd])]);

    await client.run();

    expect(calls).toHaveLength(3);
    expect(slept).toEqual([750, 1500]);
  });

  it("stops instead of reconnecting when the key is rejected", async () => {
    const { client, calls } = build([jsonResponse(401, { error: "unauthorized", message: "Invalid API key" })]);

    await expect(client.run()).rejects.toMatchObject({ code: "unauthorized" });
    expect(calls).toHaveLength(1);
  });

  it("keeps backing off through a transient fetch failure, reporting it without dying", async () => {
    const { client, calls, errors, slept } = build([new TypeError("fetch failed"), sseResponse([gameEnd])]);

    await client.run();

    expect(calls).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(slept).toEqual([750]);
  });

  it("acts on game.your_turn again after every hello, since the arena re-sends it on reconnect", async () => {
    const { client, calls } = build([
      sseResponse([hello, yourTurn]),
      jsonResponse(200, { id: GAME }),
      sseResponse([hello, yourTurn, gameEnd]),
      jsonResponse(200, { id: GAME }),
    ]);
    client.onYourTurn((turn): MoveChoice => ({ move: turn.legalMoves[0]?.san ?? "" }));

    await client.run();

    const moves = calls.filter((call) => call.url === `https://api.example/v1/games/${GAME}/move`);
    expect(moves).toHaveLength(2);
    for (const move of moves) {
      expect(JSON.parse(String(move.init.body))).toMatchObject({ ply: 4 });
    }
  });
});
